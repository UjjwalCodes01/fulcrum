/**
 * CIBA Pub/Sub Handler
 * 
 * Handles async CIBA approval events from Auth0 or polling results.
 * Updates database status and notifies waiting sessions.
 * 
 * In production, this would use GCP Pub/Sub for real-time event delivery.
 * For the hackathon, we use a simple in-memory event emitter pattern.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import {
  getCIBARequestById,
  pollCIBAStatus,
  updateRequestStatus,
  expireOldRequests,
  CIBARequest,
  CIBARequestStatus,
  getStorageModeInfo,
} from '../services/ciba.js';

// Event types for CIBA status changes
export interface CIBAEvent {
  type: 'status_changed' | 'expired' | 'error';
  requestId: string;
  authReqId: string;
  userId: string;
  tool: string;
  status: CIBARequestStatus;
  previousStatus?: CIBARequestStatus;
  token?: string;
  error?: string;
  timestamp: Date;
}

// Simple event emitter for CIBA events
// In production, this would be replaced with GCP Pub/Sub
class CIBAEventBus extends EventEmitter {
  private static instance: CIBAEventBus;
  
  private constructor() {
    super();
    // Increase max listeners for high-concurrency scenarios
    this.setMaxListeners(100);
  }
  
  static getInstance(): CIBAEventBus {
    if (!CIBAEventBus.instance) {
      CIBAEventBus.instance = new CIBAEventBus();
    }
    return CIBAEventBus.instance;
  }
  
  // Emit a CIBA status change event
  emitStatusChange(event: CIBAEvent): void {
    logger.info('CIBA event emitted', {
      type: event.type,
      requestId: event.requestId,
      status: event.status,
      userId: event.userId,
    });
    this.emit('ciba:status', event);
    this.emit(`ciba:${event.requestId}`, event);
  }
  
  // Subscribe to all CIBA status changes
  onStatusChange(callback: (event: CIBAEvent) => void): void {
    this.on('ciba:status', callback);
  }
  
  // Subscribe to a specific request's status changes
  onRequestStatusChange(requestId: string, callback: (event: CIBAEvent) => void): void {
    this.once(`ciba:${requestId}`, callback);
  }
  
  // Wait for a specific request's status with timeout
  async waitForStatus(
    requestId: string, 
    timeoutMs: number = 300000 // 5 minutes default
  ): Promise<CIBAEvent | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.removeAllListeners(`ciba:${requestId}`);
        resolve(null);
      }, timeoutMs);
      
      this.once(`ciba:${requestId}`, (event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
  }
}

export const cibaEventBus = CIBAEventBus.getInstance();

// Session listeners for real-time notifications
// Maps sessionId -> Set of callback functions (supports multiple tabs)
const sessionListeners = new Map<string, Set<(event: CIBAEvent) => void>>();

/**
 * Register a session to receive CIBA status updates
 * Supports multiple listeners per session (multiple browser tabs)
 */
export function registerSessionListener(
  sessionId: string, 
  callback: (event: CIBAEvent) => void
): () => void {
  let listeners = sessionListeners.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    sessionListeners.set(sessionId, listeners);
  }
  
  listeners.add(callback);
  logger.debug('Session listener registered', { 
    sessionId, 
    listenerCount: listeners.size 
  });
  
  // Return cleanup function
  return () => {
    const currentListeners = sessionListeners.get(sessionId);
    if (currentListeners) {
      currentListeners.delete(callback);
      if (currentListeners.size === 0) {
        sessionListeners.delete(sessionId);
        logger.debug('Session listeners cleaned up', { sessionId });
      } else {
        logger.debug('Session listener removed', { 
          sessionId, 
          remainingCount: currentListeners.size 
        });
      }
    }
  };
}

/**
 * Unregister all listeners for a session
 */
export function unregisterSessionListener(sessionId: string): void {
  const removed = sessionListeners.delete(sessionId);
  if (removed) {
    logger.debug('All session listeners removed', { sessionId });
  }
}

/**
 * Notify a session of a CIBA status change
 * Handles multiple listeners per session (multiple browser tabs)
 */
function notifySession(sessionId: string, event: CIBAEvent): void {
  const listeners = sessionListeners.get(sessionId);
  if (listeners && listeners.size > 0) {
    listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        logger.error('Error notifying session listener', { sessionId, error });
      }
    });
  }
}

/**
 * Process a CIBA status update (from polling or webhook)
 */
export async function processCIBAStatusUpdate(
  requestId: string,
  newStatus: CIBARequestStatus,
  token?: string
): Promise<void> {
  const request = await getCIBARequestById(requestId);
  
  if (!request) {
    logger.warn('CIBA request not found for status update', { requestId });
    return;
  }
  
  const previousStatus = request.status;
  
  // Skip if status hasn't changed
  if (previousStatus === newStatus) {
    return;
  }
  
  logger.info('Processing CIBA status update', {
    requestId,
    previousStatus,
    newStatus,
    userId: request.userId,
    tool: request.tool,
  });
  
  // Create the event
  const event: CIBAEvent = {
    type: 'status_changed',
    requestId: request.id,
    authReqId: request.authReqId,
    userId: request.userId,
    tool: request.tool,
    status: newStatus,
    previousStatus,
    token,
    timestamp: new Date(),
  };
  
  // Emit the event
  cibaEventBus.emitStatusChange(event);
  
  // Notify the session
  notifySession(request.sessionId, event);
}

/**
 * Poll all pending CIBA requests and update their status
 * Called periodically to check for approvals/denials
 */
export async function pollPendingRequests(): Promise<number> {
  // Get all pending requests across all users
  const storageInfo = await getStorageModeInfo();
  let allPendingRequests: CIBARequest[] = [];
  
  if (storageInfo.mode === 'memory') {
    // For memory mode, use the internal store
    const { cibaRequests } = await import('../db/ciba.js');
    allPendingRequests = Array.from(cibaRequests.values())
      .filter((r: CIBARequest) => r.status === 'pending');
  } else {
    // For PostgreSQL mode, query all pending requests
    const { getPool } = await import('../db/client.js');
    
    try {
      const pool = getPool();
      const result = await pool.query(
        `SELECT * FROM ciba_requests 
         WHERE status = 'pending' AND expires_at > NOW()
         ORDER BY created_at ASC`
      );
      
      // Map rows to CIBARequest objects
      allPendingRequests = result.rows.map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        tool: row.tool,
        status: row.status,
        authReqId: row.auth_req_id,
        sessionId: row.session_id,
        bindingMessage: row.binding_message,
        toolInput: row.tool_input,
        expiresAt: new Date(row.expires_at),
        approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
        deniedAt: row.denied_at ? new Date(row.denied_at) : undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      }));
      
      logger.debug('Fetched pending CIBA requests from PostgreSQL', {
        count: allPendingRequests.length,
      });
    } catch (error) {
      logger.error('Failed to fetch pending CIBA requests from PostgreSQL', {
        error: (error as Error).message,
      });
      // Return empty array on error - don't crash the poller
      allPendingRequests = [];
    }
  }
  
  let updated = 0;
  
  for (const request of allPendingRequests) {
    try {
      const result = await pollCIBAStatus(request.authReqId);
      
      // Only process if status changed to a terminal state
      const terminalStatuses = ['approved', 'denied', 'expired'] as const;
      if (terminalStatuses.some(s => s === result.status)) {
        // Map the status to CIBARequestStatus
        const finalStatus = result.status as CIBARequestStatus;
        await processCIBAStatusUpdate(request.id, finalStatus, result.accessToken);
        updated++;
      }
    } catch (error) {
      logger.error('Error polling CIBA request', {
        requestId: request.id,
        error,
      });
    }
  }
  
  // Also expire old requests
  const expired = await expireOldRequests();
  
  // Emit events for expired requests
  for (const request of expired) {
    const event: CIBAEvent = {
      type: 'expired',
      requestId: request.id,
      authReqId: request.authReqId,
      userId: request.userId,
      tool: request.tool,
      status: 'expired',
      previousStatus: 'pending',
      timestamp: new Date(),
    };
    cibaEventBus.emitStatusChange(event);
    notifySession(request.sessionId, event);
  }
  
  if (updated > 0 || expired.length > 0) {
    logger.info('Polling complete', { updated, expired: expired.length });
  }
  
  return updated + expired.length;
}

// Polling interval handle
let pollingInterval: NodeJS.Timeout | null = null;

/**
 * Start background polling for CIBA status updates
 */
export function startCIBAPolling(intervalMs: number = 5000): void {
  if (pollingInterval) {
    logger.warn('CIBA polling already started');
    return;
  }
  
  logger.info('Starting CIBA polling', { intervalMs });
  
  pollingInterval = setInterval(async () => {
    try {
      await pollPendingRequests();
    } catch (error) {
      logger.error('Error in CIBA polling', { error });
    }
  }, intervalMs);
  
  // Don't block process exit
  pollingInterval.unref();
}

/**
 * Stop background polling
 */
export function stopCIBAPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    logger.info('CIBA polling stopped');
  }
}

/**
 * Handle Auth0 CIBA webhook notification
 * Auth0 can push approval/denial status instead of polling
 * 
 * Expected payload from Auth0:
 * {
 *   auth_req_id: string
 *   status: 'approved' | 'denied'
 *   token?: string (if approved)
 * }
 */
export async function handleAuth0Webhook(payload: {
  auth_req_id: string;
  status: 'approved' | 'denied';
  token?: string;
}): Promise<void> {
  logger.info('Auth0 CIBA webhook received', {
    authReqId: payload.auth_req_id,
    status: payload.status,
  });
  
  // Find the request by Auth0's auth_req_id
  // This works for both PostgreSQL and memory storage
  const { getCIBARequestByAuthReqId } = await import('../db/ciba.js');
  const request = await getCIBARequestByAuthReqId(payload.auth_req_id);
  
  if (!request) {
    logger.warn('Webhook for unknown CIBA request', {
      authReqId: payload.auth_req_id,
    });
    return;
  }
  
  // Update status - use additional fields for timestamps
  const newStatus: CIBARequestStatus = payload.status === 'approved' ? 'approved' : 'denied';
  const additionalFields = newStatus === 'approved' 
    ? { approvedAt: new Date() } 
    : { deniedAt: new Date() };
  await updateRequestStatus(request.id, newStatus, additionalFields);
  
  // Process the status update
  await processCIBAStatusUpdate(request.id, newStatus, payload.token);
}

/**
 * Get CIBA status summary (for debugging/monitoring)
 */
export async function getCIBAStats(): Promise<{
  total: number;
  pending: number;
  approved: number;
  denied: number;
  expired: number;
  cancelled: number;
  activeListeners: number;
  storageMode: 'postgres' | 'memory';
  isProductionSafe: boolean;
}> {
  const { getCIBAStats: getDbStats, getStorageModeInfo } = await import('../db/ciba.js');
  const dbStats = await getDbStats();
  const storageInfo = await getStorageModeInfo();
  
  return {
    ...dbStats,
    activeListeners: sessionListeners.size,
    isProductionSafe: storageInfo.isProductionSafe,
  };
}
