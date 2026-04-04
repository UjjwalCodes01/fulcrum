/**
 * Database Client
 * 
 * PostgreSQL connection pool using pg library.
 * Supports both Cloud SQL (via Unix socket) and direct TCP connections.
 */

import { Pool, PoolConfig } from 'pg';
import { logger } from '../utils/logger.js';

// Connection configuration
function getPoolConfig(): PoolConfig {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (databaseUrl) {
    // Use connection string if provided
    return {
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  }
  
  // Fall back to individual env vars
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'fulcrum',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
}

// Singleton pool instance
let pool: Pool | null = null;

/**
 * Get the database connection pool
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(getPoolConfig());
    
    pool.on('error', (err) => {
      logger.error('Unexpected database pool error', { error: err.message });
    });
    
    pool.on('connect', () => {
      logger.debug('New database client connected');
    });
  }
  return pool;
}

/**
 * Check if database is configured and reachable
 */
export async function isDatabaseConfigured(): Promise<boolean> {
  // Check if any database config is present
  const hasConfig = Boolean(
    process.env.DATABASE_URL || 
    process.env.DB_HOST ||
    process.env.DB_NAME
  );
  
  if (!hasConfig) {
    return false;
  }
  
  // Try to connect
  try {
    const client = await getPool().connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    logger.warn('Database not reachable', { error: (error as Error).message });
    return false;
  }
}

/**
 * Initialize database schema (create tables if not exist)
 */
export async function initializeDatabase(): Promise<void> {
  const client = await getPool().connect();
  
  try {
    // Create CIBA requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ciba_requests (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        tool VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        auth_req_id VARCHAR(255) UNIQUE NOT NULL,
        session_id VARCHAR(255) NOT NULL,
        binding_message TEXT NOT NULL,
        tool_input JSONB,
        expires_at TIMESTAMP NOT NULL,
        approved_at TIMESTAMP,
        denied_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_ciba_user_status ON ciba_requests(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_ciba_auth_req ON ciba_requests(auth_req_id);
      CREATE INDEX IF NOT EXISTS idx_ciba_expires ON ciba_requests(expires_at) WHERE status = 'pending';
    `);
    
    // Create agent sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        thread_id VARCHAR(255) NOT NULL,
        state JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON agent_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_thread ON agent_sessions(thread_id);
    `);
    
    // Create audit_log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        auth0_trace_id VARCHAR(255),
        session_id UUID,
        user_id VARCHAR(255) NOT NULL,
        agent_id VARCHAR(100) DEFAULT 'fulcrum:security-auditor',
        action VARCHAR(100) NOT NULL,
        resource VARCHAR(255),
        fga_result VARCHAR(20),
        ciba_status VARCHAR(20),
        result VARCHAR(20) NOT NULL,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
    `);
    
    // Create tool_executions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tool_executions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID,
        tool_name VARCHAR(100) NOT NULL,
        input JSONB,
        output JSONB,
        fga_check_passed BOOLEAN,
        ciba_required BOOLEAN DEFAULT false,
        ciba_approved BOOLEAN,
        token_vault_used BOOLEAN DEFAULT true,
        execution_time_ms INTEGER,
        cost_estimate DECIMAL(10, 4),
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_tool_session ON tool_executions(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_name ON tool_executions(tool_name);
      CREATE INDEX IF NOT EXISTS idx_tool_created ON tool_executions(created_at);
    `);
    
    logger.info('Database schema initialized (CIBA, sessions, audit tables)');
  } finally {
    client.release();
  }
}

/**
 * Close the database pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}
