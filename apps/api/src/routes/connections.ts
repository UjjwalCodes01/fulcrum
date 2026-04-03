import { Router, Request, IRouter } from 'express';
import { jwtCheck, getUserFromToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { 
  getTokenVaultStatus, 
  exchangeForFederatedToken,
  exchangeAccessTokenForFederatedToken,
  getUserConnections,
  getManagementToken,
} from '../services/token-vault.js';
import {
  grantConnectionPermissions,
  revokeConnectionPermissions,
} from '../services/fga.js';

export const connectionsRouter: IRouter = Router();

// All connections routes require authentication
connectionsRouter.use(jwtCheck);

// Helper to extract bearer token from Authorization header
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

// Get Token Vault status and available connections
connectionsRouter.get('/status', (_req, res) => {
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

  // Get actual connected identities from Auth0
  const result = await getUserConnections(user.userId);
  
  // Return explicit error information if fetch failed
  if (!result.success) {
    return res.status(503).json({
      userId: user.userId,
      connections: [],
      availableConnections: ['github', 'slack', 'jira'],
      error: result.error,
      errorCode: result.errorCode,
      message: 'Unable to fetch connections - Management API unavailable',
    });
  }
  
  res.json({
    userId: user.userId,
    connections: result.connections,
    availableConnections: ['github', 'slack', 'jira'],
    message: result.connections.length > 0 
      ? `${result.connections.length} service(s) connected`
      : 'Connect your services to enable the security agent',
  });
});

/**
 * Exchange token for GitHub access
 * 
 * SUPPORTS TWO MODES:
 * 1. If refreshToken is provided in body → use refresh token exchange (preferred)
 * 2. If only access token in header → use access token exchange (fallback)
 * 
 * The access token exchange is the key fix - it works without refresh tokens!
 */
connectionsRouter.post('/github/token', async (req, res) => {
  const user = getUserFromToken(req);
  const { refreshToken } = req.body;
  const accessToken = extractBearerToken(req);

  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  logger.info('GitHub token exchange requested', { 
    userId: user.userId,
    hasRefreshToken: !!refreshToken,
    hasAccessToken: !!accessToken,
  });

  let result;

  // Mode 1: Refresh token exchange (preferred - if available)
  if (refreshToken) {
    logger.info('Using REFRESH TOKEN exchange flow');
    result = await exchangeForFederatedToken(refreshToken, 'github');
  } 
  // Mode 2: Access token exchange (fallback - works without refresh tokens!)
  else if (accessToken) {
    logger.info('Using ACCESS TOKEN exchange flow (fallback)');
    result = await exchangeAccessTokenForFederatedToken(accessToken, 'github');
  } 
  else {
    return res.status(400).json({ 
      error: 'Either refreshToken in body or access token in Authorization header is required',
      hint: 'Send Authorization: Bearer <access_token> header',
    });
  }

  if (!result.success) {
    return res.status(400).json({
      error: result.error,
      connection: 'github',
      exchangeMethod: refreshToken ? 'refresh_token' : 'access_token',
    });
  }

  // Grant FGA permissions for GitHub tools
  // In strict mode, this throws if it fails, causing the connection to fail
  try {
    await grantConnectionPermissions(user.userId, 'github');
    logger.info('FGA permissions granted for GitHub', { userId: user.userId });
  } catch (fgaError) {
    logger.error('Failed to grant FGA permissions - connection failed', { 
      userId: user.userId, 
      error: fgaError instanceof Error ? fgaError.message : 'Unknown error',
    });
    return res.status(500).json({
      error: 'Connection succeeded but failed to grant permissions',
      details: fgaError instanceof Error ? fgaError.message : 'Unknown error',
      connection: 'github',
      code: 'FGA_GRANT_FAILED',
    });
  }

  res.json({
    success: true,
    connection: 'github',
    expiresIn: result.expiresIn,
    accessToken: result.accessToken,
    exchangeMethod: refreshToken ? 'refresh_token' : 'access_token',
  });
});

/**
 * Exchange token for Slack access
 * Supports both refresh token and access token exchange
 */
connectionsRouter.post('/slack/token', async (req, res) => {
  const user = getUserFromToken(req);
  const { refreshToken } = req.body;
  const accessToken = extractBearerToken(req);

  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  logger.info('Slack token exchange requested', { 
    userId: user.userId,
    hasRefreshToken: !!refreshToken,
    hasAccessToken: !!accessToken,
  });

  let result;

  if (refreshToken) {
    result = await exchangeForFederatedToken(refreshToken, 'slack');
  } else if (accessToken) {
    result = await exchangeAccessTokenForFederatedToken(accessToken, 'slack');
  } else {
    return res.status(400).json({ 
      error: 'Either refreshToken in body or access token in Authorization header is required',
    });
  }

  if (!result.success) {
    return res.status(400).json({
      error: result.error,
      connection: 'slack',
      exchangeMethod: refreshToken ? 'refresh_token' : 'access_token',
    });
  }

  // Grant FGA permissions for Slack tools
  try {
    await grantConnectionPermissions(user.userId, 'slack');
    logger.info('FGA permissions granted for Slack', { userId: user.userId });
  } catch (fgaError) {
    logger.error('Failed to grant FGA permissions - connection failed', { 
      userId: user.userId, 
      error: fgaError instanceof Error ? fgaError.message : 'Unknown error',
    });
    return res.status(500).json({
      error: 'Connection succeeded but failed to grant permissions',
      details: fgaError instanceof Error ? fgaError.message : 'Unknown error',
      connection: 'slack',
      code: 'FGA_GRANT_FAILED',
    });
  }

  res.json({
    success: true,
    connection: 'slack',
    expiresIn: result.expiresIn,
    accessToken: result.accessToken,
    exchangeMethod: refreshToken ? 'refresh_token' : 'access_token',
  });
});

/**
 * Exchange token for Jira access
 * Supports both refresh token and access token exchange
 */
connectionsRouter.post('/jira/token', async (req, res) => {
  const user = getUserFromToken(req);
  const { refreshToken } = req.body;
  const accessToken = extractBearerToken(req);

  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  logger.info('Jira token exchange requested', { 
    userId: user.userId,
    hasRefreshToken: !!refreshToken,
    hasAccessToken: !!accessToken,
  });

  let result;

  if (refreshToken) {
    result = await exchangeForFederatedToken(refreshToken, 'jira');
  } else if (accessToken) {
    result = await exchangeAccessTokenForFederatedToken(accessToken, 'jira');
  } else {
    return res.status(400).json({ 
      error: 'Either refreshToken in body or access token in Authorization header is required',
    });
  }

  if (!result.success) {
    return res.status(400).json({
      error: result.error,
      connection: 'jira',
      exchangeMethod: refreshToken ? 'refresh_token' : 'access_token',
    });
  }

  // Grant FGA permissions for Jira tools
  try {
    await grantConnectionPermissions(user.userId, 'jira');
    logger.info('FGA permissions granted for Jira', { userId: user.userId });
  } catch (fgaError) {
    logger.error('Failed to grant FGA permissions - connection failed', { 
      userId: user.userId, 
      error: fgaError instanceof Error ? fgaError.message : 'Unknown error',
    });
    return res.status(500).json({
      error: 'Connection succeeded but failed to grant permissions',
      details: fgaError instanceof Error ? fgaError.message : 'Unknown error',
      connection: 'jira',
      code: 'FGA_GRANT_FAILED',
    });
  }

  res.json({
    success: true,
    connection: 'jira',
    expiresIn: result.expiresIn,
    accessToken: result.accessToken,
    exchangeMethod: refreshToken ? 'refresh_token' : 'access_token',
  });
});

// Disconnect a service (revoke access)
connectionsRouter.delete('/:connection', async (req, res) => {
  const user = getUserFromToken(req);
  const { connection } = req.params;

  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  // Validate connection type
  const validConnections = ['github', 'slack', 'jira'] as const;
  if (!validConnections.includes(connection as typeof validConnections[number])) {
    return res.status(400).json({ error: `Invalid connection: ${connection}` });
  }

  logger.info('Disconnect requested', { userId: user.userId, connection });

  // Revoke FGA permissions for this connection
  try {
    await revokeConnectionPermissions(
      user.userId, 
      connection as 'github' | 'slack' | 'jira'
    );
    logger.info('FGA permissions revoked', { userId: user.userId, connection });
  } catch (fgaError) {
    logger.error('Failed to revoke FGA permissions - disconnect failed', { 
      userId: user.userId, 
      connection,
      error: fgaError instanceof Error ? fgaError.message : 'Unknown error',
    });
    return res.status(500).json({
      error: 'Failed to revoke permissions',
      details: fgaError instanceof Error ? fgaError.message : 'Unknown error',
      connection,
      code: 'FGA_REVOKE_FAILED',
    });
  }

  // Unlink Auth0 identity using Management API
  // This requires fetching the user's identities first to get the correct secondary identity
  try {
    const mgmtToken = await getManagementToken();
    
    // First, fetch the user's identities to find the one to unlink
    const userResponse = await fetch(
      `https://${process.env.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(user.userId)}`,
      {
        headers: {
          'Authorization': `Bearer ${mgmtToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!userResponse.ok) {
      throw new Error(`Failed to fetch user: ${userResponse.status}`);
    }

    const userData = await userResponse.json() as {
      identities?: Array<{ 
        provider: string; 
        user_id: string; 
        connection: string;
        isSocial: boolean;
      }>;
    };

    // Find the secondary identity that matches the connection we're unlinking
    // The primary identity is the first one; secondary identities can be unlinked
    const identities = userData.identities || [];
    
    if (identities.length <= 1) {
      logger.info('No secondary identity to unlink - user has single identity', { 
        userId: user.userId, 
        connection 
      });
      // FGA permissions already revoked, just return success
    } else {
      // Find the identity matching this connection (not the primary)
      const identityToUnlink = identities.find((identity, index) => 
        index > 0 && // Skip primary identity (index 0)
        (identity.provider === connection || identity.connection === connection)
      );

      if (identityToUnlink) {
        // Unlink the secondary identity using its provider and user_id
        const unlinkResponse = await fetch(
          `https://${process.env.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(user.userId)}/identities/${identityToUnlink.provider}/${identityToUnlink.user_id}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${mgmtToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!unlinkResponse.ok) {
          const errorText = await unlinkResponse.text();
          // Unlink failure is now FATAL - we need consistency
          logger.error('Auth0 identity unlink failed', { 
            userId: user.userId,
            connection,
            provider: identityToUnlink.provider,
            identityUserId: identityToUnlink.user_id,
            status: unlinkResponse.status,
            error: errorText,
          });
          
          // Re-grant FGA permissions since unlink failed
          try {
            await grantConnectionPermissions(
              user.userId,
              connection as 'github' | 'slack' | 'jira'
            );
            logger.warn('Rolled back FGA revocation after unlink failure', {
              userId: user.userId,
              connection,
            });
          } catch (rollbackError) {
            logger.error('Failed to rollback FGA revocation', {
              userId: user.userId,
              connection,
              error: rollbackError instanceof Error ? rollbackError.message : 'Unknown',
            });
          }

          return res.status(500).json({
            error: 'Failed to unlink identity from Auth0',
            details: errorText,
            connection,
            code: 'AUTH0_UNLINK_FAILED',
          });
        }
        
        logger.info('Auth0 identity unlinked', { 
          userId: user.userId, 
          connection,
          provider: identityToUnlink.provider,
        });
      } else {
        logger.info('No matching secondary identity found to unlink', { 
          userId: user.userId, 
          connection,
          identityCount: identities.length,
        });
      }
    }
  } catch (auth0Error) {
    logger.error('Auth0 identity unlink error', { 
      userId: user.userId,
      connection,
      error: auth0Error instanceof Error ? auth0Error.message : 'Unknown error',
    });
    
    // Auth0 unlink failure is now FATAL
    // Attempt to rollback FGA revocation
    try {
      await grantConnectionPermissions(
        user.userId,
        connection as 'github' | 'slack' | 'jira'
      );
      logger.warn('Rolled back FGA revocation after Auth0 error', {
        userId: user.userId,
        connection,
      });
    } catch (rollbackError) {
      logger.error('Failed to rollback FGA revocation', {
        userId: user.userId,
        connection,
        error: rollbackError instanceof Error ? rollbackError.message : 'Unknown',
      });
    }

    return res.status(500).json({
      error: 'Failed to unlink identity - connection restored',
      details: auth0Error instanceof Error ? auth0Error.message : 'Unknown error',
      connection,
      code: 'AUTH0_UNLINK_ERROR',
    });
  }

  res.json({
    success: true,
    message: `Disconnected ${connection}`,
    userId: user.userId,
  });
});
