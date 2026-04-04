/**
 * Tool Registry
 * 
 * Central registry for all agent tools.
 * Provides a unified interface for tool execution.
 */

import { logger } from '../../utils/logger.js';
import { recordAuditLog, recordToolExecution } from '../../utils/audit.js';
import { TOOL_RISK_LEVELS } from '../../services/fga.js';
import type { ToolResult } from '../state.js';

// Import tool implementations
import { GitHubTools, type GitHubToolContext } from './github.js';
import { JiraTools, type JiraToolContext } from './jira.js';
import { SlackTools, type SlackToolContext } from './slack.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ToolContext {
  userId: string;
  userAccessToken: string;
  sessionId?: string;
  fgaCheckPassed?: boolean;
  cibaApproved?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  riskLevel: number;
  requiresCIBA: boolean;
  connection: 'github' | 'jira' | 'slack';
}

// ============================================================================
// TOOL REGISTRY
// ============================================================================

/**
 * All available tools mapped by name
 */
export const AllTools = {
  ...GitHubTools,
  ...JiraTools,
  ...SlackTools,
} as const;

export type ToolName = keyof typeof AllTools;

/**
 * Tool metadata
 */
export const ToolDefinitions: Record<ToolName, ToolDefinition> = {
  // GitHub tools
  github_list_repos: {
    name: 'github_list_repos',
    description: 'List repositories accessible to the user',
    riskLevel: 1,
    requiresCIBA: false,
    connection: 'github',
  },
  github_get_repo: {
    name: 'github_get_repo',
    description: 'Get detailed information about a repository',
    riskLevel: 1,
    requiresCIBA: false,
    connection: 'github',
  },
  github_read_file: {
    name: 'github_read_file',
    description: 'Read file contents from a repository',
    riskLevel: 1,
    requiresCIBA: false,
    connection: 'github',
  },
  github_scan_secrets: {
    name: 'github_scan_secrets',
    description: 'Scan repository for hardcoded secrets',
    riskLevel: 2,
    requiresCIBA: false,
    connection: 'github',
  },
  github_search_code: {
    name: 'github_search_code',
    description: 'Search code across repositories',
    riskLevel: 2,
    requiresCIBA: false,
    connection: 'github',
  },
  github_create_issue: {
    name: 'github_create_issue',
    description: 'Create a new issue in a repository',
    riskLevel: 3,
    requiresCIBA: false,
    connection: 'github',
  },
  github_create_branch: {
    name: 'github_create_branch',
    description: 'Create a new branch',
    riskLevel: 3,
    requiresCIBA: false,
    connection: 'github',
  },
  github_create_pr: {
    name: 'github_create_pr',
    description: 'Create a pull request',
    riskLevel: 4,
    requiresCIBA: false,
    connection: 'github',
  },
  github_merge_pr: {
    name: 'github_merge_pr',
    description: 'Merge a pull request (requires approval)',
    riskLevel: 5,
    requiresCIBA: true,
    connection: 'github',
  },
  github_delete_branch: {
    name: 'github_delete_branch',
    description: 'Delete a branch (requires approval)',
    riskLevel: 5,
    requiresCIBA: true,
    connection: 'github',
  },

  // Jira tools
  jira_list_sites: {
    name: 'jira_list_sites',
    description: 'List all accessible Jira sites',
    riskLevel: 1,
    requiresCIBA: false,
    connection: 'jira',
  },
  jira_list_projects: {
    name: 'jira_list_projects',
    description: 'List Jira projects',
    riskLevel: 1,
    requiresCIBA: false,
    connection: 'jira',
  },
  jira_get_issue: {
    name: 'jira_get_issue',
    description: 'Get Jira issue details',
    riskLevel: 1,
    requiresCIBA: false,
    connection: 'jira',
  },
  jira_search_issues: {
    name: 'jira_search_issues',
    description: 'Search Jira issues with JQL',
    riskLevel: 2,
    requiresCIBA: false,
    connection: 'jira',
  },
  jira_create_issue: {
    name: 'jira_create_issue',
    description: 'Create a Jira issue',
    riskLevel: 3,
    requiresCIBA: false,
    connection: 'jira',
  },
  jira_update_issue: {
    name: 'jira_update_issue',
    description: 'Update a Jira issue',
    riskLevel: 4,
    requiresCIBA: false,
    connection: 'jira',
  },
  jira_transition_issue: {
    name: 'jira_transition_issue',
    description: 'Transition a Jira issue',
    riskLevel: 4,
    requiresCIBA: false,
    connection: 'jira',
  },
  jira_delete_issue: {
    name: 'jira_delete_issue',
    description: 'Delete a Jira issue (requires approval)',
    riskLevel: 5,
    requiresCIBA: true,
    connection: 'jira',
  },

  // Slack tools
  slack_list_channels: {
    name: 'slack_list_channels',
    description: 'List Slack channels',
    riskLevel: 1,
    requiresCIBA: false,
    connection: 'slack',
  },
  slack_get_channel: {
    name: 'slack_get_channel',
    description: 'Get Slack channel details',
    riskLevel: 1,
    requiresCIBA: false,
    connection: 'slack',
  },
  slack_search_messages: {
    name: 'slack_search_messages',
    description: 'Search Slack messages',
    riskLevel: 2,
    requiresCIBA: false,
    connection: 'slack',
  },
  slack_send_message: {
    name: 'slack_send_message',
    description: 'Send a Slack message',
    riskLevel: 3,
    requiresCIBA: false,
    connection: 'slack',
  },
  slack_post_alert: {
    name: 'slack_post_alert',
    description: 'Post a security alert to Slack',
    riskLevel: 3,
    requiresCIBA: false,
    connection: 'slack',
  },
  slack_update_message: {
    name: 'slack_update_message',
    description: 'Update a Slack message',
    riskLevel: 4,
    requiresCIBA: false,
    connection: 'slack',
  },
  slack_invite_user: {
    name: 'slack_invite_user',
    description: 'Invite user to Slack channel (requires approval)',
    riskLevel: 5,
    requiresCIBA: true,
    connection: 'slack',
  },
  slack_remove_user: {
    name: 'slack_remove_user',
    description: 'Remove user from Slack channel (requires approval)',
    riskLevel: 5,
    requiresCIBA: true,
    connection: 'slack',
  },
};

// ============================================================================
// TOOL EXECUTION
// ============================================================================

/**
 * Execute a tool by name with comprehensive audit logging
 */
export async function executeTool(
  toolName: ToolName,
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const toolDef = ToolDefinitions[toolName];
  if (!toolDef) {
    // Record failed attempt in audit log
    await recordAuditLog({
      userId: context.userId,
      sessionId: context.sessionId,
      action: `tool:${toolName}`,
      result: 'FAILURE',
      details: { error: 'Unknown tool' },
    });
    
    return {
      toolCallId,
      toolName,
      success: false,
      error: `Unknown tool: ${toolName}`,
      executionTimeMs: 0,
    };
  }
  
  logger.info('Executing tool', {
    tool: toolName,
    userId: context.userId,
    riskLevel: toolDef.riskLevel,
    requiresCIBA: toolDef.requiresCIBA,
  });
  
  try {
    // Get the tool function
    const toolFn = AllTools[toolName];
    if (!toolFn) {
      throw new Error(`Tool function not found: ${toolName}`);
    }
    
    // Build context based on connection type
    const toolContext: GitHubToolContext | JiraToolContext | SlackToolContext = {
      userId: context.userId,
      userAccessToken: context.userAccessToken,
    };
    
    // Execute the tool
    const result = await (toolFn as (
      ctx: typeof toolContext,
      id: string,
      args: Record<string, unknown>
    ) => Promise<ToolResult>)(toolContext, toolCallId, args);
    
    const executionTimeMs = Date.now() - startTime;
    
    logger.info('Tool execution complete', {
      tool: toolName,
      userId: context.userId,
      success: result.success,
      executionTimeMs,
    });
    
    // Record to audit log
    await recordAuditLog({
      userId: context.userId,
      sessionId: context.sessionId,
      action: `tool:${toolName}`,
      resource: getResourceFromArgs(toolName, args),
      fgaResult: context.fgaCheckPassed ? 'ALLOWED' : 'SKIPPED',
      cibaStatus: toolDef.requiresCIBA 
        ? (context.cibaApproved ? 'APPROVED' : 'NOT_REQUIRED')
        : 'NOT_REQUIRED',
      result: result.success ? 'SUCCESS' : 'FAILURE',
      details: {
        riskLevel: toolDef.riskLevel,
        executionTimeMs,
        error: result.error,
      },
    });
    
    // Record detailed tool execution
    await recordToolExecution({
      sessionId: context.sessionId,
      toolName,
      input: args,
      output: result.result as Record<string, unknown> | undefined,
      fgaCheckPassed: context.fgaCheckPassed ?? true,
      cibaRequired: toolDef.requiresCIBA,
      cibaApproved: context.cibaApproved,
      tokenVaultUsed: true,
      executionTimeMs,
      success: result.success,
      error: result.error,
    });
    
    return result;
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const executionTimeMs = Date.now() - startTime;
    
    logger.error('Tool execution failed', {
      tool: toolName,
      userId: context.userId,
      error: message,
    });
    
    // Record failure to audit log
    await recordAuditLog({
      userId: context.userId,
      sessionId: context.sessionId,
      action: `tool:${toolName}`,
      resource: getResourceFromArgs(toolName, args),
      fgaResult: context.fgaCheckPassed ? 'ALLOWED' : 'SKIPPED',
      cibaStatus: toolDef.requiresCIBA 
        ? (context.cibaApproved ? 'APPROVED' : 'NOT_REQUIRED')
        : 'NOT_REQUIRED',
      result: 'FAILURE',
      details: {
        riskLevel: toolDef.riskLevel,
        executionTimeMs,
        error: message,
      },
    });
    
    return {
      toolCallId,
      toolName,
      success: false,
      error: message,
      executionTimeMs,
    };
  }
}

/**
 * Extract resource identifier from tool args for audit logging
 */
function getResourceFromArgs(_toolName: string, args: Record<string, unknown>): string | undefined {
  // GitHub resources
  if (args.owner && args.repo) {
    return `github:${args.owner}/${args.repo}`;
  }
  if (args.repo) {
    return `github:${args.repo}`;
  }
  
  // Jira resources
  if (args.issueKey) {
    return `jira:${args.issueKey}`;
  }
  if (args.projectKey) {
    return `jira:${args.projectKey}`;
  }
  
  // Slack resources
  if (args.channel || args.channelId) {
    return `slack:${args.channel || args.channelId}`;
  }
  
  return undefined;
}

/**
 * Get tool definition by name
 */
export function getToolDefinition(toolName: string): ToolDefinition | undefined {
  return ToolDefinitions[toolName as ToolName];
}

/**
 * Get tools available for a connection
 */
export function getToolsForConnection(connection: 'github' | 'jira' | 'slack'): ToolDefinition[] {
  return Object.values(ToolDefinitions).filter(t => t.connection === connection);
}

/**
 * Check if a tool requires CIBA approval
 */
export function toolRequiresCIBA(toolName: string): boolean {
  const def = ToolDefinitions[toolName as ToolName];
  return def?.requiresCIBA ?? false;
}

/**
 * Get tool risk level
 */
export function getToolRiskLevel(toolName: string): number {
  return TOOL_RISK_LEVELS[toolName] || 0;
}

// ============================================================================
// EXPORTS
// ============================================================================

export { GitHubTools } from './github.js';
export { JiraTools } from './jira.js';
export { SlackTools } from './slack.js';
