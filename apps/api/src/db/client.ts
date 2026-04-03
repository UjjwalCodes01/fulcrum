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
    
    logger.info('Database schema initialized');
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
