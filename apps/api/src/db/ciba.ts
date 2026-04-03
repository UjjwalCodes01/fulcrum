/**
 * CIBA Database Operations - PostgreSQL Implementation
 * 
 * Manages CIBA (Client Initiated Backchannel Authentication) requests.
 * These are approval requests for Level 5 (destructive) actions.
 * 
 * This implementation supports:
 * - PostgreSQL for production (persistent, multi-instance safe)
 * - In-memory fallback for development (when DB not configured)
 * 
 * The storage backend is selected automatically based on DATABASE_URL.
 */

import { logger } from '../utils/logger.js';
import { getPool, isDatabaseConfigured } from './client.js';

// CIBA Request Status
export type CIBAStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';

// CIBA Request record
export interface CIBARequest {
  id: string;
  userId: string;
  tool: string;
  status: CIBAStatus;
  authReqId: string;
  sessionId: string;
  bindingMessage: string;
  toolInput?: Record<string, unknown>;
  expiresAt: Date;
  approvedAt?: Date;
  deniedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Storage mode detection
let storageMode: 'postgres' | 'memory' | null = null;

async function getStorageMode(): Promise<'postgres' | 'memory'> {
  if (storageMode !== null) {
    return storageMode;
  }
  
  const dbConfigured = await isDatabaseConfigured();
  storageMode = dbConfigured ? 'postgres' : 'memory';
  
  if (storageMode === 'memory') {
    const strictMode = process.env.CIBA_STRICT_MODE === 'true';
    if (strictMode) {
      logger.error('⚠️ CIBA_STRICT_MODE=true but database not configured! In-memory storage is NOT production safe.');
    } else {
      logger.warn('CIBA using in-memory storage (database not configured)');
    }
  } else {
    logger.info('CIBA using PostgreSQL storage');
  }
  
  return storageMode;
}

// ============================================================================
// IN-MEMORY STORAGE (Development Fallback)
// ============================================================================

const memoryStore = new Map<string, CIBARequest>();
const memoryAuthReqIndex = new Map<string, string>();
const memoryUserPendingIndex = new Map<string, Set<string>>();

function memoryCreate(request: CIBARequest): void {
  memoryStore.set(request.id, request);
  memoryAuthReqIndex.set(request.authReqId, request.id);
  
  const userKey = `${request.userId}:pending`;
  if (!memoryUserPendingIndex.has(userKey)) {
    memoryUserPendingIndex.set(userKey, new Set());
  }
  memoryUserPendingIndex.get(userKey)!.add(request.id);
}

function memoryUpdate(id: string, updates: Partial<CIBARequest>): CIBARequest | null {
  const request = memoryStore.get(id);
  if (!request) return null;
  
  const previousStatus = request.status;
  Object.assign(request, updates, { updatedAt: new Date() });
  
  // Update indexes if status changed from pending
  if (previousStatus === 'pending' && request.status !== 'pending') {
    const userKey = `${request.userId}:pending`;
    memoryUserPendingIndex.get(userKey)?.delete(id);
  }
  
  return request;
}

// ============================================================================
// POSTGRESQL STORAGE (Production)
// ============================================================================

function rowToRequest(row: Record<string, unknown>): CIBARequest {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    tool: row.tool as string,
    status: row.status as CIBAStatus,
    authReqId: row.auth_req_id as string,
    sessionId: row.session_id as string,
    bindingMessage: row.binding_message as string,
    toolInput: row.tool_input as Record<string, unknown> | undefined,
    expiresAt: new Date(row.expires_at as string),
    approvedAt: row.approved_at ? new Date(row.approved_at as string) : undefined,
    deniedAt: row.denied_at ? new Date(row.denied_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Create a new CIBA request
 */
export async function createCIBARequest(params: {
  id: string;
  userId: string;
  tool: string;
  authReqId: string;
  sessionId: string;
  bindingMessage: string;
  toolInput?: Record<string, unknown>;
  expiresAt: Date;
}): Promise<CIBARequest> {
  const now = new Date();
  
  const request: CIBARequest = {
    id: params.id,
    userId: params.userId,
    tool: params.tool,
    status: 'pending',
    authReqId: params.authReqId,
    sessionId: params.sessionId,
    bindingMessage: params.bindingMessage,
    toolInput: params.toolInput,
    expiresAt: params.expiresAt,
    createdAt: now,
    updatedAt: now,
  };

  const mode = await getStorageMode();
  
  if (mode === 'postgres') {
    const pool = getPool();
    await pool.query(
      `INSERT INTO ciba_requests 
       (id, user_id, tool, status, auth_req_id, session_id, binding_message, tool_input, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        request.id,
        request.userId,
        request.tool,
        request.status,
        request.authReqId,
        request.sessionId,
        request.bindingMessage,
        request.toolInput ? JSON.stringify(request.toolInput) : null,
        request.expiresAt,
        request.createdAt,
        request.updatedAt,
      ]
    );
  } else {
    memoryCreate(request);
  }

  logger.info('CIBA request created', {
    id: request.id,
    userId: request.userId,
    tool: request.tool,
    authReqId: request.authReqId,
    storage: mode,
  });

  return request;
}

/**
 * Get a CIBA request by ID
 */
export async function getCIBARequest(id: string): Promise<CIBARequest | null> {
  const mode = await getStorageMode();
  
  if (mode === 'postgres') {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM ciba_requests WHERE id = $1',
      [id]
    );
    return result.rows[0] ? rowToRequest(result.rows[0]) : null;
  } else {
    return memoryStore.get(id) || null;
  }
}

/**
 * Get a CIBA request by Auth0's auth_req_id
 */
export async function getCIBARequestByAuthReqId(authReqId: string): Promise<CIBARequest | null> {
  const mode = await getStorageMode();
  
  if (mode === 'postgres') {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM ciba_requests WHERE auth_req_id = $1',
      [authReqId]
    );
    return result.rows[0] ? rowToRequest(result.rows[0]) : null;
  } else {
    const id = memoryAuthReqIndex.get(authReqId);
    return id ? memoryStore.get(id) || null : null;
  }
}

/**
 * Get all pending CIBA requests for a user
 */
export async function getPendingCIBARequests(userId: string): Promise<CIBARequest[]> {
  const mode = await getStorageMode();
  
  if (mode === 'postgres') {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM ciba_requests 
       WHERE user_id = $1 AND status = 'pending' AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows.map(rowToRequest);
  } else {
    const userKey = `${userId}:pending`;
    const requestIds = memoryUserPendingIndex.get(userKey);
    
    if (!requestIds || requestIds.size === 0) {
      return [];
    }

    const requests: CIBARequest[] = [];
    const now = new Date();
    
    for (const id of requestIds) {
      const request = memoryStore.get(id);
      if (request && request.status === 'pending') {
        if (now > request.expiresAt) {
          await updateCIBARequestStatus(id, 'expired');
        } else {
          requests.push(request);
        }
      }
    }

    return requests;
  }
}

/**
 * Update CIBA request status
 */
export async function updateCIBARequestStatus(
  id: string,
  status: CIBAStatus,
  additionalFields?: {
    approvedAt?: Date;
    deniedAt?: Date;
  }
): Promise<CIBARequest | null> {
  const mode = await getStorageMode();
  
  if (mode === 'postgres') {
    const pool = getPool();
    
    let query = 'UPDATE ciba_requests SET status = $1, updated_at = NOW()';
    const params: (string | Date)[] = [status];
    let paramIndex = 2;
    
    if (additionalFields?.approvedAt) {
      query += `, approved_at = $${paramIndex++}`;
      params.push(additionalFields.approvedAt);
    }
    if (additionalFields?.deniedAt) {
      query += `, denied_at = $${paramIndex++}`;
      params.push(additionalFields.deniedAt);
    }
    
    query += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);
    
    const result = await pool.query(query, params);
    
    if (result.rows[0]) {
      const request = rowToRequest(result.rows[0]);
      logger.info('CIBA request status updated', {
        id,
        newStatus: status,
        tool: request.tool,
        userId: request.userId,
        storage: 'postgres',
      });
      return request;
    }
    return null;
  } else {
    const request = memoryUpdate(id, {
      status,
      ...additionalFields,
    });
    
    if (request) {
      logger.info('CIBA request status updated', {
        id,
        newStatus: status,
        tool: request.tool,
        userId: request.userId,
        storage: 'memory',
      });
    }
    
    return request;
  }
}

/**
 * Mark a CIBA request as approved
 */
export async function approveCIBARequest(id: string): Promise<CIBARequest | null> {
  return updateCIBARequestStatus(id, 'approved', { approvedAt: new Date() });
}

/**
 * Mark a CIBA request as denied
 */
export async function denyCIBARequest(id: string): Promise<CIBARequest | null> {
  return updateCIBARequestStatus(id, 'denied', { deniedAt: new Date() });
}

/**
 * Mark a CIBA request as expired
 */
export async function expireCIBARequest(id: string): Promise<CIBARequest | null> {
  return updateCIBARequestStatus(id, 'expired');
}

/**
 * Mark a CIBA request as cancelled
 */
export async function cancelCIBARequest(id: string): Promise<CIBARequest | null> {
  return updateCIBARequestStatus(id, 'cancelled');
}

/**
 * Check and expire old CIBA requests
 * Returns array of expired requests for notification purposes
 */
export async function expireOldRequests(): Promise<CIBARequest[]> {
  const mode = await getStorageMode();
  
  if (mode === 'postgres') {
    const pool = getPool();
    const result = await pool.query(
      `UPDATE ciba_requests 
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'pending' AND expires_at < NOW()
       RETURNING *`
    );
    
    const expired = result.rows.map(rowToRequest);
    
    if (expired.length > 0) {
      logger.info('Expired CIBA requests', { count: expired.length, storage: 'postgres' });
    }
    
    return expired;
  } else {
    const now = new Date();
    const expiredRequests: CIBARequest[] = [];

    for (const [id, request] of memoryStore) {
      if (request.status === 'pending' && now > request.expiresAt) {
        const expired = await expireCIBARequest(id);
        if (expired) {
          expiredRequests.push(expired);
        }
      }
    }

    if (expiredRequests.length > 0) {
      logger.info('Expired CIBA requests', { count: expiredRequests.length, storage: 'memory' });
    }

    return expiredRequests;
  }
}

/**
 * Get CIBA request statistics
 */
export async function getCIBAStats(): Promise<{
  total: number;
  pending: number;
  approved: number;
  denied: number;
  expired: number;
  cancelled: number;
  storageMode: 'postgres' | 'memory';
}> {
  const mode = await getStorageMode();
  
  if (mode === 'postgres') {
    const pool = getPool();
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'denied') as denied,
        COUNT(*) FILTER (WHERE status = 'expired') as expired,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
      FROM ciba_requests
    `);
    
    const row = result.rows[0];
    return {
      total: parseInt(row.total),
      pending: parseInt(row.pending),
      approved: parseInt(row.approved),
      denied: parseInt(row.denied),
      expired: parseInt(row.expired),
      cancelled: parseInt(row.cancelled),
      storageMode: 'postgres',
    };
  } else {
    const stats = {
      total: memoryStore.size,
      pending: 0,
      approved: 0,
      denied: 0,
      expired: 0,
      cancelled: 0,
      storageMode: 'memory' as const,
    };

    for (const request of memoryStore.values()) {
      stats[request.status]++;
    }

    return stats;
  }
}

/**
 * Clear all CIBA requests (for testing only)
 */
export async function clearAllCIBARequests(): Promise<void> {
  const mode = await getStorageMode();
  
  if (mode === 'postgres') {
    const pool = getPool();
    await pool.query('DELETE FROM ciba_requests');
  }
  
  memoryStore.clear();
  memoryAuthReqIndex.clear();
  memoryUserPendingIndex.clear();
  
  logger.warn('All CIBA requests cleared');
}

/**
 * Get current storage mode
 */
export async function getStorageModeInfo(): Promise<{
  mode: 'postgres' | 'memory';
  isProductionSafe: boolean;
}> {
  const mode = await getStorageMode();
  return {
    mode,
    isProductionSafe: mode === 'postgres',
  };
}

// Export internal stores for pubsub handler (polling all pending requests)
// These should only be used by the ciba-handler module for memory mode
export const cibaRequests = memoryStore;
export const cibaRequestsByAuthReqId = memoryAuthReqIndex;
