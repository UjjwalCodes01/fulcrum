import { Router, IRouter } from 'express';
import { logger } from '../utils/logger.js';
import { createError } from '../utils/error-handler.js';
import { jwtCheck, getUserFromToken } from '../middleware/auth.js';
import { checkFGAPermission, ensureAgentPermissions, FGARequest } from '../middleware/fga.js';
import {
  initiateCIBA,
  pollCIBAStatus,
  getCIBARequestById,
  getUserPendingRequests,
  manuallyApprove,
  manuallyDeny,
  cancelRequest,
  generateBindingMessage,
  getCIBAStatus,
  CIBARequest,
} from '../services/ciba.js';

export const agentRouter: IRouter = Router();

// All agent routes require authentication
agentRouter.use(jwtCheck);

// CRITICAL: Ensure agent permissions exist BEFORE any FGA-protected route
// This prevents the race condition where a user hits /api/agent/message
// before their agent_interact tuple exists in FGA
agentRouter.use(ensureAgentPermissions);

// Input validation (CRITICAL for cost protection)
function validateInput(input: string): void {
  const maxLength = parseInt(process.env.MAX_INPUT_LENGTH || '5000');
  
  if (!input || typeof input !== 'string') {
    throw createError('Input is required', 400, 'INVALID_INPUT');
  }
  
  if (input.length > maxLength) {
    throw createError(`Input exceeds maximum length of ${maxLength} characters`, 400, 'INPUT_TOO_LONG');
  }
  
  // Prevent prompt injection cost bombs
  const dangerousPatterns = [
    /generate.*\d{5,}/i,  // "generate 100000 words"
    /repeat.*\d{4,}/i,    // "repeat 10000 times"
    /create.*\d{5,}/i,    // "create 99999 files"
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(input)) {
      throw createError('Invalid request pattern detected', 400, 'DANGEROUS_PATTERN');
    }
  }
}

/**
 * Send message to agent
 * 
 * This is THE main agent endpoint - requires:
 * 1. JWT authentication (via jwtCheck)
 * 2. FGA permission check (agent_interact action)
 * 
 * The actual tool executions inside the agent ALSO check FGA individually.
 */
agentRouter.post(
  '/message', 
  checkFGAPermission('agent_interact'),
  async (req, res, next) => {
    try {
      const { message, sessionId } = req.body;
      const user = getUserFromToken(req);
      const fgaResult = (req as FGARequest).fgaResult;
      
      if (!user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }
      
      // Validate input before processing
      validateInput(message);
      
      logger.info('Agent message received', { 
        userId: user.userId,
        sessionId, 
        messageLength: message?.length,
        fgaAllowed: fgaResult?.allowed,
        fgaMode: fgaResult?.mode,
      });
      
      res.json({
        success: true,
        message: 'Agent endpoint ready',
        status: 'awaiting_langgraph',
        phase: 'Phase 4: LangGraph + Gemini Agent',
        fga: {
          checked: true,
          allowed: fgaResult?.allowed,
          mode: fgaResult?.mode,
        },
        user: {
          userId: user.userId,
        },
        received: {
          sessionId,
          messageLength: message?.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get agent state for current session
agentRouter.get('/state', (req, res) => {
  const user = getUserFromToken(req);
  
  res.json({
    state: 'IDLE',
    userId: user?.userId,
    phase: 'Phase 4: CIBA Integration',
    ciba: getCIBAStatus(),
  });
});

/**
 * Get pending CIBA approval requests for current user
 */
agentRouter.get('/approvals', async (req, res, next) => {
  try {
    const user = getUserFromToken(req);
    
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const pendingRequests = await getUserPendingRequests(user.userId);
    
    res.json({
      userId: user.userId,
      pending: pendingRequests.length,
      // Return as both 'requests' and 'approvals' for API consistency
      requests: pendingRequests.map(r => ({
        id: r.id,
        tool: r.tool,
        status: r.status,
        bindingMessage: r.bindingMessage,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      })),
      approvals: pendingRequests.map(r => ({
        id: r.id,
        tool: r.tool,
        status: r.status,
        bindingMessage: r.bindingMessage,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get CIBA request status
 */
agentRouter.get('/ciba/:requestId', async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const user = getUserFromToken(req);
    
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const request: CIBARequest | null = await getCIBARequestById(requestId);
    
    if (!request) {
      return res.status(404).json({ 
        error: 'CIBA request not found',
        code: 'CIBA_NOT_FOUND',
      });
    }

    // Verify user owns this request
    if (request.userId !== user.userId) {
      return res.status(403).json({ 
        error: 'Not authorized to view this request',
        code: 'CIBA_UNAUTHORIZED',
      });
    }

    // If pending, poll Auth0 for status update
    if (request.status === 'pending') {
      const pollResult = await pollCIBAStatus(request.authReqId);
      
      return res.json({
        id: request.id,
        tool: request.tool,
        status: pollResult.status,
        bindingMessage: request.bindingMessage,
        expiresAt: request.expiresAt,
        createdAt: request.createdAt,
        approvedAt: pollResult.request?.approvedAt,
        deniedAt: pollResult.request?.deniedAt,
      });
    }

    res.json({
      id: request.id,
      tool: request.tool,
      status: request.status,
      bindingMessage: request.bindingMessage,
      expiresAt: request.expiresAt,
      createdAt: request.createdAt,
      approvedAt: request.approvedAt,
      deniedAt: request.deniedAt,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Approve pending action (CIBA flow)
 * 
 * This endpoint allows manual approval for development/testing.
 * In production, approvals come from Auth0 push notifications.
 * 
 * SECURITY: Manual approval is BLOCKED in production (CIBA_STRICT_MODE=true)
 * 
 * Requires agent_approve permission
 */
agentRouter.post(
  '/approve', 
  checkFGAPermission('agent_approve'),
  async (req, res, next) => {
    try {
      const { requestId } = req.body;
      const user = getUserFromToken(req);
      
      // SECURITY: Block manual approval in production
      const strictMode = process.env.CIBA_STRICT_MODE === 'true';
      if (strictMode) {
        logger.warn('Manual CIBA approval blocked in strict mode', {
          userId: user?.userId,
          requestId,
        });
        return res.status(403).json({
          error: 'Manual approval is disabled in production',
          code: 'CIBA_MANUAL_DISABLED',
          message: 'Approvals must come through Auth0 push notifications',
        });
      }
      
      if (!user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      if (!requestId) {
        return res.status(400).json({ 
          error: 'requestId is required',
          code: 'MISSING_REQUEST_ID',
        });
      }

      const request = await getCIBARequestById(requestId);
      
      if (!request) {
        return res.status(404).json({ 
          error: 'CIBA request not found',
          code: 'CIBA_NOT_FOUND',
        });
      }

      // Verify user owns this request
      if (request.userId !== user.userId) {
        return res.status(403).json({ 
          error: 'Not authorized to approve this request',
          code: 'CIBA_UNAUTHORIZED',
        });
      }

      if (request.status !== 'pending') {
        return res.status(400).json({ 
          error: `Request already ${request.status}`,
          code: 'CIBA_ALREADY_RESOLVED',
          status: request.status,
        });
      }

      // Check if expired
      if (new Date() > request.expiresAt) {
        return res.status(400).json({ 
          error: 'Request has expired',
          code: 'CIBA_EXPIRED',
        });
      }

      // Approve the request
      const approvedRequest = await manuallyApprove(requestId);
      
      logger.info('CIBA request manually approved', {
        requestId,
        userId: user.userId,
        tool: request.tool,
      });

      res.json({
        success: true,
        message: 'Action approved',
        request: {
          id: approvedRequest?.id,
          tool: approvedRequest?.tool,
          status: 'approved',
          approvedAt: approvedRequest?.approvedAt,
        },
        // Include tool input so caller can resume execution
        toolInput: request.toolInput,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Deny pending action
 * 
 * SECURITY: Manual denial is BLOCKED in production (CIBA_STRICT_MODE=true)
 * 
 * Requires agent_deny permission
 */
agentRouter.post(
  '/deny', 
  checkFGAPermission('agent_deny'),
  async (req, res, next) => {
    try {
      const { requestId, reason } = req.body;
      const user = getUserFromToken(req);
      
      // SECURITY: Block manual denial in production
      const strictMode = process.env.CIBA_STRICT_MODE === 'true';
      if (strictMode) {
        logger.warn('Manual CIBA denial blocked in strict mode', {
          userId: user?.userId,
          requestId,
        });
        return res.status(403).json({
          error: 'Manual denial is disabled in production',
          code: 'CIBA_MANUAL_DISABLED',
          message: 'Denials must come through Auth0 push notifications',
        });
      }
      
      if (!user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      if (!requestId) {
        return res.status(400).json({ 
          error: 'requestId is required',
          code: 'MISSING_REQUEST_ID',
        });
      }

      const request = await getCIBARequestById(requestId);
      
      if (!request) {
        return res.status(404).json({ 
          error: 'CIBA request not found',
          code: 'CIBA_NOT_FOUND',
        });
      }

      // Verify user owns this request
      if (request.userId !== user.userId) {
        return res.status(403).json({ 
          error: 'Not authorized to deny this request',
          code: 'CIBA_UNAUTHORIZED',
        });
      }

      if (request.status !== 'pending') {
        return res.status(400).json({ 
          error: `Request already ${request.status}`,
          code: 'CIBA_ALREADY_RESOLVED',
          status: request.status,
        });
      }

      // Deny the request
      const deniedRequest = await manuallyDeny(requestId);
      
      logger.info('CIBA request denied', {
        requestId,
        userId: user.userId,
        tool: request.tool,
        reason,
      });

      res.json({
        success: true,
        message: 'Action denied',
        request: {
          id: deniedRequest?.id,
          tool: deniedRequest?.tool,
          status: 'denied',
          deniedAt: deniedRequest?.deniedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Cancel a pending CIBA request
 */
agentRouter.post('/cancel', async (req, res, next) => {
  try {
    const { requestId } = req.body;
    const user = getUserFromToken(req);
    
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!requestId) {
      return res.status(400).json({ 
        error: 'requestId is required',
        code: 'MISSING_REQUEST_ID',
      });
    }

    const request = await getCIBARequestById(requestId);
    
    if (!request) {
      return res.status(404).json({ 
        error: 'CIBA request not found',
        code: 'CIBA_NOT_FOUND',
      });
    }

    // Verify user owns this request
    if (request.userId !== user.userId) {
      return res.status(403).json({ 
        error: 'Not authorized to cancel this request',
        code: 'CIBA_UNAUTHORIZED',
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ 
        error: `Request already ${request.status}`,
        code: 'CIBA_ALREADY_RESOLVED',
        status: request.status,
      });
    }

    await cancelRequest(requestId);
    
    logger.info('CIBA request cancelled', {
      requestId,
      userId: user.userId,
      tool: request.tool,
    });

    res.json({
      success: true,
      message: 'Action cancelled',
      requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Execute a specific tool (direct tool invocation)
 * 
 * This endpoint allows direct tool execution with FGA and CIBA.
 * Level 5 actions require CIBA approval before execution.
 * 
 * Flow:
 * 1. Check FGA permission for tool
 * 2. If Level 5 action, initiate CIBA and return 202
 * 3. Otherwise, execute tool (or return ready status)
 */
agentRouter.post(
  '/execute/:tool',
  async (req, res, next) => {
    try {
      const { tool } = req.params;
      const { sessionId, ...toolInput } = req.body;
      const user = getUserFromToken(req);
      
      if (!user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }
      
      // Import dynamically to avoid circular deps
      const { checkPermission, requiresApproval, getActionRiskLevel } = await import('../services/fga.js');
      
      // Check FGA permission for this tool
      const fgaResult = await checkPermission(user.userId, tool);
      const riskLevel = getActionRiskLevel(tool);
      
      if (!fgaResult.allowed) {
        logger.warn('FGA denied tool execution', { 
          userId: user.userId, 
          tool,
          riskLevel,
          reason: fgaResult.reason,
          mode: fgaResult.mode,
        });
        return res.status(403).json({
          error: 'Permission denied by FGA',
          code: 'FGA_DENIED',
          tool,
          riskLevel,
          reason: fgaResult.reason,
          mode: fgaResult.mode,
        });
      }
      
      // Check if CIBA approval is required (Level 5 actions)
      if (requiresApproval(tool)) {
        logger.info('Tool requires CIBA approval', { 
          userId: user.userId, 
          tool,
          riskLevel,
        });
        
        // Generate binding message for the approval request
        const bindingMessage = generateBindingMessage(
          tool, 
          toolInput ? JSON.stringify(toolInput).slice(0, 100) : undefined
        );
        
        // Initiate CIBA request
        const cibaResult = await initiateCIBA({
          userId: user.userId,
          tool,
          sessionId: sessionId || 'default',
          bindingMessage,
          toolInput,
        });
        
        if (!cibaResult.success) {
          logger.error('CIBA initiation failed', {
            userId: user.userId,
            tool,
            error: cibaResult.error,
            errorCode: cibaResult.errorCode,
          });
          
          // If CIBA isn't configured, we can't proceed with Level 5 actions
          // This is a SECURITY CRITICAL check - never bypass CIBA for Level 5
          return res.status(503).json({
            error: 'Approval system unavailable',
            code: cibaResult.errorCode || 'CIBA_UNAVAILABLE',
            details: cibaResult.error,
            tool,
            riskLevel,
            message: 'Level 5 actions require human approval. Please try again later.',
          });
        }
        
        // Return 202 with CIBA request details
        return res.status(202).json({
          status: 'AWAITING_APPROVAL',
          message: 'This action requires human approval',
          tool,
          riskLevel,
          ciba: {
            requestId: cibaResult.requestId,
            authReqId: cibaResult.authReqId,
            expiresIn: cibaResult.expiresIn,
            pollInterval: cibaResult.pollInterval,
            bindingMessage,
          },
          instructions: [
            'A push notification has been sent to your device',
            'Approve or deny the action using biometric authentication',
            `Poll GET /api/agent/ciba/${cibaResult.requestId} for status updates`,
            'Or POST /api/agent/approve with requestId to manually approve (dev mode)',
          ],
        });
      }
      
      // For non-Level-5 actions, tool is authorized and ready to execute
      logger.info('Tool execution authorized', { 
        userId: user.userId, 
        tool,
        riskLevel,
        fgaMode: fgaResult.mode,
      });
      
      // Actual tool execution would happen here (LangGraph integration)
      // For now, return success indicating authorization passed
      res.json({
        success: true,
        tool,
        riskLevel,
        status: 'authorized',
        fga: {
          checked: true,
          allowed: true,
          mode: fgaResult.mode,
        },
        message: 'Tool execution authorized - execute via LangGraph agent',
        input: toolInput,
      });
    } catch (error) {
      next(error);
    }
  }
);
