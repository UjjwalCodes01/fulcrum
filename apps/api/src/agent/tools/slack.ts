/**
 * Slack Tools
 * 
 * Implements all Slack-related tools for the Fulcrum agent.
 * Uses Slack Web API.
 * 
 * Risk Levels:
 * - Level 1: list_channels, get_channel (read-only)
 * - Level 2: search_messages (search)
 * - Level 3: send_message, post_alert (create)
 * - Level 4: update_message (update)
 * - Level 5: invite_user, remove_user (destructive - requires CIBA)
 */

import { logger } from '../../utils/logger.js';
import { exchangeAccessTokenForFederatedToken } from '../../services/token-vault.js';
import { executeWithRetry, CircuitBreaker } from '../../utils/error-handling.js';
import type { ToolResult } from '../state.js';

// ============================================================================
// CIRCUIT BREAKER FOR SLACK
// ============================================================================

const slackCircuitBreaker = new CircuitBreaker('slack', 5, 60000, 300000);

// ============================================================================
// TYPES
// ============================================================================

export interface SlackToolContext {
  userId: string;
  userAccessToken: string;
}

const SLACK_API_BASE = 'https://slack.com/api';

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_archived: boolean;
  is_member: boolean;
  topic?: {
    value: string;
  };
  purpose?: {
    value: string;
  };
  num_members?: number;
}

// Note: SlackMessage is defined for future use in message reading tools
// interface SlackMessage {
//   ts: string;
//   user: string;
//   text: string;
//   channel?: string;
//   type: string;
// }

// ============================================================================
// SLACK API CLIENT
// ============================================================================

interface SlackRequestOptions {
  method: 'GET' | 'POST';
  endpoint: string;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
}

/**
 * Make authenticated Slack API request
 */
async function slackRequest<T>(
  context: SlackToolContext,
  options: SlackRequestOptions
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const result = await slackCircuitBreaker.execute(async () => {
      return executeWithRetry(
        async () => {
          // Get Slack token from Token Vault
          const tokenResult = await exchangeAccessTokenForFederatedToken(
            context.userAccessToken,
            'slack'
          );
          
          if (!tokenResult.success || !tokenResult.accessToken) {
            throw new Error(`Failed to get Slack token: ${tokenResult.error}`);
          }
          
          // Build URL with query params for GET requests
          let url = `${SLACK_API_BASE}/${options.endpoint}`;
          if (options.method === 'GET' && options.params) {
            const queryString = new URLSearchParams(options.params).toString();
            url += `?${queryString}`;
          }
          
          const requestOptions: RequestInit = {
            method: options.method,
            headers: {
              'Authorization': `Bearer ${tokenResult.accessToken}`,
              'Content-Type': 'application/json; charset=utf-8',
            },
          };
          
          if (options.method === 'POST' && options.body) {
            requestOptions.body = JSON.stringify(options.body);
          }
          
          const response = await fetch(url, requestOptions);
          const data = await response.json() as { ok: boolean; error?: string } & T;
          
          if (!data.ok) {
            throw new Error(`Slack API error: ${data.error}`);
          }
          
          return data;
        },
        { maxAttempts: 3, baseDelayMs: 1000 },
        'slack'
      );
    });
    
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Slack API call failed after retries', { 
      userId: context.userId,
      method: options.method,
      endpoint: options.endpoint,
      error: message
    });
    return { success: false, error: message };
  }
}

/**
 * Create a standardized tool result
 */
function createResult(
  toolCallId: string,
  toolName: string,
  success: boolean,
  result?: unknown,
  error?: string,
  startTime?: number
): ToolResult {
  return {
    toolCallId,
    toolName,
    success,
    result,
    error,
    executionTimeMs: startTime ? Date.now() - startTime : 0,
    tokenUsed: true,
  };
}

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

/**
 * List Slack channels with pagination support
 */
export async function slack_list_channels(
  context: SlackToolContext,
  toolCallId: string,
  args: { types?: ('public_channel' | 'private_channel')[]; limit?: number; cursor?: string; fetchAll?: boolean }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const types = args.types?.join(',') || 'public_channel,private_channel';
  const maxChannels = args.limit || 200; // Default to 200 if not specified
  const fetchAll = args.fetchAll ?? false;
  
  interface ChannelsResponse {
    channels: SlackChannel[];
    response_metadata?: {
      next_cursor?: string;
    };
  }
  
  const allChannels: SlackChannel[] = [];
  let cursor = args.cursor;
  let pageCount = 0;
  const maxPages = 5; // Safety limit to prevent runaway pagination
  
  do {
    const result = await slackRequest<ChannelsResponse>(context, {
      method: 'GET',
      endpoint: 'conversations.list',
      params: {
        types,
        limit: String(Math.min(200, maxChannels - allChannels.length)), // Slack max is 200 per page
        exclude_archived: 'true',
        ...(cursor ? { cursor } : {}),
      },
    });
    
    if (!result.success || !result.data) {
      if (allChannels.length > 0) {
        // Return partial results with warning
        logger.warn('Partial Slack channel list', { 
          userId: context.userId, 
          count: allChannels.length,
          error: result.error,
        });
        break;
      }
      return createResult(toolCallId, 'slack_list_channels', false, undefined, result.error, startTime);
    }
    
    allChannels.push(...result.data.channels);
    cursor = result.data.response_metadata?.next_cursor;
    pageCount++;
    
    // Stop if we've reached the limit, no more pages, or hit max pages
    if (!fetchAll || allChannels.length >= maxChannels || !cursor || pageCount >= maxPages) {
      break;
    }
  } while (cursor);
  
  const channels = allChannels.slice(0, maxChannels).map(ch => ({
    id: ch.id,
    name: ch.name,
    isPrivate: ch.is_private,
    isArchived: ch.is_archived,
    isMember: ch.is_member,
    topic: ch.topic?.value || '',
    purpose: ch.purpose?.value || '',
    memberCount: ch.num_members,
  }));
  
  logger.info('Listed Slack channels', { 
    userId: context.userId, 
    count: channels.length,
    hasMore: !!cursor,
  });
  
  return createResult(toolCallId, 'slack_list_channels', true, {
    channels,
    count: channels.length,
    hasMore: !!cursor,
    nextCursor: cursor || undefined,
  }, undefined, startTime);
}

/**
 * Get detailed information about a channel
 */
export async function slack_get_channel(
  context: SlackToolContext,
  toolCallId: string,
  args: { channelId: string }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  interface ChannelResponse {
    channel: SlackChannel & {
      created: number;
      creator: string;
    };
  }
  
  const result = await slackRequest<ChannelResponse>(context, {
    method: 'GET',
    endpoint: 'conversations.info',
    params: {
      channel: args.channelId,
      include_num_members: 'true',
    },
  });
  
  if (!result.success || !result.data) {
    return createResult(toolCallId, 'slack_get_channel', false, undefined, result.error, startTime);
  }
  
  const ch = result.data.channel;
  
  return createResult(toolCallId, 'slack_get_channel', true, {
    channel: {
      id: ch.id,
      name: ch.name,
      isPrivate: ch.is_private,
      isArchived: ch.is_archived,
      isMember: ch.is_member,
      topic: ch.topic?.value || '',
      purpose: ch.purpose?.value || '',
      memberCount: ch.num_members,
      created: new Date(ch.created * 1000).toISOString(),
      creator: ch.creator,
    },
  }, undefined, startTime);
}

/**
 * Search for messages
 */
export async function slack_search_messages(
  context: SlackToolContext,
  toolCallId: string,
  args: { query: string; count?: number }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  interface SearchResponse {
    messages: {
      total: number;
      matches: Array<{
        ts: string;
        text: string;
        username: string;
        channel: {
          id: string;
          name: string;
        };
        permalink: string;
      }>;
    };
  }
  
  const result = await slackRequest<SearchResponse>(context, {
    method: 'GET',
    endpoint: 'search.messages',
    params: {
      query: args.query,
      count: String(args.count || 20),
      sort: 'timestamp',
    },
  });
  
  if (!result.success || !result.data) {
    return createResult(toolCallId, 'slack_search_messages', false, undefined, result.error, startTime);
  }
  
  const messages = result.data.messages.matches.map(m => ({
    timestamp: m.ts,
    text: m.text,
    user: m.username,
    channel: {
      id: m.channel.id,
      name: m.channel.name,
    },
    permalink: m.permalink,
  }));
  
  logger.info('Searched Slack messages', { 
    userId: context.userId, 
    query: args.query,
    resultCount: messages.length,
  });
  
  return createResult(toolCallId, 'slack_search_messages', true, {
    messages,
    total: result.data.messages.total,
    returned: messages.length,
  }, undefined, startTime);
}

/**
 * Send a message to a channel
 */
export async function slack_send_message(
  context: SlackToolContext,
  toolCallId: string,
  args: { channel: string; text: string; blocks?: Record<string, unknown>[] }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  interface PostMessageResponse {
    channel: string;
    ts: string;
    message: {
      text: string;
      ts: string;
    };
  }
  
  const body: Record<string, unknown> = {
    channel: args.channel,
    text: args.text,
  };
  
  if (args.blocks) {
    body.blocks = args.blocks;
  }
  
  const result = await slackRequest<PostMessageResponse>(context, {
    method: 'POST',
    endpoint: 'chat.postMessage',
    body,
  });
  
  if (!result.success || !result.data) {
    return createResult(toolCallId, 'slack_send_message', false, undefined, result.error, startTime);
  }
  
  logger.info('Sent Slack message', {
    userId: context.userId,
    channel: args.channel,
    ts: result.data.ts,
  });
  
  return createResult(toolCallId, 'slack_send_message', true, {
    sent: true,
    channel: result.data.channel,
    timestamp: result.data.ts,
  }, undefined, startTime);
}

/**
 * Post a formatted security alert
 */
export async function slack_post_alert(
  context: SlackToolContext,
  toolCallId: string,
  args: { 
    channel: string; 
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    title: string; 
    details: string 
  }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  // Map severity to emoji and color
  const severityConfig = {
    critical: { emoji: '🚨', color: '#FF0000' },
    high: { emoji: '🔴', color: '#FF4500' },
    medium: { emoji: '🟠', color: '#FFA500' },
    low: { emoji: '🟡', color: '#FFD700' },
    info: { emoji: 'ℹ️', color: '#0000FF' },
  };
  
  const config = severityConfig[args.severity];
  
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${config.emoji} Security Alert: ${args.title}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Severity:* ${args.severity.toUpperCase()}\n\n${args.details}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Posted by Fulcrum Security Agent • ${new Date().toISOString()}`,
        },
      ],
    },
  ];
  
  interface PostMessageResponse {
    channel: string;
    ts: string;
  }
  
  const result = await slackRequest<PostMessageResponse>(context, {
    method: 'POST',
    endpoint: 'chat.postMessage',
    body: {
      channel: args.channel,
      text: `${config.emoji} Security Alert: ${args.title}`,
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    },
  });
  
  if (!result.success || !result.data) {
    return createResult(toolCallId, 'slack_post_alert', false, undefined, result.error, startTime);
  }
  
  logger.info('Posted Slack security alert', {
    userId: context.userId,
    channel: args.channel,
    severity: args.severity,
    ts: result.data.ts,
  });
  
  return createResult(toolCallId, 'slack_post_alert', true, {
    posted: true,
    channel: result.data.channel,
    timestamp: result.data.ts,
    severity: args.severity,
  }, undefined, startTime);
}

/**
 * Update a message
 */
export async function slack_update_message(
  context: SlackToolContext,
  toolCallId: string,
  args: { channel: string; ts: string; text: string }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  interface UpdateResponse {
    channel: string;
    ts: string;
  }
  
  const result = await slackRequest<UpdateResponse>(context, {
    method: 'POST',
    endpoint: 'chat.update',
    body: {
      channel: args.channel,
      ts: args.ts,
      text: args.text,
    },
  });
  
  if (!result.success || !result.data) {
    return createResult(toolCallId, 'slack_update_message', false, undefined, result.error, startTime);
  }
  
  logger.info('Updated Slack message', {
    userId: context.userId,
    channel: args.channel,
    ts: args.ts,
  });
  
  return createResult(toolCallId, 'slack_update_message', true, {
    updated: true,
    channel: result.data.channel,
    timestamp: result.data.ts,
  }, undefined, startTime);
}

/**
 * Invite a user to a channel (Level 5 - requires CIBA)
 */
export async function slack_invite_user(
  context: SlackToolContext,
  toolCallId: string,
  args: { channel: string; userId: string }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  interface InviteResponse {
    channel: SlackChannel;
  }
  
  const result = await slackRequest<InviteResponse>(context, {
    method: 'POST',
    endpoint: 'conversations.invite',
    body: {
      channel: args.channel,
      users: args.userId,
    },
  });
  
  if (!result.success || !result.data) {
    return createResult(toolCallId, 'slack_invite_user', false, undefined, result.error, startTime);
  }
  
  logger.info('Invited user to Slack channel', {
    userId: context.userId,
    channel: args.channel,
    invitedUser: args.userId,
  });
  
  return createResult(toolCallId, 'slack_invite_user', true, {
    invited: true,
    channel: result.data.channel.name,
    user: args.userId,
  }, undefined, startTime);
}

/**
 * Remove a user from a channel (Level 5 - requires CIBA)
 */
export async function slack_remove_user(
  context: SlackToolContext,
  toolCallId: string,
  args: { channel: string; userId: string }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const result = await slackRequest<{ ok: boolean }>(context, {
    method: 'POST',
    endpoint: 'conversations.kick',
    body: {
      channel: args.channel,
      user: args.userId,
    },
  });
  
  if (!result.success) {
    return createResult(toolCallId, 'slack_remove_user', false, undefined, result.error, startTime);
  }
  
  logger.info('Removed user from Slack channel', {
    userId: context.userId,
    channel: args.channel,
    removedUser: args.userId,
  });
  
  return createResult(toolCallId, 'slack_remove_user', true, {
    removed: true,
    channel: args.channel,
    user: args.userId,
  }, undefined, startTime);
}

// ============================================================================
// TOOL REGISTRY
// ============================================================================

export const SlackTools = {
  slack_list_channels,
  slack_get_channel,
  slack_search_messages,
  slack_send_message,
  slack_post_alert,
  slack_update_message,
  slack_invite_user,
  slack_remove_user,
};

export type SlackToolName = keyof typeof SlackTools;
