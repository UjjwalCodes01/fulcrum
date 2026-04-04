/**
 * Audit Logger
 * 
 * Provides comprehensive audit logging to PostgreSQL for all agent operations.
 * Audit logs are immutable and should NEVER be deleted.
 * 
 * Schema:
 * - audit_log table tracks all agent actions
 * - tool_executions table tracks detailed tool metrics
 */

import { logger, logSafe } from './logger.js';
import { getPool, isDatabaseConfigured } from '../db/client.js';

// ============================================================================
// TYPES
// ============================================================================

export interface AuditLogEntry {
  userId: string;
  sessionId?: string;
  action: string;
  resource?: string;
  fgaResult?: 'ALLOWED' | 'DENIED' | 'SKIPPED';
  cibaStatus?: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  result: 'SUCCESS' | 'FAILURE' | 'BLOCKED' | 'PENDING';
  details?: Record<string, unknown>;
  auth0TraceId?: string;
}

export interface ToolExecutionEntry {
  sessionId?: string;
  toolName: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  fgaCheckPassed?: boolean;
  cibaRequired?: boolean;
  cibaApproved?: boolean;
  tokenVaultUsed?: boolean;
  executionTimeMs?: number;
  success: boolean;
  error?: string;
}

// ============================================================================
// AUDIT LOG FUNCTIONS
// ============================================================================

/**
 * Record an action to the audit log (immutable)
 */
export async function recordAuditLog(entry: AuditLogEntry): Promise<string | null> {
  const safeDetails = entry.details ? logSafe(entry.details) : null;
  
  // Always log to console for debugging
  logger.info('AUDIT', {
    userId: entry.userId,
    action: entry.action,
    resource: entry.resource,
    result: entry.result,
    fgaResult: entry.fgaResult,
    cibaStatus: entry.cibaStatus,
  });
  
  if (!isDatabaseConfigured()) {
    logger.warn('Audit log not persisted - database not configured');
    return null;
  }
  
  try {
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO audit_log 
        (user_id, session_id, action, resource, fga_result, ciba_status, result, details, auth0_trace_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        entry.userId,
        entry.sessionId || null,
        entry.action,
        entry.resource || null,
        entry.fgaResult || null,
        entry.cibaStatus || null,
        entry.result,
        safeDetails ? JSON.stringify(safeDetails) : null,
        entry.auth0TraceId || null,
      ]
    );
    
    const auditId = result.rows[0]?.id;
    logger.debug('Audit log recorded', { auditId, action: entry.action });
    return auditId;
    
  } catch (error) {
    logger.error('Failed to record audit log', {
      error: error instanceof Error ? error.message : 'Unknown error',
      action: entry.action,
      userId: entry.userId,
    });
    return null;
  }
}

/**
 * Record a tool execution with full metrics
 */
export async function recordToolExecution(entry: ToolExecutionEntry): Promise<string | null> {
  const safeInput = entry.input ? logSafe(entry.input) : null;
  const safeOutput = entry.output ? logSafe(entry.output) : null;
  
  // Always log to console
  logger.info('TOOL_EXECUTION', {
    tool: entry.toolName,
    success: entry.success,
    executionTimeMs: entry.executionTimeMs,
    cibaRequired: entry.cibaRequired,
    cibaApproved: entry.cibaApproved,
  });
  
  if (!isDatabaseConfigured()) {
    logger.warn('Tool execution not persisted - database not configured');
    return null;
  }
  
  try {
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO tool_executions 
        (session_id, tool_name, input, output, fga_check_passed, ciba_required, ciba_approved, token_vault_used, execution_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        entry.sessionId || null,
        entry.toolName,
        safeInput ? JSON.stringify(safeInput) : null,
        safeOutput ? JSON.stringify(safeOutput) : null,
        entry.fgaCheckPassed ?? true,
        entry.cibaRequired ?? false,
        entry.cibaApproved ?? null,
        entry.tokenVaultUsed ?? true,
        entry.executionTimeMs || 0,
      ]
    );
    
    const executionId = result.rows[0]?.id;
    logger.debug('Tool execution recorded', { executionId, tool: entry.toolName });
    return executionId;
    
  } catch (error) {
    logger.error('Failed to record tool execution', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tool: entry.toolName,
    });
    return null;
  }
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get audit logs for a user (most recent first)
 */
export async function getAuditLogsForUser(
  userId: string,
  options: { limit?: number; offset?: number; action?: string; sessionId?: string } = {}
): Promise<AuditLogEntry[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }
  
  try {
    const pool = getPool();
    const { limit = 50, offset = 0, action, sessionId } = options;
    
    let query = `SELECT * FROM audit_log WHERE user_id = $1`;
    const params: unknown[] = [userId];
    
    if (sessionId) {
      query += ` AND session_id = $${params.length + 1}`;
      params.push(sessionId);
    }
    
    if (action) {
      query += ` AND action = $${params.length + 1}`;
      params.push(action);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    return result.rows.map((row: Record<string, unknown>) => ({
      userId: row.user_id as string,
      sessionId: row.session_id as string | undefined,
      action: row.action as string,
      resource: row.resource as string | undefined,
      fgaResult: row.fga_result as 'ALLOWED' | 'DENIED' | 'SKIPPED' | undefined,
      cibaStatus: row.ciba_status as 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | undefined,
      result: row.result as 'SUCCESS' | 'FAILURE' | 'BLOCKED' | 'PENDING',
      details: row.details as Record<string, unknown> | undefined,
      auth0TraceId: row.auth0_trace_id as string | undefined,
    }));
    
  } catch (error) {
    logger.error('Failed to get audit logs', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId,
    });
    return [];
  }
}

/**
 * Get tool execution history for a session
 */
export async function getToolExecutionsForSession(
  sessionId: string,
  options: { limit?: number; toolName?: string } = {}
): Promise<ToolExecutionEntry[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }
  
  try {
    const pool = getPool();
    const { limit = 50, toolName } = options;
    
    let query = `SELECT * FROM tool_executions WHERE session_id = $1`;
    const params: unknown[] = [sessionId];
    
    if (toolName) {
      query += ` AND tool_name = $${params.length + 1}`;
      params.push(toolName);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    
    const result = await pool.query(query, params);
    
    return result.rows.map((row: Record<string, unknown>) => ({
      sessionId: row.session_id as string | undefined,
      toolName: row.tool_name as string,
      input: row.input as Record<string, unknown> | undefined,
      output: row.output as Record<string, unknown> | undefined,
      fgaCheckPassed: row.fga_check_passed as boolean | undefined,
      cibaRequired: row.ciba_required as boolean,
      cibaApproved: row.ciba_approved as boolean | undefined,
      tokenVaultUsed: row.token_vault_used as boolean,
      executionTimeMs: row.execution_time_ms as number | undefined,
      success: true, // Historical records are successful
    }));
    
  } catch (error) {
    logger.error('Failed to get tool executions', {
      error: error instanceof Error ? error.message : 'Unknown error',
      sessionId,
    });
    return [];
  }
}

/**
 * Get audit statistics for a user
 */
export async function getAuditStats(userId: string): Promise<{
  totalActions: number;
  successCount: number;
  failureCount: number;
  blockedCount: number;
  cibaApprovalCount: number;
  cibaDenialCount: number;
  toolUsage: Record<string, number>;
}> {
  const defaultStats = {
    totalActions: 0,
    successCount: 0,
    failureCount: 0,
    blockedCount: 0,
    cibaApprovalCount: 0,
    cibaDenialCount: 0,
    toolUsage: {} as Record<string, number>,
  };
  
  if (!isDatabaseConfigured()) {
    return defaultStats;
  }
  
  try {
    const pool = getPool();
    
    // Get result counts
    const resultCounts = await pool.query(
      `SELECT result, COUNT(*) as count FROM audit_log WHERE user_id = $1 GROUP BY result`,
      [userId]
    );
    
    // Get CIBA counts
    const cibaCounts = await pool.query(
      `SELECT ciba_status, COUNT(*) as count FROM audit_log 
       WHERE user_id = $1 AND ciba_status IS NOT NULL 
       GROUP BY ciba_status`,
      [userId]
    );
    
    // Get tool usage - query tool_executions directly, filter by user from audit_log
    const toolUsage = await pool.query(
      `SELECT tool_name, COUNT(*) as count FROM tool_executions
       WHERE session_id IN (
         SELECT DISTINCT session_id FROM audit_log WHERE user_id = $1 AND session_id IS NOT NULL
       )
       GROUP BY tool_name`,
      [userId]
    );
    
    const stats = { ...defaultStats };
    
    resultCounts.rows.forEach((row: { result: string; count: string }) => {
      const count = parseInt(row.count);
      stats.totalActions += count;
      if (row.result === 'SUCCESS') stats.successCount = count;
      if (row.result === 'FAILURE') stats.failureCount = count;
      if (row.result === 'BLOCKED') stats.blockedCount = count;
    });
    
    cibaCounts.rows.forEach((row: { ciba_status: string; count: string }) => {
      const count = parseInt(row.count);
      if (row.ciba_status === 'APPROVED') stats.cibaApprovalCount = count;
      if (row.ciba_status === 'DENIED') stats.cibaDenialCount = count;
    });
    
    toolUsage.rows.forEach((row: { tool_name: string; count: string }) => {
      stats.toolUsage[row.tool_name] = parseInt(row.count);
    });
    
    return stats;
    
  } catch (error) {
    logger.error('Failed to get audit stats', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId,
    });
    return defaultStats;
  }
}

// ============================================================================
// DATABASE INITIALIZATION
// ============================================================================

/**
 * Initialize audit tables in the database.
 * Creates audit_log and tool_executions tables with all necessary indexes.
 */
export async function initializeAuditTables(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
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
    
    logger.info('✅ Audit tables initialized (audit_log, tool_executions)');
  } catch (error) {
    logger.error('Failed to initialize audit tables', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  } finally {
    client.release();
  }
}
