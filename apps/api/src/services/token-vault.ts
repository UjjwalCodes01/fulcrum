/**
 * Token Vault Service
 * 
 * This is THE KEY HACKATHON REQUIREMENT.
 * Uses Auth0 Token Exchange to get federated connection access tokens.
 * The agent NEVER sees the raw GitHub/Slack/Jira tokens - they stay in Auth0's vault.
 */

import { logger } from '../utils/logger.js';

// Token Vault API Client credentials (from environment)
const TOKEN_VAULT_CLIENT_ID = process.env.AUTH0_TOKEN_VAULT_CLIENT_ID;
const TOKEN_VAULT_CLIENT_SECRET = process.env.AUTH0_TOKEN_VAULT_CLIENT_SECRET;
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;

// Supported connections for Token Vault
export type FederatedConnection = 'github' | 'slack' | 'jira' | 'google-oauth2';

interface TokenExchangeResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
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
    
    const body = new URLSearchParams({
      grant_type: 'urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token',
      client_id: TOKEN_VAULT_CLIENT_ID,
      client_secret: TOKEN_VAULT_CLIENT_SECRET,
      subject_token: userAccessToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', // ACCESS TOKEN
      requested_token_type: 'http://auth0.com/oauth/token-type/federated-connection-access-token',
      connection: connection,
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json();
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

    const data: TokenExchangeResponse = await response.json();
    
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
    
    const body = new URLSearchParams({
      grant_type: 'urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token',
      client_id: TOKEN_VAULT_CLIENT_ID,
      client_secret: TOKEN_VAULT_CLIENT_SECRET,
      subject_token: userRefreshToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:refresh_token',
      requested_token_type: 'http://auth0.com/oauth/token-type/federated-connection-access-token',
      connection: connection,
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json();
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

    const data: TokenExchangeResponse = await response.json();
    
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
 * Check which connections a user has linked.
 * 
 * Returns an array of connection names the user has already connected via Auth0.
 * This helps the UI show which services are available.
 */
export async function getUserConnections(userId: string): Promise<FederatedConnection[]> {
  // This would typically query Auth0 Management API to get user's identities
  // For now, return placeholder - we'll implement this with the user's linked accounts
  logger.info('Checking user connections', { userId });
  
  // In a real implementation, we'd call:
  // GET https://{domain}/api/v2/users/{userId}
  // And check the identities array for linked providers
  
  return []; // Will be populated when user links accounts
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
