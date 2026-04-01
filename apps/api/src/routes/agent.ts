import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { createError } from '../utils/error-handler.js';
import { jwtCheck, getUserFromToken } from '../middleware/auth.js';

export const agentRouter = Router();

// All agent routes require authentication
agentRouter.use(jwtCheck);

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

// Send message to agent (requires authentication)
agentRouter.post('/message', async (req, res, next) => {
  try {
    const { message, sessionId } = req.body;
    const user = getUserFromToken(req);
    
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    // Validate input before processing
    validateInput(message);
    
    logger.info('Agent message received', { 
      userId: user.userId,
      sessionId, 
      messageLength: message?.length 
    });
    
    res.json({
      success: true,
      message: 'Agent endpoint ready',
      status: 'awaiting_langgraph',
      phase: 'Phase 4: LangGraph + Gemini Agent',
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
});

// Get agent state for current session
agentRouter.get('/state', (req, res) => {
  const user = getUserFromToken(req);
  
  res.json({
    state: 'IDLE',
    userId: user?.userId,
    phase: 'Phase 4: LangGraph + Gemini Agent',
    status: 'awaiting_langgraph',
  });
});

// Approve pending action (for CIBA flow)
agentRouter.post('/approve', (req, res) => {
  const user = getUserFromToken(req);
  logger.info('Action approval received', { userId: user?.userId });
  
  res.json({
    message: 'Approval endpoint ready',
    userId: user?.userId,
    phase: 'Phase 3: CIBA Integration',
    status: 'awaiting_ciba',
  });
});

// Deny pending action
agentRouter.post('/deny', (req, res) => {
  const user = getUserFromToken(req);
  logger.info('Action denied', { userId: user?.userId });
  
  res.json({
    message: 'Denial endpoint ready',
    userId: user?.userId,
    phase: 'Phase 3: CIBA Integration',
    status: 'awaiting_ciba',
  });
});
