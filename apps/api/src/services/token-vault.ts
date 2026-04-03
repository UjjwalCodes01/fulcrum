/**
 * Token Vault Service
 * 
 * This is THE KEY HACKATHON REQUIREMENT.
 * Uses Auth0 Token Exchange to get federated connection access tokens.
 * The agent NEVER sees the raw GitHub/Slack/Jira tokens - they stay in Auth0's vault.
 */

import { logger } from '../utils/logger.js';

// Token Vault API Client credentials (from environment)
const TOKEN_VAULT_CLIENT_ID = process.env.AUTH0_TOKEN_VAULT_CLIENT_ID || '';
const TOKEN_VAULT_CLIENT_SECRET = process.env.AUTH0_TOKEN_VAULT_CLIENT_SECRET || '';
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || '';

// Supported connections for Token Vault
export type FederatedConnection = 'github' | 'slack' | 'jira' | 'google-oauth2';

interface TokenExchangeResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

interface Auth0ErrorResponse {
  error?: string;
  error_description?: string;
}

interface TokenVaultResult {
  success: boolean;
  accessToken?: string;
  error?: string;
  connection: FederatedConnection;
  expiresIn?: number;
}

/**
 * Exchange an Auth0 access token for a federated connection access token.
 * 
 * This is the ACCESS TOKEN exchange flow (for SPAs/frontend apps).
 * 
 * @param userAccessToken - The user's Auth0 access token (JWT)
 * @param connection - Which federated connection to get a token for
 * @returns The access token for the requested connection
 */
export async function exchangeAccessTokenForFederatedToken(
  userAccessToken: string,
  connection: FederatedConnection
): Promise<TokenVaultResult> {
  logger.info('Token Vault: Initiating ACCESS TOKEN exchange', { connection });

  try {
    const tokenEndpoint = `https://${AUTH0_DOMAIN}/oauth/token`;
    
    const body = new URLSearchParams();
    body.append('grant_type', 'urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token');
    body.append('client_id', TOKEN_VAULT_CLIENT_ID);
    body.append('client_secret', TOKEN_VAULT_CLIENT_SECRET);
    body.append('subject_token', userAccessToken);
    body.append('subject_token_type', 'urn:ietf:params:oauth:token-type:access_token');
    body.append('requested_token_type', 'http://auth0.com/oauth/token-type/federated-connection-access-token');
    body.append('connection', connection);

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json() as Auth0ErrorResponse;
      logger.error('Token Vault: Access token exchange failed', { 
        connection, 
        error: errorData.error,
        description: errorData.error_description 
      });
      
      return {
        success: false,
        error: errorData.error_description || errorData.error || 'Access token exchange failed',
        connection,
      };
    }

    const data = await response.json() as TokenExchangeResponse;
    
    logger.info('Token Vault: Access token exchange successful', { 
      connection, 
      expiresIn: data.expires_in 
    });

    return {
      success: true,
      accessToken: data.access_token,
      connection,
      expiresIn: data.expires_in,
    };

  } catch (error) {
    logger.error('Token Vault: Access token exchange error', { connection, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      connection,
    };
  }
}

/**
 * Exchange an Auth0 refresh token for a federated connection access token.
 * 
 * This is the core Token Vault functionality:
 * 1. User logs in and gets an Auth0 refresh token
 * 2. Backend exchanges that refresh token for a GitHub/Slack/etc access token
 * 3. The original service's token is NEVER exposed to the AI agent
 * 
 * @param userRefreshToken - The user's Auth0 refresh token
 * @param connection - Which federated connection to get a token for
 * @returns The access token for the requested connection
 */
export async function exchangeForFederatedToken(
  userRefreshToken: string,
  connection: FederatedConnection
): Promise<TokenVaultResult> {
  logger.info('Token Vault: Initiating token exchange', { connection });

  try {
    // RFC 8693 Token Exchange request
    const tokenEndpoint = `https://${AUTH0_DOMAIN}/oauth/token`;
    
    const body = new URLSearchParams();
    body.append('grant_type', 'urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token');
    body.append('client_id', TOKEN_VAULT_CLIENT_ID);
    body.append('client_secret', TOKEN_VAULT_CLIENT_SECRET);
    body.append('subject_token', userRefreshToken);
    body.append('subject_token_type', 'urn:ietf:params:oauth:token-type:refresh_token');
    body.append('requested_token_type', 'http://auth0.com/oauth/token-type/federated-connection-access-token');
    body.append('connection', connection);

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json() as Auth0ErrorResponse;
      logger.error('Token Vault: Exchange failed', { 
        connection, 
        error: errorData.error,
        description: errorData.error_description 
      });
      
      return {
        success: false,
        error: errorData.error_description || errorData.error || 'Token exchange failed',
        connection,
      };
    }

    const data = await response.json() as TokenExchangeResponse;
    
    logger.info('Token Vault: Exchange successful', { 
      connection, 
      expiresIn: data.expires_in 
    });

    return {
      success: true,
      accessToken: data.access_token,
      connection,
      expiresIn: data.expires_in,
    };

  } catch (error) {
    logger.error('Token Vault: Exchange error', { connection, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      connection,
    };
  }
}

/**
 * Get a GitHub access token from Token Vault.
 * 
 * Use Case: Agent needs to audit repos, create PRs, read code
 * The agent calls this, gets a short-lived token, uses it for GitHub API calls.
 */
export async function getGitHubToken(userRefreshToken: string): Promise<TokenVaultResult> {
  return exchangeForFederatedToken(userRefreshToken, 'github');
}

/**
 * Get a Slack access token from Token Vault.
 * 
 * Use Case: Agent needs to send alerts, read channels, post messages
 */
export async function getSlackToken(userRefreshToken: string): Promise<TokenVaultResult> {
  return exchangeForFederatedToken(userRefreshToken, 'slack');
}

/**
 * Get a Jira access token from Token Vault.
 * 
 * Use Case: Agent needs to create tickets, read issues, update status
 */
export async function getJiraToken(userRefreshToken: string): Promise<TokenVaultResult> {
  return exchangeForFederatedToken(userRefreshToken, 'jira');
}

/**
 * Get Auth0 Management API token
 * 
 * Uses M2M client credentials to get a token for Management API calls.
 */
let cachedMgmtToken: { token: string; expiresAt: number } | null = null;

export async function getManagementToken(): Promise<string> {
  // Check cache
  if (cachedMgmtToken && cachedMgmtToken.expiresAt > Date.now()) {
    return cachedMgmtToken.token;
  }

  const mgmtClientId = process.env.AUTH0_MGMT_CLIENT_ID;
  const mgmtClientSecret = process.env.AUTH0_MGMT_CLIENT_SECRET;

  if (!mgmtClientId || !mgmtClientSecret) {
    throw new Error('Auth0 Management API credentials not configured');
  }

  try {
    const response = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: mgmtClientId,
        client_secret: mgmtClientSecret,
        audience: `https://${AUTH0_DOMAIN}/api/v2/`,
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) {
      throw new Error(`Management API token request failed: ${response.status}`);
    }

    const data = await response.json() as TokenExchangeResponse;
    
    // Cache with 5 minute buffer
    cachedMgmtToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 300) * 1000,
    };

    return data.access_token;
  } catch (error) {
    logger.error('Failed to get Management API token', { error });
    throw error;
  }
}

/**
 * Result type for getUserConnections
 * Provides explicit error information instead of silently returning empty array
 */
export interface GetConnectionsResult {
  success: boolean;
  connections: FederatedConnection[];
  error?: string;
  errorCode?: 'MGMT_API_NOT_CONFIGURED' | 'MGMT_API_TOKEN_FAILED' | 'USER_FETCH_FAILED' | 'UNKNOWN_ERROR';
}

/**
 * Check which connections a user has linked.
 * 
 * Returns an array of connection names the user has already connected via Auth0.
 * This helps the UI show which services are available.
 * 
 * IMPORTANT: Returns explicit error information instead of silently returning empty array.
 * Callers MUST check result.success before trusting result.connections.
 */
export async function getUserConnections(userId: string): Promise<GetConnectionsResult> {
  // Check Management API configuration first
  const mgmtClientId = process.env.AUTH0_MGMT_CLIENT_ID;
  const mgmtClientSecret = process.env.AUTH0_MGMT_CLIENT_SECRET;

  if (!mgmtClientId || !mgmtClientSecret || !AUTH0_DOMAIN) {
    logger.warn('Management API not configured - cannot fetch user connections', { userId });
    return {
      success: false,
      connections: [],
      error: 'Auth0 Management API not configured',
      errorCode: 'MGMT_API_NOT_CONFIGURED',
    };
  }

  try {
    const mgmtToken = await getManagementToken();
    
    const response = await fetch(
      `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}`,
      {
        headers: {
          'Authorization': `Bearer ${mgmtToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Failed to fetch user identities', { 
        userId, 
        status: response.status,
        error: errorText,
      });
      return {
        success: false,
        connections: [],
        error: `Auth0 API returned ${response.status}: ${errorText}`,
        errorCode: 'USER_FETCH_FAILED',
      };
    }

    const user = await response.json() as {
      identities?: Array<{ connection: string; provider: string }>;
    };

    // Map Auth0 identities to our connection types
    const connections: FederatedConnection[] = [];
    const identities = user.identities || [];

    for (const identity of identities) {
      // Map provider/connection names to our types
      if (identity.provider === 'github' || identity.connection === 'github') {
        connections.push('github');
      } else if (identity.provider === 'slack' || identity.connection === 'slack') {
        connections.push('slack');
      } else if (identity.provider === 'jira' || identity.connection === 'jira') {
        connections.push('jira');
      } else if (identity.provider === 'google-oauth2' || identity.connection === 'google-oauth2') {
        connections.push('google-oauth2');
      }
    }

    logger.info('User connections fetched', { userId, connections });
    return {
      success: true,
      connections,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error fetching user connections', { userId, error: errorMessage });
    
    // Distinguish between token errors and other errors
    if (errorMessage.includes('Management API')) {
      return {
        success: false,
        connections: [],
        error: errorMessage,
        errorCode: 'MGMT_API_TOKEN_FAILED',
      };
    }
    
    return {
      success: false,
      connections: [],
      error: errorMessage,
      errorCode: 'UNKNOWN_ERROR',
    };
  }
}

/**
 * Token Vault Status - for health checks and debugging
 */
export function getTokenVaultStatus(): {
  configured: boolean;
  domain: string;
  clientConfigured: boolean;
  supportedConnections: FederatedConnection[];
} {
  return {
    configured: Boolean(AUTH0_DOMAIN && TOKEN_VAULT_CLIENT_ID && TOKEN_VAULT_CLIENT_SECRET),
    domain: AUTH0_DOMAIN,
    clientConfigured: Boolean(TOKEN_VAULT_CLIENT_ID && TOKEN_VAULT_CLIENT_SECRET),
    supportedConnections: ['github', 'slack', 'jira', 'google-oauth2'],
  };
}
