import { Router, IRouter } from 'express';
import { logger } from '../utils/logger.js';
import { jwtCheck, getUserFromToken } from '../middleware/auth.js';
import { grantAgentPermissions } from '../services/fga.js';

export const authRouter: IRouter = Router();

// Get current user info (requires authentication)
// Also ensures agent permissions are granted
authRouter.get('/me', jwtCheck, async (req, res) => {
  const user = getUserFromToken(req);
  
  if (!user) {
    return res.status(401).json({ error: 'Unable to extract user info' });
  }

  logger.info('User info requested', { userId: user.userId });
  
  // Grant agent permissions if not already granted
  // This ensures every authenticated user can interact with the agent
  try {
    await grantAgentPermissions(user.userId);
  } catch (error) {
    logger.warn('Failed to grant agent permissions', { 
      userId: user.userId, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    // Don't fail the request - FGA might not be configured
  }
  
  res.json({
    userId: user.userId,
    email: user.email,
    authenticated: true,
    // Token payload info
    permissions: req.auth?.payload?.permissions || [],
    scope: req.auth?.payload?.scope,
    tokenExpiry: req.auth?.payload?.exp,
  });
});

// Health check (no auth required)
authRouter.get('/status', (_req, res) => {
  res.json({
    authConfigured: true,
    issuer: `https://${process.env.AUTH0_DOMAIN}`,
    audience: process.env.AUTH0_AUDIENCE || 'https://fulcrum-api',
  });
});
