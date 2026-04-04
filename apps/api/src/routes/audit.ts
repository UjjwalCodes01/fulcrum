import { Router, IRouter, Request, Response } from 'express';
import { auth } from 'express-oauth2-jwt-bearer';
import { 
  getAuditLogsForUser, 
  getToolExecutionsForSession, 
  getAuditStats 
} from '../utils/audit.js';
import { logger } from '../utils/logger.js';

export const auditRouter: IRouter = Router();

// JWT middleware for audit routes - REQUIRED for all endpoints
const jwtCheck = auth({
  audience: process.env.AUTH0_AUDIENCE || 'https://fulcrum-api',
  issuerBaseURL: process.env.AUTH0_DOMAIN ? `https://${process.env.AUTH0_DOMAIN}` : undefined,
  tokenSigningAlg: 'RS256',
});

// Helper to extract userId from verified JWT only
function getAuthenticatedUserId(req: Request): string | null {
  const auth = (req as any).auth;
  if (!auth?.payload?.sub) {
    return null;
  }
  return auth.payload.sub;
}

/**
 * GET /api/audit
 * Get audit logs for the authenticated user
 * REQUIRES: Valid JWT token
 */
auditRouter.get('/', jwtCheck, async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUserId(req);
    
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }
    
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page - 1) * limit;
    
    const logs = await getAuditLogsForUser(userId, { limit, offset });
    
    res.json({
      success: true,
      logs,
      total: logs.length,
      page,
      limit,
    });
  } catch (error) {
    logger.error('Failed to fetch audit logs', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch audit logs',
    });
  }
});

/**
 * GET /api/audit/stats
 * Get audit statistics for the authenticated user
 * REQUIRES: Valid JWT token
 */
auditRouter.get('/stats', jwtCheck, async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUserId(req);
    
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }
    
    const stats = await getAuditStats(userId);
    
    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    logger.error('Failed to fetch audit stats', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch audit stats',
    });
  }
});

/**
 * GET /api/audit/:sessionId
 * Get audit logs for a specific session
 * REQUIRES: Valid JWT token
 * NOTE: Session ownership is verified via audit_log entries
 */
auditRouter.get('/:sessionId', jwtCheck, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = getAuthenticatedUserId(req);
    
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }
    
    // Verify session ownership by checking if this user has any audit logs for this session
    // We need to check audit_log directly for this specific session and user
    const sessionLogs = await getToolExecutionsForSession(sessionId);
    
    if (sessionLogs.length === 0) {
      // Session doesn't exist or has no tool executions
      res.status(404).json({
        success: false,
        error: 'Session not found',
      });
      return;
    }
    
    // Check if any audit log entry for this session belongs to this user
    // This is the correct ownership check: does the audit_log contain entries where
    // sessionId = :sessionId AND userId = :userId?
    const ownershipCheck = await getAuditLogsForUser(userId, { 
      sessionId: sessionId,
      limit: 1 
    });
    
    if (ownershipCheck.length === 0) {
      // Session exists but belongs to another user
      res.status(403).json({
        success: false,
        error: 'Not authorized to view this session',
      });
      return;
    }
    
    res.json({
      success: true,
      sessionId,
      executions: sessionLogs,
      count: sessionLogs.length,
    });
  } catch (error) {
    logger.error('Failed to fetch session audit logs', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch session audit logs',
    });
  }
});
