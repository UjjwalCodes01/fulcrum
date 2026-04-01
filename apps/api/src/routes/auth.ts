import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { jwtCheck, getUserFromToken } from '../middleware/auth.js';

export const authRouter = Router();

// Get current user info (requires authentication)
authRouter.get('/me', jwtCheck, (req, res) => {
  const user = getUserFromToken(req);
  
  if (!user) {
    return res.status(401).json({ error: 'Unable to extract user info' });
  }

  logger.info('User info requested', { userId: user.userId });
  
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
authRouter.get('/status', (req, res) => {
  res.json({
    authConfigured: true,
    issuer: `https://${process.env.AUTH0_DOMAIN}`,
    audience: process.env.AUTH0_AUDIENCE || 'https://fulcrum-api',
  });
});
