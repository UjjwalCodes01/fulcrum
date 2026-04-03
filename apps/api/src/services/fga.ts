/**
 * FGA (Fine-Grained Authorization) Service
 * 
 * This is a KEY HACKATHON REQUIREMENT - Auth0 FGA for Zero-Trust.
 * Uses OpenFGA SDK to check permissions before EVERY agent action.
 * 
 * The agent MUST prove it has permission via FGA before executing ANY tool.
 * 
 * FGA Model Concepts:
 * - user: A person who can authenticate
 * - agent: The AI agent (fulcrum) that acts on behalf of users
 * - action: A specific tool/operation (github_list_repos, jira_create_issue, etc.)
 */

import { OpenFgaClient, CredentialsMethod } from '@openfga/sdk';
import { logger } from '../utils/logger.js';

// FGA Configuration from environment
const FGA_API_URL = process.env.AUTH0_FGA_API_URL || 'https://api.us1.fga.dev';
const FGA_STORE_ID = process.env.AUTH0_FGA_STORE_ID || '';
const FGA_MODEL_ID = process.env.AUTH0_FGA_MODEL_ID || '';
const FGA_CLIENT_ID = process.env.AUTH0_FGA_CLIENT_ID || '';
const FGA_CLIENT_SECRET = process.env.AUTH0_FGA_CLIENT_SECRET || '';

// Strict mode - when true, deny if FGA not configured (production)
// When false, allow if FGA not configured (development)
const FGA_STRICT_MODE = process.env.FGA_STRICT_MODE === 'true' || process.env.NODE_ENV === 'production';

// Actions that ALWAYS require CIBA approval (Level 5 - destructive)
const CIBA_REQUIRED_ACTIONS = [
  'github_merge_pr',
  'github_delete_branch',
  'github_delete_repo',
  'jira_delete_issue',
  'slack_invite_user',
] as const;

// Tool risk levels (1-5)
export const TOOL_RISK_LEVELS: Record<string, number> = {
  // GitHub - Level 1 (Read)
  github_list_repos: 1,
  github_get_repo: 1,
  github_read_file: 1,
  // GitHub - Level 2 (Search)
  github_scan_secrets: 2,
  github_search_code: 2,
  // GitHub - Level 3 (Create)
  github_create_issue: 3,
  github_create_branch: 3,
  // GitHub - Level 4 (Update)
  github_create_pr: 4,
  github_update_issue: 4,
  // GitHub - Level 5 (Destructive - requires CIBA)
  github_merge_pr: 5,
  github_delete_branch: 5,
  github_delete_repo: 5,

  // Jira - Level 1 (Read)
  jira_list_projects: 1,
  jira_get_issue: 1,
  // Jira - Level 2 (Search)
  jira_search_issues: 2,
  // Jira - Level 3 (Create)
  jira_create_issue: 3,
  // Jira - Level 4 (Update)
  jira_update_issue: 4,
  jira_transition_issue: 4,
  // Jira - Level 5 (Destructive - requires CIBA)
  jira_delete_issue: 5,

  // Slack - Level 1 (Read)
  slack_list_channels: 1,
  slack_get_channel: 1,
  // Slack - Level 2 (Search)
  slack_search_messages: 2,
  // Slack - Level 3 (Create)
  slack_send_message: 3,
  slack_post_alert: 3,
  // Slack - Level 4 (Update)
  slack_update_message: 4,
  // Slack - Level 5 (Destructive - requires CIBA)
  slack_invite_user: 5,
  slack_remove_user: 5,

  // Agent Actions - These are granted automatically for authenticated users
  agent_interact: 1,  // Basic agent interaction
  agent_approve: 2,   // Approve pending actions
  agent_deny: 2,      // Deny pending actions
};

// Result types
export interface FGACheckResult {
  allowed: boolean;
  reason?: string;
  cached?: boolean;
  checkDurationMs?: number;
  mode?: 'strict' | 'permissive';
}

export interface FGAWriteResult {
  success: boolean;
  error?: string;
}

// Simple permission cache (in production, use Redis)
const permissionCache = new Map<string, { result: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

/**
 * Create FGA client instance
 * Uses API token auth for simplicity in hackathon
 */
function createFGAClient(): OpenFgaClient | null {
  if (!FGA_STORE_ID) {
    logger.warn('FGA not configured - FGA_STORE_ID missing');
    return null;
  }

  try {
    // If we have client credentials, use OAuth
    if (FGA_CLIENT_ID && FGA_CLIENT_SECRET) {
      return new OpenFgaClient({
        apiUrl: FGA_API_URL,
        storeId: FGA_STORE_ID,
        authorizationModelId: FGA_MODEL_ID || undefined,
        credentials: {
          method: CredentialsMethod.ClientCredentials,
          config: {
            apiTokenIssuer: 'fga.us.auth0.com',
            apiAudience: 'https://api.us1.fga.dev/',
            clientId: FGA_CLIENT_ID,
            clientSecret: FGA_CLIENT_SECRET,
          },
        },
      });
    }

    // Fallback: no auth (for local dev with mock)
    return new OpenFgaClient({
      apiUrl: FGA_API_URL,
      storeId: FGA_STORE_ID,
      authorizationModelId: FGA_MODEL_ID || undefined,
    });
  } catch (error) {
    logger.error('Failed to create FGA client', { error });
    return null;
  }
}

// Lazy-initialized client
let fgaClient: OpenFgaClient | null = null;

function getClient(): OpenFgaClient | null {
  if (!fgaClient) {
    fgaClient = createFGAClient();
  }
  return fgaClient;
}

/**
 * Check if a user has permission to execute an action
 * 
 * This is THE core FGA check - called before EVERY tool execution.
 * 
 * @param userId - The user's Auth0 sub (e.g., "github|12345")
 * @param action - The action/tool name (e.g., "github_list_repos")
 * @returns Whether the action is allowed
 */
export async function checkPermission(
  userId: string,
  action: string
): Promise<FGACheckResult> {
  const startTime = Date.now();
  const cacheKey = `${userId}:${action}`;

  // Check cache first
  const cached = permissionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    logger.debug('FGA check: cache hit', { userId, action, allowed: cached.result });
    return {
      allowed: cached.result,
      cached: true,
      checkDurationMs: Date.now() - startTime,
    };
  }

  const client = getClient();

  // Handle unconfigured FGA based on strict mode
  if (!client) {
    if (FGA_STRICT_MODE) {
      logger.error('FGA not configured - DENYING in strict mode', { userId, action });
      return {
        allowed: false,
        reason: 'FGA not configured - strict mode denies all',
        checkDurationMs: Date.now() - startTime,
        mode: 'strict',
      };
    } else {
      logger.warn('FGA not configured - allowing in dev mode (set FGA_STRICT_MODE=true to enforce)', { userId, action });
      return {
        allowed: true,
        reason: 'FGA not configured - dev mode permissive',
        checkDurationMs: Date.now() - startTime,
        mode: 'permissive',
      };
    }
  }

  try {
    // Build the FGA tuple - MUST match model.fga format
    // Format: user:userId can_execute action:actionName
    const checkRequest = {
      user: `user:${userId}`,
      relation: 'can_execute',
      object: `action:${action}`,
    };

    logger.info('FGA permission check', { 
      userId, 
      action,
      tuple: checkRequest,
      strictMode: FGA_STRICT_MODE,
    });

    const response = await client.check(checkRequest);
    const allowed = response.allowed || false;

    // Cache the result
    permissionCache.set(cacheKey, {
      result: allowed,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    const duration = Date.now() - startTime;
    logger.info('FGA check result', { 
      userId, 
      action, 
      allowed, 
      durationMs: duration,
    });

    return {
      allowed,
      reason: allowed ? undefined : 'FGA check denied - no permission tuple exists',
      checkDurationMs: duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('FGA check failed', { userId, action, error, durationMs: duration });

    // On FGA errors, DENY by default (fail-secure)
    return {
      allowed: false,
      reason: `FGA check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      checkDurationMs: duration,
    };
  }
}

/**
 * Check if an action requires CIBA (human approval)
 * 
 * Level 5 actions (destructive) ALWAYS require approval.
 * This is the "Human-in-the-Loop" part of Zero-Trust.
 */
export function requiresApproval(action: string): boolean {
  // Check if it's in the explicit CIBA-required list
  if ((CIBA_REQUIRED_ACTIONS as readonly string[]).includes(action)) {
    return true;
  }

  // Check risk level - Level 5 always requires approval
  const riskLevel = TOOL_RISK_LEVELS[action];
  return riskLevel === 5;
}

/**
 * Get the risk level for an action
 */
export function getActionRiskLevel(action: string): number {
  return TOOL_RISK_LEVELS[action] || 3; // Default to Level 3 if unknown
}

/**
 * Add a permission tuple (grant access)
 * 
 * Used when:
 * - User connects a new service
 * - Admin grants access to an action
 * - Project owner adds a team member
 */
export async function addPermission(
  userId: string,
  relation: string,
  object: string
): Promise<FGAWriteResult> {
  const client = getClient();

  if (!client) {
    logger.warn('FGA not configured - skipping write');
    return { success: true }; // Dev mode - pretend it worked
  }

  try {
    await client.write({
      writes: [
        {
          user: `user:${userId}`,
          relation,
          object,
        },
      ],
    });

    logger.info('FGA permission added', { userId, relation, object });

    // Invalidate cache for this user
    for (const key of permissionCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        permissionCache.delete(key);
      }
    }

    return { success: true };
  } catch (error) {
    logger.error('FGA write failed', { userId, relation, object, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Remove a permission tuple (revoke access)
 */
export async function removePermission(
  userId: string,
  relation: string,
  object: string
): Promise<FGAWriteResult> {
  const client = getClient();

  if (!client) {
    logger.warn('FGA not configured - skipping delete');
    return { success: true };
  }

  try {
    await client.write({
      deletes: [
        {
          user: `user:${userId}`,
          relation,
          object,
        },
      ],
    });

    logger.info('FGA permission removed', { userId, relation, object });

    // Invalidate cache
    for (const key of permissionCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        permissionCache.delete(key);
      }
    }

    return { success: true };
  } catch (error) {
    logger.error('FGA delete failed', { userId, relation, object, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Grant core agent permissions to a user
 * 
 * Called automatically on first authentication to grant basic agent interaction.
 * These permissions are required for ANY agent use.
 */
export async function grantAgentPermissions(
  userId: string
): Promise<FGAWriteResult> {
  const client = getClient();

  if (!client) {
    if (FGA_STRICT_MODE) {
      const error = 'FGA not configured - cannot grant agent permissions in strict mode';
      logger.error(error, { userId });
      throw new Error(error);
    }
    logger.warn('FGA not configured - skipping agent permission grant (dev mode allows all)');
    return { success: true };
  }

  const agentActions = ['agent_interact', 'agent_approve', 'agent_deny'];

  try {
    const writes = agentActions.map(action => ({
      user: `user:${userId}`,
      relation: 'can_execute',
      object: `action:${action}`,
    }));

    await client.write({ writes });

    logger.info('FGA agent permissions granted', { 
      userId, 
      actionCount: agentActions.length,
    });

    // Invalidate cache
    agentActions.forEach(action => {
      permissionCache.delete(`${userId}:${action}`);
    });

    return { success: true };
  } catch (error) {
    logger.error('FGA agent permission grant failed', { userId, error });
    
    if (FGA_STRICT_MODE) {
      throw error; // Propagate in strict mode
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Grant user permissions for all actions of a connection type
 * 
 * Called when user connects a service (GitHub, Slack, Jira)
 * 
 * @throws Error if FGA write fails in strict mode
 */
export async function grantConnectionPermissions(
  userId: string,
  connectionType: 'github' | 'slack' | 'jira'
): Promise<FGAWriteResult> {
  const client = getClient();

  if (!client) {
    if (FGA_STRICT_MODE) {
      const error = 'FGA not configured - cannot grant permissions in strict mode';
      logger.error(error, { userId, connectionType });
      throw new Error(error);
    }
    logger.warn('FGA not configured - skipping connection grant');
    return { success: true };
  }

  // Get all actions for this connection type
  const actions = Object.keys(TOOL_RISK_LEVELS).filter(action => 
    action.startsWith(`${connectionType}_`)
  );

  if (actions.length === 0) {
    logger.warn('No actions found for connection type', { connectionType });
    return { success: true };
  }

  try {
    // Batch write all permissions
    const writes = actions.map(action => ({
      user: `user:${userId}`,
      relation: 'can_execute',
      object: `action:${action}`,
    }));

    await client.write({ writes });

    logger.info('FGA connection permissions granted', { 
      userId, 
      connectionType, 
      actionCount: actions.length,
    });

    // Invalidate cache
    for (const key of permissionCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        permissionCache.delete(key);
      }
    }

    return { success: true };
  } catch (error) {
    logger.error('FGA connection grant failed', { userId, connectionType, error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // In strict mode, throw the error so connection fails
    if (FGA_STRICT_MODE) {
      throw new Error(`FGA permission grant failed: ${errorMessage}`);
    }
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Revoke all permissions for a connection type
 * 
 * Called when user disconnects a service
 * 
 * @throws Error if FGA write fails in strict mode
 */
export async function revokeConnectionPermissions(
  userId: string,
  connectionType: 'github' | 'slack' | 'jira'
): Promise<FGAWriteResult> {
  const client = getClient();

  if (!client) {
    if (FGA_STRICT_MODE) {
      const error = 'FGA not configured - cannot revoke permissions in strict mode';
      logger.error(error, { userId, connectionType });
      throw new Error(error);
    }
    logger.warn('FGA not configured - skipping connection revoke');
    return { success: true };
  }

  const actions = Object.keys(TOOL_RISK_LEVELS).filter(action => 
    action.startsWith(`${connectionType}_`)
  );

  if (actions.length === 0) {
    logger.warn('No actions found for connection type', { connectionType });
    return { success: true };
  }

  try {
    const deletes = actions.map(action => ({
      user: `user:${userId}`,
      relation: 'can_execute',
      object: `action:${action}`,
    }));

    await client.write({ deletes });

    logger.info('FGA connection permissions revoked', { 
      userId, 
      connectionType, 
      actionCount: actions.length,
    });

    // Invalidate cache
    for (const key of permissionCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        permissionCache.delete(key);
      }
    }

    return { success: true };
  } catch (error) {
    logger.error('FGA connection revoke failed', { userId, connectionType, error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // In strict mode, throw the error so disconnect fails
    if (FGA_STRICT_MODE) {
      throw new Error(`FGA permission revoke failed: ${errorMessage}`);
    }
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Get FGA service status
 */
export function getFGAStatus(): {
  configured: boolean;
  storeId: string | null;
  modelId: string | null;
  apiUrl: string;
  mode: 'strict' | 'permissive';
  strictMode: boolean;
} {
  return {
    configured: Boolean(FGA_STORE_ID),
    storeId: FGA_STORE_ID || null,
    modelId: FGA_MODEL_ID || null,
    apiUrl: FGA_API_URL,
    mode: FGA_STRICT_MODE ? 'strict' : 'permissive',
    strictMode: FGA_STRICT_MODE,
  };
}

/**
 * Clear the permission cache
 * Useful for testing or when permissions change externally
 */
export function clearPermissionCache(): void {
  permissionCache.clear();
  logger.info('FGA permission cache cleared');
}
