/**
 * PostgreSQL-backed Agent Session Store
 * 
 * Provides production-grade session persistence for LangGraph agent state.
 * Replaces in-memory Map with PostgreSQL storage for:
 * - Multi-instance deployments
 * - State survival across restarts
 * - Horizontal scaling
 * 
 * IMPORTANT: This is the production session store.
 * Falls back to in-memory only if PostgreSQL is not configured.
 */

import { getPool, isDatabaseConfigured } from './client.js';
import { logger } from '../utils/logger.js';
import type { FulcrumState } from '../agent/state.js';

/**
 * Session storage interface
 */
export interface SessionStore {
  get(sessionId: string): Promise<FulcrumState | null>;
  set(sessionId: string, state: FulcrumState): Promise<void>;
  delete(sessionId: string): Promise<void>;
  cleanup(maxAgeMs?: number): Promise<number>;
  getStats(): Promise<{ total: number; active: number }>;
}

/**
 * PostgreSQL-backed session store
 */
class PostgresSessionStore implements SessionStore {
  async get(sessionId: string): Promise<FulcrumState | null> {
    try {
      const pool = getPool();
      const result = await pool.query(
        'SELECT state FROM agent_sessions WHERE session_id = $1 AND expires_at > NOW()',
        [sessionId]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      // Update last accessed timestamp
      await pool.query(
        'UPDATE agent_sessions SET last_accessed_at = NOW() WHERE session_id = $1',
        [sessionId]
      );
      
      return result.rows[0].state as FulcrumState;
    } catch (error) {
      logger.error('Failed to get session from PostgreSQL', {
        sessionId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  async set(sessionId: string, state: FulcrumState): Promise<void> {
    try {
      const pool = getPool();
      
      // Upsert session state with 24-hour expiry
      await pool.query(
        `INSERT INTO agent_sessions (session_id, user_id, state, expires_at, created_at, last_accessed_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours', NOW(), NOW())
         ON CONFLICT (session_id)
         DO UPDATE SET
           state = EXCLUDED.state,
           last_accessed_at = NOW(),
           expires_at = NOW() + INTERVAL '24 hours'`,
        [sessionId, state.userId, JSON.stringify(state)]
      );
      
      logger.debug('Session saved to PostgreSQL', { sessionId, userId: state.userId });
    } catch (error) {
      logger.error('Failed to save session to PostgreSQL', {
        sessionId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async delete(sessionId: string): Promise<void> {
    try {
      const pool = getPool();
      await pool.query('DELETE FROM agent_sessions WHERE session_id = $1', [sessionId]);
      logger.debug('Session deleted from PostgreSQL', { sessionId });
    } catch (error) {
      logger.error('Failed to delete session from PostgreSQL', {
        sessionId,
        error: (error as Error).message,
      });
    }
  }

  async cleanup(_maxAgeMs?: number): Promise<number> {
    try {
      const pool = getPool();
      const result = await pool.query(
        'DELETE FROM agent_sessions WHERE expires_at < NOW() RETURNING session_id'
      );
      
      const deletedCount = result.rowCount || 0;
      if (deletedCount > 0) {
        logger.info('Cleaned up expired sessions', { count: deletedCount });
      }
      
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup sessions', {
        error: (error as Error).message,
      });
      return 0;
    }
  }

  async getStats(): Promise<{ total: number; active: number }> {
    try {
      const pool = getPool();
      const result = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE last_accessed_at > NOW() - INTERVAL '1 hour') as active
        FROM agent_sessions
      `);
      
      return {
        total: parseInt(result.rows[0].total) || 0,
        active: parseInt(result.rows[0].active) || 0,
      };
    } catch (error) {
      logger.error('Failed to get session stats', {
        error: (error as Error).message,
      });
      return { total: 0, active: 0 };
    }
  }
}

/**
 * In-memory session store (fallback)
 */
class InMemorySessionStore implements SessionStore {
  private store = new Map<string, { state: FulcrumState; expiresAt: number }>();
  private maxSessions = 100;

  async get(sessionId: string): Promise<FulcrumState | null> {
    const entry = this.store.get(sessionId);
    
    if (!entry) {
      return null;
    }
    
    // Check expiry
    if (Date.now() > entry.expiresAt) {
      this.store.delete(sessionId);
      return null;
    }
    
    return entry.state;
  }

  async set(sessionId: string, state: FulcrumState): Promise<void> {
    // LRU cleanup if at capacity
    if (this.store.size >= this.maxSessions && !this.store.has(sessionId)) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) {
        this.store.delete(firstKey);
      }
    }
    
    this.store.set(sessionId, {
      state,
      expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
    });
    
    logger.debug('Session saved to in-memory store', { sessionId, userId: state.userId });
  }

  async delete(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
    logger.debug('Session deleted from in-memory store', { sessionId });
  }

  async cleanup(_maxAgeMs?: number): Promise<number> {
    const now = Date.now();
    let deletedCount = 0;
    
    for (const [sessionId, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(sessionId);
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      logger.info('Cleaned up expired in-memory sessions', { count: deletedCount });
    }
    
    return deletedCount;
  }

  async getStats(): Promise<{ total: number; active: number }> {
    return {
      total: this.store.size,
      active: this.store.size, // All in-memory sessions are "active"
    };
  }
}

/**
 * Create the appropriate session store based on configuration
 */
let sessionStore: SessionStore | null = null;

export async function getSessionStore(): Promise<SessionStore> {
  if (sessionStore) {
    return sessionStore;
  }
  
  // Check if PostgreSQL is configured and reachable
  const dbConfigured = await isDatabaseConfigured();
  
  if (dbConfigured) {
    logger.info('Using PostgreSQL session store');
    sessionStore = new PostgresSessionStore();
    
    // Initialize schema
    await initializeSessionSchema();
  } else {
    logger.warn('PostgreSQL not configured - using in-memory session store (NOT production-ready)');
    sessionStore = new InMemorySessionStore();
  }
  
  // Start cleanup interval (every hour)
  setInterval(async () => {
    try {
      await sessionStore?.cleanup();
    } catch (error) {
      logger.error('Session cleanup failed', { error: (error as Error).message });
    }
  }, 60 * 60 * 1000);
  
  return sessionStore;
}

/**
 * Initialize session schema in PostgreSQL
 */
async function initializeSessionSchema(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        session_id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        state JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        last_accessed_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON agent_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON agent_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_accessed ON agent_sessions(last_accessed_at);
    `);
    
    logger.info('Agent session schema initialized');
  } finally {
    client.release();
  }
}

/**
 * Helper functions for backward compatibility with routes
 */
export async function getSessionState(sessionId: string): Promise<FulcrumState | null> {
  const store = await getSessionStore();
  return store.get(sessionId);
}

export async function saveSessionState(sessionId: string, state: FulcrumState): Promise<void> {
  const store = await getSessionStore();
  await store.set(sessionId, state);
}

export async function deleteSessionState(sessionId: string): Promise<void> {
  const store = await getSessionStore();
  await store.delete(sessionId);
}

export async function getSessionStats(): Promise<{ total: number; active: number }> {
  const store = await getSessionStore();
  return store.getStats();
}
