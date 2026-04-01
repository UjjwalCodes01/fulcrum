import { Router } from 'express';
import { jwtCheck, getUserFromToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { 
  getTokenVaultStatus, 
  exchangeForFederatedToken,
  type FederatedConnection 
} from '../services/token-vault.js';

export const connectionsRouter = Router();

// All connections routes require authentication
connectionsRouter.use(jwtCheck);

// Get Token Vault status and available connections
connectionsRouter.get('/status', (req, res) => {
  const status = getTokenVaultStatus();
  res.json(status);
});

// List user's connected services
connectionsRouter.get('/', async (req, res) => {
  const user = getUserFromToken(req);
  
  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  logger.info('Fetching user connections', { userId: user.userId });

  // For now, return placeholder - in production, query Auth0 for linked identities
  res.json({
    userId: user.userId,
    connections: [],
    availableConnections: ['github', 'slack', 'jira'],
    message: 'Connect your services to enable the security agent',
  });
});

// Exchange token for GitHub access
connectionsRouter.post('/github/token', async (req, res) => {
  const user = getUserFromToken(req);
  const { refreshToken } = req.body;

  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  logger.info('GitHub token exchange requested', { userId: user.userId });

  const result = await exchangeForFederatedToken(refreshToken, 'github');

  if (!result.success) {
    return res.status(400).json({
      error: result.error,
      connection: 'github',
    });
  }

  res.json({
    success: true,
    connection: 'github',
    expiresIn: result.expiresIn,
    accessToken: result.accessToken,
  });
    accessToken: result.accessToken,
  });
});

// Exchange token for Slack access
connectionsRouter.post('/slack/token', async (req, res) => {
  const user = getUserFromToken(req);
  const { refreshToken } = req.body;

  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  logger.info('Slack token exchange requested', { userId: user.userId });

  const result = await exchangeForFederatedToken(refreshToken, 'slack');

  if (!result.success) {
    return res.status(400).json({
      error: result.error,
      connection: 'slack',
    });
  }

  res.json({
    success: true,
    connection: 'slack',
    expiresIn: result.expiresIn,
    accessToken: result.accessToken,
  });
});

// Exchange token for Jira access
connectionsRouter.post('/jira/token', async (req, res) => {
  const user = getUserFromToken(req);
  const { refreshToken } = req.body;

  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  logger.info('Jira token exchange requested', { userId: user.userId });

  const result = await exchangeForFederatedToken(refreshToken, 'jira');

  if (!result.success) {
    return res.status(400).json({
      error: result.error,
      connection: 'jira',
    });
  }

  res.json({
    success: true,
    connection: 'jira',
    expiresIn: result.expiresIn,
    accessToken: result.accessToken,
  });
});

// Disconnect a service (revoke access)
connectionsRouter.delete('/:connection', async (req, res) => {
  const user = getUserFromToken(req);
  const { connection } = req.params;

  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  logger.info('Disconnect requested', { userId: user.userId, connection });

  // TODO: In production, call Auth0 Management API to unlink the identity
  res.json({
    success: true,
    message: `Disconnected ${connection}`,
    userId: user.userId,
  });
});
