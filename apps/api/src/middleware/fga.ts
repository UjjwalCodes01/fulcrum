/**
 * FGA Middleware
 * 
 * Express middleware for checking FGA permissions on routes.
 * Integrates with the agent flow to ensure Zero-Trust authorization.
 */

import { Request, Response, NextFunction } from 'express';
import { getUserFromToken } from './auth.js';
import { 
  checkPermission, 
  requiresApproval, 
  getActionRiskLevel, 
  grantAgentPermissions,
  FGACheckResult 
} from '../services/fga.js';
import { logger } from '../utils/logger.js';

// Extend Express Request to include FGA result
export interface FGARequest extends Request {
  fgaResult?: FGACheckResult;
  actionRequiresApproval?: boolean;
  actionRiskLevel?: number;
}

// Also extend the global Express namespace for compatibility
declare global {
  namespace Express {
    interface Request {
      fgaResult?: FGACheckResult;
      actionRequiresApproval?: boolean;
      actionRiskLevel?: number;
    }
  }
}

/**
 * Middleware factory: Check FGA permission for a specific action
 * 
 * Usage:
 * ```typescript
 * router.post('/execute', 
 *   jwtCheck,
 *   checkFGAPermission('github_list_repos'),
 *   handler
 * );
 * ```
 */
export function checkFGAPermission(action: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = getUserFromToken(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required for FGA check',
        code: 'AUTH_REQUIRED',
      });
    }

    const result = await checkPermission(user.userId, action);
    req.fgaResult = result;
    req.actionRequiresApproval = requiresApproval(action);
    req.actionRiskLevel = getActionRiskLevel(action);

    if (!result.allowed) {
      logger.warn('FGA denied action', {
        userId: user.userId,
        action,
        reason: result.reason,
      });

      return res.status(403).json({
        success: false,
        error: 'The Jedi Council has denied this action.',
        code: 'FGA_DENIED',
        details: {
          action,
          reason: result.reason,
          riskLevel: req.actionRiskLevel,
        },
      });
    }

    // If action requires CIBA approval, add a flag (don't block here)
    if (req.actionRequiresApproval) {
      logger.info('Action requires CIBA approval', {
        userId: user.userId,
        action,
        riskLevel: req.actionRiskLevel,
      });
    }

    next();
  };
}

/**
 * Middleware factory: Dynamic FGA check based on request body
 * 
 * Usage:
 * ```typescript
 * router.post('/agent/execute',
 *   jwtCheck,
 *   checkFGADynamic((req) => req.body.toolName),
 *   handler
 * );
 * ```
 */
export function checkFGADynamic(getAction: (req: Request) => string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = getUserFromToken(req);
    const action = getAction(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required for FGA check',
        code: 'AUTH_REQUIRED',
      });
    }

    if (!action) {
      return res.status(400).json({
        success: false,
        error: 'Action name is required',
        code: 'ACTION_REQUIRED',
      });
    }

    const result = await checkPermission(user.userId, action);
    req.fgaResult = result;
    req.actionRequiresApproval = requiresApproval(action);
    req.actionRiskLevel = getActionRiskLevel(action);

    if (!result.allowed) {
      logger.warn('FGA denied action', {
        userId: user.userId,
        action,
        reason: result.reason,
      });

      return res.status(403).json({
        success: false,
        error: 'The Jedi Council has denied this action.',
        code: 'FGA_DENIED',
        details: {
          action,
          reason: result.reason,
          riskLevel: req.actionRiskLevel,
        },
      });
    }

    next();
  };
}

/**
 * Middleware: Require CIBA approval for high-risk actions
 * 
 * Use after checkFGAPermission to block actions that need approval
 * but haven't been approved yet.
 * 
 * Usage:
 * ```typescript
 * router.post('/dangerous-action',
 *   jwtCheck,
 *   checkFGAPermission('github_merge_pr'),
 *   requireCIBAApproval,
 *   handler
 * );
 * ```
 */
export function requireCIBAApproval(req: Request, res: Response, next: NextFunction) {
  // Check if we've already verified CIBA approval
  const cibaApproved = req.headers['x-ciba-approved'] === 'true';
  const cibaToken = req.headers['x-ciba-token'];

  if (req.actionRequiresApproval && !cibaApproved && !cibaToken) {
    return res.status(202).json({
      success: false,
      status: 'APPROVAL_REQUIRED',
      error: 'This action requires human approval via CIBA.',
      code: 'CIBA_REQUIRED',
      details: {
        riskLevel: req.actionRiskLevel,
        message: 'A push notification will be sent to your device.',
      },
    });
  }

  next();
}

/**
 * Helper: Check permission inline without middleware
 * 
 * Use this in service functions when you need to check permission
 * outside of the Express middleware chain.
 */
export async function verifyPermission(
  userId: string,
  action: string
): Promise<{
  allowed: boolean;
  requiresApproval: boolean;
  riskLevel: number;
  reason?: string;
}> {
  const result = await checkPermission(userId, action);

  return {
    allowed: result.allowed,
    requiresApproval: requiresApproval(action),
    riskLevel: getActionRiskLevel(action),
    reason: result.reason,
  };
}

/**
 * Middleware: Ensure agent permissions exist before any agent route
 * 
 * This MUST run before any checkFGAPermission('agent_*') middleware.
 * It ensures users have agent_interact, agent_approve, agent_deny permissions
 * BEFORE the first protected agent call.
 * 
 * In strict FGA mode, if we can't grant permissions, we fail the request.
 * This prevents the race condition where a user hits /api/agent/message
 * before their agent tuples exist.
 */
export async function ensureAgentPermissions(
  req: Request, 
  res: Response, 
  next: NextFunction
) {
  const user = getUserFromToken(req);

  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  }

  try {
    // Grant agent permissions if they don't exist
    // This is idempotent - FGA ignores duplicate writes
    const result = await grantAgentPermissions(user.userId);
    
    if (!result.success) {
      logger.error('Failed to ensure agent permissions', { 
        userId: user.userId, 
        error: result.error 
      });
      
      // In strict mode, this would have thrown, but check anyway
      return res.status(500).json({
        success: false,
        error: 'Failed to initialize agent permissions',
        code: 'FGA_INIT_FAILED',
      });
    }

    logger.debug('Agent permissions ensured', { userId: user.userId });
    next();
  } catch (error) {
    // grantAgentPermissions throws in strict mode if FGA unavailable
    logger.error('Agent permission initialization failed', { 
      userId: user.userId, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return res.status(503).json({
      success: false,
      error: 'Authorization service unavailable',
      code: 'FGA_UNAVAILABLE',
    });
  }
}
