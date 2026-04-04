/**
 * Gemini LLM Client
 * 
 * Integrates with Google Vertex AI Gemini for agent reasoning.
 * Handles tool calling, structured output, and cost tracking.
 */

import { ChatVertexAI } from '@langchain/google-vertexai';
import { BaseMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { FULCRUM_SYSTEM_PROMPT, buildContextPrompt, TOOL_DESCRIPTIONS } from './prompts.js';
import { TOOL_RISK_LEVELS } from '../services/fga.js';
import type { ToolCall } from './state.js';

// Tool definition type for Gemini
interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || '';
const VERTEX_AI_LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

// Cost protection
const MAX_DAILY_REQUESTS = parseInt(process.env.MAX_DAILY_VERTEX_REQUESTS || '50');
const MAX_INPUT_LENGTH = parseInt(process.env.MAX_INPUT_LENGTH || '5000');
const MAX_TOKENS_PER_REQUEST = 8192;

// Request tracking for cost protection
let dailyRequestCount = 0;
let lastResetDate = new Date().toDateString();

// ============================================================================
// LLM CLIENT
// ============================================================================

/**
 * Create Gemini client instance
 */
function createGeminiClient(): ChatVertexAI | null {
  if (!GCP_PROJECT_ID) {
    logger.warn('Gemini not configured - GCP_PROJECT_ID missing');
    return null;
  }

  try {
    const client = new ChatVertexAI({
      model: 'gemini-2.0-flash-001',
      temperature: 0.1,
      maxOutputTokens: MAX_TOKENS_PER_REQUEST,
    });
    
    logger.info('Gemini client initialized', { 
      project: GCP_PROJECT_ID, 
      location: VERTEX_AI_LOCATION,
      model: 'gemini-2.0-flash-001',
    });
    
    return client;
  } catch (error) {
    logger.error('Failed to create Gemini client', { error });
    return null;
  }
}

// Singleton client
let geminiClient: ChatVertexAI | null = null;

/**
 * Get Gemini client (lazy initialization)
 */
export function getGeminiClient(): ChatVertexAI | null {
  if (!geminiClient) {
    geminiClient = createGeminiClient();
  }
  return geminiClient;
}

/**
 * Check if Gemini is available
 */
export function isGeminiConfigured(): boolean {
  return !!GCP_PROJECT_ID;
}

// ============================================================================
// COST PROTECTION
// ============================================================================

/**
 * Check and update daily request count
 */
function checkAndUpdateRequestCount(): { allowed: boolean; remaining: number } {
  const today = new Date().toDateString();
  
  // Reset counter if new day
  if (today !== lastResetDate) {
    dailyRequestCount = 0;
    lastResetDate = today;
  }
  
  const remaining = MAX_DAILY_REQUESTS - dailyRequestCount;
  
  if (dailyRequestCount >= MAX_DAILY_REQUESTS) {
    logger.warn('Daily Vertex AI request limit reached', { 
      count: dailyRequestCount, 
      max: MAX_DAILY_REQUESTS,
    });
    return { allowed: false, remaining: 0 };
  }
  
  dailyRequestCount++;
  return { allowed: true, remaining: remaining - 1 };
}

/**
 * Get current usage stats
 */
export function getUsageStats(): { 
  requestsToday: number; 
  maxRequests: number; 
  remaining: number;
  resetAt: string;
} {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailyRequestCount = 0;
    lastResetDate = today;
  }
  
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  
  return {
    requestsToday: dailyRequestCount,
    maxRequests: MAX_DAILY_REQUESTS,
    remaining: MAX_DAILY_REQUESTS - dailyRequestCount,
    resetAt: tomorrow.toISOString(),
  };
}

// ============================================================================
// TOOL SCHEMA DEFINITIONS
// ============================================================================

/**
 * Tool input schemas for Gemini function calling
 */
export const ToolSchemas = {
  // GitHub tools
  github_list_repos: z.object({
    visibility: z.enum(['all', 'public', 'private']).optional().describe('Filter by visibility'),
    sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional().describe('Sort field'),
    limit: z.number().max(100).optional().describe('Maximum number of repos to return'),
  }),
  
  github_get_repo: z.object({
    owner: z.string().describe('Repository owner (user or organization)'),
    repo: z.string().describe('Repository name'),
  }),
  
  github_read_file: z.object({
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    path: z.string().describe('File path within the repository'),
    ref: z.string().optional().describe('Git ref (branch, tag, or commit SHA)'),
  }),
  
  github_scan_secrets: z.object({
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    patterns: z.array(z.string()).optional().describe('Additional patterns to scan for'),
  }),
  
  github_search_code: z.object({
    query: z.string().describe('Search query'),
    owner: z.string().optional().describe('Filter by owner'),
    repo: z.string().optional().describe('Filter by repo'),
    language: z.string().optional().describe('Filter by language'),
  }),
  
  github_create_issue: z.object({
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    title: z.string().describe('Issue title'),
    body: z.string().describe('Issue body (markdown)'),
    labels: z.array(z.string()).optional().describe('Labels to apply'),
    assignees: z.array(z.string()).optional().describe('Users to assign'),
  }),
  
  github_create_branch: z.object({
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    branch: z.string().describe('New branch name'),
    from: z.string().optional().describe('Source branch (default: default branch)'),
  }),
  
  github_create_pr: z.object({
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    title: z.string().describe('PR title'),
    body: z.string().describe('PR description (markdown)'),
    head: z.string().describe('Source branch'),
    base: z.string().describe('Target branch'),
    draft: z.boolean().optional().describe('Create as draft PR'),
  }),
  
  github_merge_pr: z.object({
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    pull_number: z.number().describe('PR number to merge'),
    merge_method: z.enum(['merge', 'squash', 'rebase']).optional().describe('Merge method'),
    commit_message: z.string().optional().describe('Custom commit message'),
  }),
  
  github_delete_branch: z.object({
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    branch: z.string().describe('Branch to delete'),
  }),
  
  // Jira tools
  jira_list_sites: z.object({
    // No args - returns all accessible sites
  }),
  
  jira_list_projects: z.object({
    limit: z.number().max(100).optional().describe('Maximum projects to return'),
  }),
  
  jira_get_issue: z.object({
    issueKey: z.string().describe('Issue key (e.g., PROJ-123)'),
  }),
  
  jira_search_issues: z.object({
    jql: z.string().describe('JQL query'),
    maxResults: z.number().max(100).optional().describe('Maximum results'),
    fields: z.array(z.string()).optional().describe('Fields to return'),
  }),
  
  jira_create_issue: z.object({
    projectKey: z.string().describe('Project key'),
    issueType: z.string().describe('Issue type (e.g., Bug, Task, Story)'),
    summary: z.string().describe('Issue summary'),
    description: z.string().optional().describe('Issue description'),
    priority: z.string().optional().describe('Priority name'),
    labels: z.array(z.string()).optional().describe('Labels'),
  }),
  
  jira_update_issue: z.object({
    issueKey: z.string().describe('Issue key'),
    fields: z.record(z.unknown()).describe('Fields to update'),
  }),
  
  jira_transition_issue: z.object({
    issueKey: z.string().describe('Issue key'),
    transitionId: z.string().describe('Transition ID'),
    comment: z.string().optional().describe('Comment to add'),
  }),
  
  jira_delete_issue: z.object({
    issueKey: z.string().describe('Issue key to delete'),
  }),
  
  // Slack tools
  slack_list_channels: z.object({
    types: z.array(z.enum(['public_channel', 'private_channel'])).optional().describe('Channel types'),
    limit: z.number().max(100).optional().describe('Maximum channels'),
  }),
  
  slack_get_channel: z.object({
    channelId: z.string().describe('Channel ID'),
  }),
  
  slack_search_messages: z.object({
    query: z.string().describe('Search query'),
    count: z.number().max(100).optional().describe('Maximum results'),
  }),
  
  slack_send_message: z.object({
    channel: z.string().describe('Channel ID or name'),
    text: z.string().describe('Message text'),
    blocks: z.array(z.record(z.unknown())).optional().describe('Block Kit blocks'),
  }),
  
  slack_post_alert: z.object({
    channel: z.string().describe('Channel ID or name'),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).describe('Alert severity'),
    title: z.string().describe('Alert title'),
    details: z.string().describe('Alert details'),
  }),
  
  slack_update_message: z.object({
    channel: z.string().describe('Channel ID'),
    ts: z.string().describe('Message timestamp'),
    text: z.string().describe('New message text'),
  }),
  
  slack_invite_user: z.object({
    channel: z.string().describe('Channel ID'),
    userId: z.string().describe('User ID to invite'),
  }),
  
  slack_remove_user: z.object({
    channel: z.string().describe('Channel ID'),
    userId: z.string().describe('User ID to remove'),
  }),
};

// ============================================================================
// TOOL BINDING
// ============================================================================

/**
 * Create tool definitions for Gemini bindTools
 * Returns tool objects in the format expected by LangChain
 */
export function createToolDefinitions(availableTools: string[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  
  for (const toolName of availableTools) {
    const schema = ToolSchemas[toolName as keyof typeof ToolSchemas];
    const description = TOOL_DESCRIPTIONS[toolName];
    
    if (!schema || !description) {
      logger.warn('Unknown tool requested', { toolName });
      continue;
    }
    
    tools.push({
      name: toolName,
      description: description,
      schema: schema,
    });
  }
  
  return tools;
}

/**
 * Get list of tools available to a user based on their connections
 */
export function getAvailableTools(connections: string[]): string[] {
  const tools: string[] = [];
  
  if (connections.includes('github')) {
    tools.push(
      'github_list_repos', 'github_get_repo', 'github_read_file',
      'github_scan_secrets', 'github_search_code',
      'github_create_issue', 'github_create_branch', 'github_create_pr',
      'github_merge_pr', 'github_delete_branch'
    );
  }
  
  if (connections.includes('jira')) {
    tools.push(
      'jira_list_sites', 'jira_list_projects', 'jira_get_issue', 'jira_search_issues',
      'jira_create_issue', 'jira_update_issue', 'jira_transition_issue',
      'jira_delete_issue'
    );
  }
  
  if (connections.includes('slack')) {
    tools.push(
      'slack_list_channels', 'slack_get_channel', 'slack_search_messages',
      'slack_send_message', 'slack_post_alert', 'slack_update_message',
      'slack_invite_user', 'slack_remove_user'
    );
  }
  
  return tools;
}

// ============================================================================
// LLM INVOCATION
// ============================================================================

/**
 * Result from LLM invocation
 */
export interface LLMResult {
  success: boolean;
  response?: AIMessage;
  toolCalls?: ToolCall[];
  text?: string;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  };
}

/**
 * Invoke Gemini with messages and available tools
 */
export async function invokeLLM(
  messages: BaseMessage[],
  availableTools: string[],
  userConnections: string[] = []
): Promise<LLMResult> {
  const client = getGeminiClient();
  
  if (!client) {
    logger.warn('Gemini not configured, using fallback response');
    return {
      success: false,
      error: 'Gemini AI is not configured. Please set GCP_PROJECT_ID.',
    };
  }
  
  // Check rate limit
  const rateCheck = checkAndUpdateRequestCount();
  if (!rateCheck.allowed) {
    return {
      success: false,
      error: `Daily request limit reached (${MAX_DAILY_REQUESTS}). Resets at midnight.`,
    };
  }
  
  try {
    const startTime = Date.now();
    
    // Build messages with system prompt
    const systemPrompt = FULCRUM_SYSTEM_PROMPT + '\n\n' + buildContextPrompt(userConnections, availableTools);
    const allMessages = [
      new SystemMessage(systemPrompt),
      ...messages,
    ];
    
    // Create client with tools bound if available
    let response;
    if (availableTools.length > 0) {
      const toolDefs = createToolDefinitions(availableTools);
      if (toolDefs.length > 0) {
        const clientWithTools = client.bindTools(toolDefs);
        response = await clientWithTools.invoke(allMessages);
      } else {
        response = await client.invoke(allMessages);
      }
    } else {
      response = await client.invoke(allMessages);
    }
    
    const duration = Date.now() - startTime;
    
    // Extract tool calls if present
    const toolCalls: ToolCall[] = [];
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const tc of response.tool_calls) {
        const riskLevel = TOOL_RISK_LEVELS[tc.name] || 0;
        toolCalls.push({
          id: tc.id || `tool_${Date.now()}`,
          name: tc.name,
          args: tc.args as Record<string, unknown>,
          riskLevel,
          requiresCIBA: riskLevel >= 5,
        });
      }
    }
    
    logger.info('Gemini invocation complete', {
      duration,
      hasToolCalls: toolCalls.length > 0,
      toolCount: toolCalls.length,
      remainingRequests: rateCheck.remaining,
    });
    
    return {
      success: true,
      response: response as AIMessage,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      text: typeof response.content === 'string' ? response.content : undefined,
    };
    
  } catch (error) {
    logger.error('Gemini invocation failed', { error });
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate a simple text response (no tools)
 */
export async function generateTextResponse(
  prompt: string,
  context?: string
): Promise<LLMResult> {
  const client = getGeminiClient();
  
  if (!client) {
    return {
      success: false,
      error: 'Gemini AI is not configured',
    };
  }
  
  const rateCheck = checkAndUpdateRequestCount();
  if (!rateCheck.allowed) {
    return {
      success: false,
      error: `Daily request limit reached (${MAX_DAILY_REQUESTS})`,
    };
  }
  
  try {
    const messages = [
      { role: 'system' as const, content: FULCRUM_SYSTEM_PROMPT + (context || '') },
      { role: 'human' as const, content: prompt },
    ];
    
    const response = await client.invoke(messages);
    
    return {
      success: true,
      response: response as AIMessage,
      text: typeof response.content === 'string' ? response.content : undefined,
    };
    
  } catch (error) {
    logger.error('Text generation failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  MAX_INPUT_LENGTH,
  MAX_DAILY_REQUESTS,
};
