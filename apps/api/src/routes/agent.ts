import { Router, IRouter } from 'express';
import { v4 as uuidv4 } from 'uuid';
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
import { getUserConnections } from '../services/token-vault.js';
import { getSessionState, saveSessionState } from '../db/sessions.js';
import {
  invokeAgent,
  getUsageStats,
  isGeminiConfigured,
  executeTool,
  type ToolName,
} from '../agent/index.js';

export const agentRouter: IRouter = Router();

// ============================================================================
// MIDDLEWARE
// ============================================================================

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
      const { message, sessionId: providedSessionId, threadId: providedThreadId } = req.body;
      const user = getUserFromToken(req);
      const fgaResult = (req as FGARequest).fgaResult;
      
      if (!user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }
      
      // Validate input before processing
      validateInput(message);
      
      // Generate session/thread IDs if not provided
      const sessionId = providedSessionId || uuidv4();
      const threadId = providedThreadId || `thread_${user.userId}_${Date.now()}`;
      
      logger.info('Agent message received', { 
        userId: user.userId,
        sessionId, 
        threadId,
        messageLength: message?.length,
        fgaAllowed: fgaResult?.allowed,
        fgaMode: fgaResult?.mode,
      });
      
      // Check if Gemini is configured
      if (!isGeminiConfigured()) {
        return res.json({
          success: false,
          error: 'Gemini AI not configured',
          status: 'unconfigured',
          message: 'The AI agent is not fully configured. Please set GCP_PROJECT_ID and Vertex AI credentials.',
          sessionId,
          threadId,
        });
      }
      
      // Get user's access token for Token Vault
      const userAccessToken = req.headers.authorization?.replace('Bearer ', '') || '';
      
      // Fetch user's connected services
      const connectionsResult = await getUserConnections(userAccessToken);
      const userConnections = connectionsResult.success && connectionsResult.connections 
        ? connectionsResult.connections  // Already an array of strings like ['github', 'slack']
        : [];
      
      logger.info('User connections fetched', {
        userId: user.userId,
        connections: userConnections,
      });
      
      // Load existing session state if available
      const existingState = await getSessionState(sessionId);
      
      // Invoke the agent graph with session continuity
      const agentState = await invokeAgent({
        sessionId,
        userId: user.userId,
        message,
        userAccessToken,
        userConnections,
        existingState: existingState || undefined,
      });
      
      // Save session state for continuity
      await saveSessionState(sessionId, agentState);
      
      // Build response based on agent state
      const response: Record<string, unknown> = {
        success: agentState.currentState !== 'ERROR',
        sessionId,
        threadId,
        state: agentState.currentState,
        fga: {
          checked: true,
          allowed: fgaResult?.allowed,
          mode: fgaResult?.mode,
        },
      };
      
      // Add state-specific fields
      if (agentState.finalResponse) {
        response.response = agentState.finalResponse;
      }
      
      if (agentState.error) {
        response.error = {
          code: agentState.error.code,
          message: agentState.error.message,
          recoverable: agentState.error.recoverable,
        };
      }
      
      if (agentState.pendingApproval) {
        response.pendingApproval = {
          requestId: agentState.pendingApproval.requestId,
          tool: agentState.pendingApproval.tool,
          bindingMessage: agentState.pendingApproval.bindingMessage,
          expiresAt: agentState.pendingApproval.expiresAt,
        };
      }
      
      if (agentState.lastToolResult) {
        response.lastToolResult = {
          toolName: agentState.lastToolResult.toolName,
          success: agentState.lastToolResult.success,
          executionTimeMs: agentState.lastToolResult.executionTimeMs,
        };
      }
      
      // Add execution history summary
      if (agentState.executionHistory.length > 0) {
        response.executionHistory = agentState.executionHistory.map(h => ({
          tool: h.tool,
          success: h.result?.success,
          fgaAllowed: h.fgaCheck?.allowed,
        }));
      }
      
      // Set appropriate status code
      const statusCode = agentState.currentState === 'AWAITING_APPROVAL' ? 202 : 
                         agentState.currentState === 'ERROR' ? 500 : 200;
      
      res.status(statusCode).json(response);
    } catch (error) {
      next(error);
    }
  }
);

// Get agent state for current session
agentRouter.get('/state', async (req, res) => {
  const user = getUserFromToken(req);
  const { sessionId, threadId } = req.query;
  
  // Get pending CIBA requests for user
  const pendingRequests = user ? await getUserPendingRequests(user.userId) : [];
  
  // Get usage stats
  const usage = getUsageStats();
  
  res.json({
    state: 'IDLE',
    userId: user?.userId,
    sessionId: sessionId || null,
    threadId: threadId || null,
    gemini: {
      configured: isGeminiConfigured(),
      usage,
    },
    ciba: {
      ...getCIBAStatus(),
      pendingRequests: pendingRequests.length,
    },
    pendingApprovals: pendingRequests.map(r => ({
      id: r.id,
      tool: r.tool,
      status: r.status,
      expiresAt: r.expiresAt,
    })),
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

      // Now execute the tool since it's approved
      const userAccessToken = req.headers.authorization?.replace('Bearer ', '') || '';
      const toolCallId = `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      
      logger.info('Executing approved tool', {
        userId: user.userId,
        tool: request.tool,
        requestId,
      });
      
      const toolResult = await executeTool(
        request.tool as ToolName,
        toolCallId,
        request.toolInput || {},
        {
          userId: user.userId,
          userAccessToken,
          sessionId: request.sessionId,
          fgaCheckPassed: true, // FGA was checked when CIBA was initiated
          cibaApproved: true, // This is the approval path
        }
      );
      
      logger.info('Approved tool execution complete', {
        userId: user.userId,
        tool: request.tool,
        success: toolResult.success,
        executionTimeMs: toolResult.executionTimeMs,
      });

      res.json({
        success: toolResult.success,
        message: 'Action approved and executed',
        request: {
          id: approvedRequest?.id,
          tool: approvedRequest?.tool,
          status: 'approved',
          approvedAt: approvedRequest?.approvedAt,
        },
        result: toolResult.result,
        error: toolResult.error,
        executionTimeMs: toolResult.executionTimeMs,
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
      
      // For non-Level-5 actions, execute the tool directly
      logger.info('Executing tool', { 
        userId: user.userId, 
        tool,
        riskLevel,
        fgaMode: fgaResult.mode,
      });
      
      // Get user's access token for Token Vault
      const userAccessToken = req.headers.authorization?.replace('Bearer ', '') || '';
      
      // Generate a unique tool call ID
      const toolCallId = `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      
      // Session ID from request or generate one
      const requestSessionId = req.body.sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      
      // Execute the tool
      const toolResult = await executeTool(
        tool as ToolName,
        toolCallId,
        toolInput,
        {
          userId: user.userId,
          userAccessToken,
          sessionId: requestSessionId,
          fgaCheckPassed: fgaResult.allowed,
          cibaApproved: false, // Non-CIBA path
        }
      );
      
      logger.info('Tool execution complete', { 
        userId: user.userId, 
        tool,
        success: toolResult.success,
        executionTimeMs: toolResult.executionTimeMs,
      });
      
      // Return result
      const statusCode = toolResult.success ? 200 : 500;
      
      res.status(statusCode).json({
        success: toolResult.success,
        tool,
        riskLevel,
        status: toolResult.success ? 'completed' : 'failed',
        fga: {
          checked: true,
          allowed: true,
          mode: fgaResult.mode,
        },
        result: toolResult.result,
        error: toolResult.error,
        executionTimeMs: toolResult.executionTimeMs,
      });
    } catch (error) {
      next(error);
    }
  }
);
