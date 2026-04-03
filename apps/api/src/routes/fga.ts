/**
 * FGA Routes
 * 
 * API endpoints for FGA (Fine-Grained Authorization) management.
 * Used for testing permissions and managing authorization state.
 */

import { Router, IRouter } from 'express';
import { jwtCheck, getUserFromToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import {
  checkPermission,
  requiresApproval,
  getActionRiskLevel,
  getFGAStatus,
  grantConnectionPermissions,
  revokeConnectionPermissions,
  TOOL_RISK_LEVELS,
  clearPermissionCache,
} from '../services/fga.js';

export const fgaRouter: IRouter = Router();

// ========================================
// PUBLIC ENDPOINTS (no auth required)
// ========================================

// FGA status endpoint
fgaRouter.get('/status', (_req, res) => {
  const status = getFGAStatus();
  res.json({
    ...status,
    toolCount: Object.keys(TOOL_RISK_LEVELS).length,
    cibaRequiredActions: Object.entries(TOOL_RISK_LEVELS)
      .filter(([_, level]) => level === 5)
      .map(([action]) => action),
  });
});

/**
 * Get all available tools and their risk levels (public)
 * 
 * GET /api/fga/tools
 */
fgaRouter.get('/tools', (_req, res) => {
  const tools = Object.entries(TOOL_RISK_LEVELS).map(([name, riskLevel]) => ({
    name,
    riskLevel,
    requiresApproval: requiresApproval(name),
    connection: name.split('_')[0], // github, slack, jira
    description: getToolDescription(name),
  }));

  // Group by connection
  const grouped = tools.reduce((acc, tool) => {
    const conn = tool.connection;
    if (!acc[conn]) acc[conn] = [];
    acc[conn].push(tool);
    return acc;
  }, {} as Record<string, typeof tools>);

  res.json({
    tools,
    grouped,
    riskLevels: {
      1: 'READ - Safe, read-only operations',
      2: 'SEARCH - Search and scan operations',
      3: 'CREATE - Create new resources',
      4: 'UPDATE - Modify existing resources',
      5: 'DELETE - Destructive operations (requires CIBA)',
    },
  });
});

// ========================================
// PROTECTED ENDPOINTS (auth required)
// ========================================
fgaRouter.use(jwtCheck);

/**
 * Check permission for current user
 * 
 * GET /api/fga/check?action=github_list_repos&resource=repo:owner/name
 */
fgaRouter.get('/check', async (req, res) => {
  const user = getUserFromToken(req);
  const { action } = req.query;

  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'Action parameter is required' });
  }

  logger.info('FGA check requested', { userId: user.userId, action });

  const result = await checkPermission(user.userId, action);
  const riskLevel = getActionRiskLevel(action);
  const needsApproval = requiresApproval(action);

  res.json({
    allowed: result.allowed,
    action,
    riskLevel,
    requiresApproval: needsApproval,
    reason: result.reason,
    cached: result.cached,
    checkDurationMs: result.checkDurationMs,
    mode: result.mode,
  });
});

/**
 * Batch check multiple permissions
 * 
 * POST /api/fga/check-batch
 * Body: { actions: ["github_list_repos", "github_create_pr"] }
 */
fgaRouter.post('/check-batch', async (req, res) => {
  const user = getUserFromToken(req);
  const { actions } = req.body;

  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  if (!Array.isArray(actions) || actions.length === 0) {
    return res.status(400).json({ error: 'Actions array is required' });
  }

  if (actions.length > 20) {
    return res.status(400).json({ error: 'Maximum 20 actions per batch' });
  }

  const results = await Promise.all(
    actions.map(async (action: string) => {
      const result = await checkPermission(user.userId, action);
      return {
        action,
        allowed: result.allowed,
        riskLevel: getActionRiskLevel(action),
        requiresApproval: requiresApproval(action),
        reason: result.reason,
      };
    })
  );

  res.json({
    userId: user.userId,
    results,
    summary: {
      total: results.length,
      allowed: results.filter(r => r.allowed).length,
      denied: results.filter(r => !r.allowed).length,
      requireApproval: results.filter(r => r.requiresApproval).length,
    },
  });
});

/**
 * Grant connection permissions (called when user connects a service)
 * 
 * POST /api/fga/grant-connection
 * Body: { connection: "github" }
 */
fgaRouter.post('/grant-connection', async (req, res) => {
  const user = getUserFromToken(req);
  const { connection } = req.body;

  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  if (!connection || !['github', 'slack', 'jira'].includes(connection)) {
    return res.status(400).json({ 
      error: 'Valid connection type required (github, slack, jira)' 
    });
  }

  logger.info('Granting connection permissions', { userId: user.userId, connection });

  const result = await grantConnectionPermissions(
    user.userId,
    connection as 'github' | 'slack' | 'jira'
  );

  if (!result.success) {
    return res.status(500).json({
      success: false,
      error: result.error,
      connection,
    });
  }

  res.json({
    success: true,
    message: `Permissions granted for ${connection}`,
    connection,
    userId: user.userId,
  });
});

/**
 * Revoke connection permissions (called when user disconnects a service)
 * 
 * POST /api/fga/revoke-connection
 * Body: { connection: "github" }
 */
fgaRouter.post('/revoke-connection', async (req, res) => {
  const user = getUserFromToken(req);
  const { connection } = req.body;

  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  if (!connection || !['github', 'slack', 'jira'].includes(connection)) {
    return res.status(400).json({ 
      error: 'Valid connection type required (github, slack, jira)' 
    });
  }

  logger.info('Revoking connection permissions', { userId: user.userId, connection });

  const result = await revokeConnectionPermissions(
    user.userId,
    connection as 'github' | 'slack' | 'jira'
  );

  if (!result.success) {
    return res.status(500).json({
      success: false,
      error: result.error,
      connection,
    });
  }

  res.json({
    success: true,
    message: `Permissions revoked for ${connection}`,
    connection,
    userId: user.userId,
  });
});

/**
 * Clear permission cache (for testing)
 * 
 * POST /api/fga/clear-cache
 */
fgaRouter.post('/clear-cache', (_req, res) => {
  clearPermissionCache();
  res.json({
    success: true,
    message: 'Permission cache cleared',
  });
});

/**
 * Get tool description (helper function)
 */
function getToolDescription(toolName: string): string {
  const descriptions: Record<string, string> = {
    // GitHub
    github_list_repos: 'List repositories the user has access to',
    github_get_repo: 'Get details of a specific repository',
    github_read_file: 'Read file contents from a repository',
    github_scan_secrets: 'Scan repository for exposed secrets',
    github_search_code: 'Search code across repositories',
    github_create_issue: 'Create a new issue in a repository',
    github_create_branch: 'Create a new branch in a repository',
    github_create_pr: 'Create a pull request',
    github_update_issue: 'Update an existing issue',
    github_merge_pr: 'Merge a pull request (DANGEROUS)',
    github_delete_branch: 'Delete a branch (DANGEROUS)',
    github_delete_repo: 'Delete a repository (VERY DANGEROUS)',

    // Jira
    jira_list_projects: 'List Jira projects',
    jira_get_issue: 'Get details of a Jira issue',
    jira_search_issues: 'Search for Jira issues',
    jira_create_issue: 'Create a new Jira issue',
    jira_update_issue: 'Update an existing Jira issue',
    jira_transition_issue: 'Move issue to a different status',
    jira_delete_issue: 'Delete a Jira issue (DANGEROUS)',

    // Slack
    slack_list_channels: 'List Slack channels',
    slack_get_channel: 'Get details of a Slack channel',
    slack_search_messages: 'Search Slack messages',
    slack_send_message: 'Send a message to a channel',
    slack_post_alert: 'Post a security alert',
    slack_update_message: 'Update a posted message',
    slack_invite_user: 'Invite a user to a channel (DANGEROUS)',
    slack_remove_user: 'Remove a user from a channel (DANGEROUS)',
  };

  return descriptions[toolName] || 'No description available';
}
