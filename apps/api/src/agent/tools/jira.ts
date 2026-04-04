/**
 * Jira Tools
 * 
 * Implements all Jira-related tools for the Fulcrum agent.
 * Uses Jira REST API v3.
 * 
 * Risk Levels:
 * - Level 1: list_projects, get_issue (read-only)
 * - Level 2: search_issues (search)
 * - Level 3: create_issue (create)
 * - Level 4: update_issue, transition_issue (update)
 * - Level 5: delete_issue (destructive - requires CIBA)
 */

import { logger } from '../../utils/logger.js';
import { executeWithRetry, CircuitBreaker } from '../../utils/error-handling.js';
import { exchangeAccessTokenForFederatedToken } from '../../services/token-vault.js';
import type { ToolResult } from '../state.js';

// ============================================================================
// CIRCUIT BREAKER FOR JIRA
// ============================================================================

const jiraCircuitBreaker = new CircuitBreaker('jira', 5, 60000, 300000);

// ============================================================================
// TYPES
// ============================================================================

export interface JiraToolContext {
  userId: string;
  userAccessToken: string;
  preferredSiteId?: string; // Optional: User's preferred Jira site for multi-site accounts
}

/**
 * Jira site info including API URL and browse URL
 */
interface JiraSiteInfo {
  siteId: string;      // Atlassian cloud ID
  siteName: string;    // Human-readable site name
  apiUrl: string;      // e.g., https://api.atlassian.com/ex/jira/{cloudId}
  browseUrl: string;   // e.g., https://yoursite.atlassian.net
}

// Cache site info per access token to avoid repeated API calls
const siteInfoCache = new Map<string, { sites: JiraSiteInfo[]; expiresAt: number }>();

/**
 * Get all Jira sites accessible to the user
 */
async function getAllJiraSites(accessToken: string): Promise<JiraSiteInfo[]> {
  // Check cache first
  const cached = siteInfoCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.sites;
  }
  
  try {
    // Get accessible resources (sites) for the user
    const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      logger.error('Failed to fetch Jira accessible resources', {
        status: response.status,
      });
      return [];
    }
    
    const resources = await response.json() as Array<{
      id: string;
      url: string;
      name: string;
      scopes: string[];
      avatarUrl?: string;
    }>;
    
    if (!Array.isArray(resources) || resources.length === 0) {
      logger.warn('No Jira sites accessible for user');
      return [];
    }
    
    const sites: JiraSiteInfo[] = resources.map(site => ({
      siteId: site.id,
      siteName: site.name,
      apiUrl: `https://api.atlassian.com/ex/jira/${site.id}`,
      browseUrl: site.url,
    }));
    
    // Cache for 5 minutes
    siteInfoCache.set(accessToken, {
      sites,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    
    return sites;
  } catch (error) {
    logger.error('Error fetching Jira sites', { error });
    return [];
  }
}

/**
 * Get Jira site info for the authenticated user
 * For multi-site users, preferredSiteId is REQUIRED
 * 
 * @returns JiraSiteInfo if successful, null if user has multiple sites but no preference
 * @throws Never throws - returns null on error which callers must handle
 */
async function getJiraSiteInfo(accessToken: string, preferredSiteId?: string): Promise<JiraSiteInfo | null> {
  const sites = await getAllJiraSites(accessToken);
  
  if (sites.length === 0) {
    logger.warn('No Jira sites accessible for user');
    return null;
  }
  
  // Single site: safe to use automatically
  if (sites.length === 1) {
    logger.info('Using only available Jira site', {
      siteId: sites[0].siteId,
      siteName: sites[0].siteName,
    });
    return sites[0];
  }
  
  // Multiple sites: REQUIRE preferredSiteId for production safety
  if (!preferredSiteId) {
    logger.error('MULTI-SITE USER WITHOUT PREFERENCE: Operation blocked for safety', {
      totalSites: sites.length,
      availableSites: sites.map(s => ({ id: s.siteId, name: s.siteName })),
      action: 'BLOCKED',
      hint: 'User must call jira_list_sites and select a site before other Jira operations',
    });
    return null; // Block the operation
  }
  
  // Find the preferred site
  const preferred = sites.find(s => s.siteId === preferredSiteId);
  if (preferred) {
    logger.info('Using preferred Jira site', {
      siteId: preferred.siteId,
      siteName: preferred.siteName,
    });
    return preferred;
  }
  
  // Preferred site not found in accessible sites
  logger.error('Preferred Jira site not accessible to user', {
    requestedSiteId: preferredSiteId,
    availableSites: sites.map(s => ({ id: s.siteId, name: s.siteName })),
  });
  return null; // Block the operation
}

interface JiraProject {
  id: string;
  key: string;
  name: string;
  description?: string;
  lead?: {
    accountId: string;
    displayName: string;
  };
  projectTypeKey: string;
}

// Note: JiraIssue is a simplified type for internal use; actual API responses use JiraIssueResponse
// which is defined inline in each function to handle Atlassian Document Format complexity

interface JiraClient {
  baseUrl: string;    // API URL for making requests
  browseUrl: string;  // User-facing URL for issue links
  token: string;
}

/**
 * Create authenticated Jira client
 * Gets token from Token Vault and determines user's cloud URL
 */
async function createJiraClient(context: JiraToolContext): Promise<JiraClient | null> {
  try {
    // Get Jira token from Token Vault
    const tokenResult = await exchangeAccessTokenForFederatedToken(
      context.userAccessToken,
      'jira'
    );
    
    if (!tokenResult.success || !tokenResult.accessToken) {
      logger.error('Failed to get Jira token', { 
        userId: context.userId,
        error: tokenResult.error 
      });
      return null;
    }
    
    // Get user's Jira site info (API URL + browse URL)
    const siteInfo = await getJiraSiteInfo(tokenResult.accessToken, context.preferredSiteId);
    
    if (!siteInfo) {
      // This can fail for two reasons:
      // 1. User has multiple Jira sites but no preferredSiteId (production safety block)
      // 2. User has no accessible Jira sites
      logger.error('Cannot create Jira client - site selection required or no sites accessible', { 
        userId: context.userId,
        hasPreference: !!context.preferredSiteId,
      });
      return null;
    }
    
    return {
      baseUrl: siteInfo.apiUrl,
      browseUrl: siteInfo.browseUrl,
      token: tokenResult.accessToken
    };
  } catch (error) {
    logger.error('Failed to create Jira client', { 
      userId: context.userId, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }
}

// ============================================================================
// JIRA API CLIENT
// ============================================================================

interface JiraRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}

/**
 * Make authenticated Jira API request
 * Includes production safeguards: circuit breaker + retry
 */
async function jiraRequest<T>(
  context: JiraToolContext,
  options: JiraRequestOptions
): Promise<{ success: boolean; data?: T; browseUrl?: string; error?: string }> {
  try {
    // Get Jira client outside the retry loop to avoid repeated token exchanges
    const client = await createJiraClient(context);
    
    if (!client) {
      // Client creation can fail for:
      // 1. Token exchange failure
      // 2. Multi-site user without preferredSiteId (safety block)
      // 3. No accessible Jira sites
      const hasPreference = !!context.preferredSiteId;
      const errorMessage = hasPreference 
        ? 'Failed to authenticate with Jira or access the specified site'
        : 'Cannot proceed: You have multiple Jira sites. Please call jira_list_sites first to select which site to use.';
      
      return { success: false, error: errorMessage };
    }
    
    const result = await jiraCircuitBreaker.execute(async () => {
      return executeWithRetry(
        async () => {
          const url = `${client.baseUrl}/rest/api/3${options.path}`;
          
          const response = await fetch(url, {
            method: options.method,
            headers: {
              'Authorization': `Bearer ${client.token}`,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Jira API error (${response.status}): ${errorText}`);
          }
          
          // Handle no content responses
          if (response.status === 204) {
            return null;
          }
          
          const data = await response.json() as T;
          return data;
        },
        { maxAttempts: 3, baseDelayMs: 1000 },
        'jira'
      );
    });
    
    return { success: true, data: result || undefined, browseUrl: client.browseUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Jira API call failed after retries', { 
      userId: context.userId,
      method: options.method,
      path: options.path,
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
 * List all Jira sites accessible to the user
 * Useful for multi-site users to select which site to use
 */
export async function jira_list_sites(
  context: JiraToolContext,
  toolCallId: string,
  _args: Record<string, never>
): Promise<ToolResult> {
  const startTime = Date.now();
  
  try {
    // Get Jira token from Token Vault
    const tokenResult = await exchangeAccessTokenForFederatedToken(
      context.userAccessToken,
      'jira'
    );
    
    if (!tokenResult.success || !tokenResult.accessToken) {
      return createResult(toolCallId, 'jira_list_sites', false, undefined,
        'Failed to authenticate with Jira', startTime);
    }
    
    const sites = await getAllJiraSites(tokenResult.accessToken);
    
    if (sites.length === 0) {
      return createResult(toolCallId, 'jira_list_sites', false, undefined,
        'No Jira sites accessible for this user', startTime);
    }
    
    logger.info('Listed Jira sites', {
      userId: context.userId,
      siteCount: sites.length,
    });
    
    return createResult(toolCallId, 'jira_list_sites', true, {
      sites: sites.map(s => ({
        id: s.siteId,
        name: s.siteName,
        url: s.browseUrl,
      })),
      count: sites.length,
      currentSite: context.preferredSiteId 
        ? sites.find(s => s.siteId === context.preferredSiteId)?.siteName 
        : sites[0].siteName,
    }, undefined, startTime);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return createResult(toolCallId, 'jira_list_sites', false, undefined, message, startTime);
  }
}

/**
 * List Jira projects accessible to the user
 */
export async function jira_list_projects(
  context: JiraToolContext,
  toolCallId: string,
  args: { limit?: number }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const result = await jiraRequest<{ values: JiraProject[] }>(context, {
    method: 'GET',
    path: `/project/search?maxResults=${args.limit || 50}`,
  });
  
  if (!result.success) {
    return createResult(toolCallId, 'jira_list_projects', false, undefined, result.error, startTime);
  }
  
  const projects = (result.data?.values || []).map(p => ({
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    lead: p.lead?.displayName,
    type: p.projectTypeKey,
  }));
  
  logger.info('Listed Jira projects', { userId: context.userId, count: projects.length });
  
  return createResult(toolCallId, 'jira_list_projects', true, {
    projects,
    count: projects.length,
  }, undefined, startTime);
}

/**
 * Get detailed information about a Jira issue
 */
export async function jira_get_issue(
  context: JiraToolContext,
  toolCallId: string,
  args: { issueKey: string }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  interface JiraIssueResponse {
    id: string;
    key: string;
    fields: {
      summary: string;
      description?: {
        content?: Array<{
          content?: Array<{
            text?: string;
          }>;
        }>;
      };
      status: {
        name: string;
        statusCategory: {
          key: string;
          name: string;
        };
      };
      priority?: {
        name: string;
      };
      assignee?: {
        accountId: string;
        displayName: string;
      };
      reporter?: {
        accountId: string;
        displayName: string;
      };
      created: string;
      updated: string;
      labels: string[];
      issuetype: {
        name: string;
      };
      project: {
        key: string;
        name: string;
      };
    };
  }
  
  const result = await jiraRequest<JiraIssueResponse>(context, {
    method: 'GET',
    path: `/issue/${args.issueKey}`,
  });
  
  if (!result.success || !result.data) {
    return createResult(toolCallId, 'jira_get_issue', false, undefined, result.error, startTime);
  }
  
  const issue = result.data;
  
  // Extract text from ADF description
  const description = issue.fields.description?.content
    ?.map(block => block.content?.map(c => c.text).join(''))
    .join('\n') || '';
  
  return createResult(toolCallId, 'jira_get_issue', true, {
    issue: {
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      description,
      status: issue.fields.status.name,
      statusCategory: issue.fields.status.statusCategory.name,
      priority: issue.fields.priority?.name,
      assignee: issue.fields.assignee?.displayName,
      reporter: issue.fields.reporter?.displayName,
      type: issue.fields.issuetype.name,
      project: issue.fields.project.name,
      labels: issue.fields.labels,
      created: issue.fields.created,
      updated: issue.fields.updated,
    },
  }, undefined, startTime);
}

/**
 * Search for issues using JQL
 */
export async function jira_search_issues(
  context: JiraToolContext,
  toolCallId: string,
  args: { jql: string; maxResults?: number; fields?: string[] }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const fields = args.fields?.join(',') || 'summary,status,priority,assignee,created,updated,labels';
  
  interface SearchResponse {
    total: number;
    startAt: number;
    maxResults: number;
    issues: Array<{
      id: string;
      key: string;
      fields: {
        summary: string;
        status?: { name: string };
        priority?: { name: string };
        assignee?: { displayName: string };
        created?: string;
        updated?: string;
        labels?: string[];
      };
    }>;
  }
  
  const result = await jiraRequest<SearchResponse>(context, {
    method: 'GET',
    path: `/search?jql=${encodeURIComponent(args.jql)}&maxResults=${args.maxResults || 50}&fields=${fields}`,
  });
  
  if (!result.success || !result.data) {
    return createResult(toolCallId, 'jira_search_issues', false, undefined, result.error, startTime);
  }
  
  const issues = result.data.issues.map(issue => ({
    id: issue.id,
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name,
    priority: issue.fields.priority?.name,
    assignee: issue.fields.assignee?.displayName,
    created: issue.fields.created,
    updated: issue.fields.updated,
    labels: issue.fields.labels || [],
  }));
  
  logger.info('Searched Jira issues', { 
    userId: context.userId, 
    jql: args.jql,
    resultCount: issues.length,
    totalCount: result.data.total,
  });
  
  return createResult(toolCallId, 'jira_search_issues', true, {
    issues,
    total: result.data.total,
    returned: issues.length,
  }, undefined, startTime);
}

/**
 * Create a new Jira issue
 */
export async function jira_create_issue(
  context: JiraToolContext,
  toolCallId: string,
  args: {
    projectKey: string;
    issueType: string;
    summary: string;
    description?: string;
    priority?: string;
    labels?: string[];
  }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  // Build the request body
  const fields: Record<string, unknown> = {
    project: { key: args.projectKey },
    issuetype: { name: args.issueType },
    summary: args.summary,
  };
  
  // Add optional fields
  if (args.description) {
    // Convert to Atlassian Document Format (ADF)
    fields.description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: args.description }
          ]
        }
      ]
    };
  }
  
  if (args.priority) {
    fields.priority = { name: args.priority };
  }
  
  if (args.labels) {
    fields.labels = args.labels;
  }
  
  interface CreateResponse {
    id: string;
    key: string;
    self: string;
  }
  
  const result = await jiraRequest<CreateResponse>(context, {
    method: 'POST',
    path: '/issue',
    body: { fields },
  });
  
  if (!result.success || !result.data) {
    return createResult(toolCallId, 'jira_create_issue', false, undefined, result.error, startTime);
  }
  
  // Use the browse URL from the Jira client (already fetched with correct token)
  const browseUrl = result.browseUrl || 'https://atlassian.net';
  
  logger.info('Created Jira issue', {
    userId: context.userId,
    project: args.projectKey,
    issueKey: result.data.key,
  });
  
  return createResult(toolCallId, 'jira_create_issue', true, {
    issue: {
      id: result.data.id,
      key: result.data.key,
      url: `${browseUrl}/browse/${result.data.key}`,
    },
  }, undefined, startTime);
}

/**
 * Update an existing Jira issue
 */
export async function jira_update_issue(
  context: JiraToolContext,
  toolCallId: string,
  args: { issueKey: string; fields: Record<string, unknown> }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const result = await jiraRequest<void>(context, {
    method: 'PUT',
    path: `/issue/${args.issueKey}`,
    body: { fields: args.fields },
  });
  
  if (!result.success) {
    return createResult(toolCallId, 'jira_update_issue', false, undefined, result.error, startTime);
  }
  
  logger.info('Updated Jira issue', {
    userId: context.userId,
    issueKey: args.issueKey,
    fields: Object.keys(args.fields),
  });
  
  return createResult(toolCallId, 'jira_update_issue', true, {
    updated: true,
    issueKey: args.issueKey,
  }, undefined, startTime);
}

/**
 * Transition an issue to a new status
 */
export async function jira_transition_issue(
  context: JiraToolContext,
  toolCallId: string,
  args: { issueKey: string; transitionId: string; comment?: string }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const body: Record<string, unknown> = {
    transition: { id: args.transitionId },
  };
  
  if (args.comment) {
    body.update = {
      comment: [
        {
          add: {
            body: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: args.comment }]
                }
              ]
            }
          }
        }
      ]
    };
  }
  
  const result = await jiraRequest<void>(context, {
    method: 'POST',
    path: `/issue/${args.issueKey}/transitions`,
    body,
  });
  
  if (!result.success) {
    return createResult(toolCallId, 'jira_transition_issue', false, undefined, result.error, startTime);
  }
  
  logger.info('Transitioned Jira issue', {
    userId: context.userId,
    issueKey: args.issueKey,
    transitionId: args.transitionId,
  });
  
  return createResult(toolCallId, 'jira_transition_issue', true, {
    transitioned: true,
    issueKey: args.issueKey,
  }, undefined, startTime);
}

/**
 * Delete a Jira issue (Level 5 - requires CIBA)
 */
export async function jira_delete_issue(
  context: JiraToolContext,
  toolCallId: string,
  args: { issueKey: string }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const result = await jiraRequest<void>(context, {
    method: 'DELETE',
    path: `/issue/${args.issueKey}`,
  });
  
  if (!result.success) {
    return createResult(toolCallId, 'jira_delete_issue', false, undefined, result.error, startTime);
  }
  
  logger.info('Deleted Jira issue', {
    userId: context.userId,
    issueKey: args.issueKey,
  });
  
  return createResult(toolCallId, 'jira_delete_issue', true, {
    deleted: true,
    issueKey: args.issueKey,
  }, undefined, startTime);
}

// ============================================================================
// TOOL REGISTRY
// ============================================================================

export const JiraTools = {
  jira_list_sites,
  jira_list_projects,
  jira_get_issue,
  jira_search_issues,
  jira_create_issue,
  jira_update_issue,
  jira_transition_issue,
  jira_delete_issue,
};

export type JiraToolName = keyof typeof JiraTools;
