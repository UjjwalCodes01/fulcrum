/**
 * GitHub Tools
 * 
 * Implements all GitHub-related tools for the Fulcrum agent.
 * Each tool:
 * 1. Gets token from Token Vault
 * 2. Calls GitHub API via Octokit
 * 3. Returns normalized results
 * 
 * Risk Levels:
 * - Level 1: list_repos, get_repo, read_file (read-only)
 * - Level 2: scan_secrets, search_code (search)
 * - Level 3: create_issue, create_branch (create)
 * - Level 4: create_pr (update)
 * - Level 5: merge_pr, delete_branch (destructive - requires CIBA)
 */

import { Octokit } from '@octokit/rest';
import { logger } from '../../utils/logger.js';
import { exchangeAccessTokenForFederatedToken } from '../../services/token-vault.js';
import { executeWithRetry, CircuitBreaker } from '../../utils/error-handling.js';
import type { ToolResult } from '../state.js';

// ============================================================================
// CIRCUIT BREAKER FOR GITHUB
// ============================================================================

const githubCircuitBreaker = new CircuitBreaker('github', 5, 60000, 300000);

// ============================================================================
// TYPES
// ============================================================================

export interface GitHubToolContext {
  userId: string;
  userAccessToken: string;  // Auth0 access token for Token Vault exchange
}

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  url: string;
  defaultBranch: string;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  openIssuesCount: number;
  pushedAt: string | null;
  updatedAt: string | null;
}

export interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string;
  encoding: string;
}

export interface SecretFinding {
  type: string;
  pattern: string;
  file: string;
  line: number;
  snippet: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

// ============================================================================
// OCTOKIT CLIENT
// ============================================================================

/**
 * Create authenticated Octokit client using Token Vault
 */
async function createOctokitClient(context: GitHubToolContext): Promise<Octokit | null> {
  try {
    // Exchange Auth0 token for GitHub token via Token Vault
    const tokenResult = await exchangeAccessTokenForFederatedToken(
      context.userAccessToken,
      'github'
    );
    
    if (!tokenResult.success || !tokenResult.accessToken) {
      logger.error('Failed to get GitHub token from Token Vault', {
        userId: context.userId,
        error: tokenResult.error,
      });
      return null;
    }
    
    logger.info('GitHub token acquired from Token Vault', {
      userId: context.userId,
      expiresIn: tokenResult.expiresIn,
    });
    
    return new Octokit({
      auth: tokenResult.accessToken,
    });
  } catch (error) {
    logger.error('Failed to create Octokit client', { error });
    return null;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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

/**
 * Normalize repository data
 */
function normalizeRepo(repo: {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string | null;
  updated_at: string | null;
}): GitHubRepository {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    private: repo.private,
    url: repo.html_url,
    defaultBranch: repo.default_branch,
    language: repo.language,
    stargazersCount: repo.stargazers_count,
    forksCount: repo.forks_count,
    openIssuesCount: repo.open_issues_count,
    pushedAt: repo.pushed_at,
    updatedAt: repo.updated_at,
  };
}

// ============================================================================
// SECRET PATTERNS
// ============================================================================

const SECRET_PATTERNS = [
  { type: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/g, severity: 'critical' as const },
  { type: 'AWS Secret Key', pattern: /[A-Za-z0-9/+=]{40}/g, severity: 'critical' as const },
  { type: 'GitHub Token', pattern: /gh[ps]_[A-Za-z0-9]{36,}/g, severity: 'critical' as const },
  { type: 'GitHub OAuth', pattern: /gho_[A-Za-z0-9]{36,}/g, severity: 'critical' as const },
  { type: 'Private Key', pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/g, severity: 'critical' as const },
  { type: 'Slack Token', pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}/g, severity: 'high' as const },
  { type: 'Slack Webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[a-zA-Z0-9]+/g, severity: 'high' as const },
  { type: 'Google API Key', pattern: /AIza[0-9A-Za-z-_]{35}/g, severity: 'high' as const },
  { type: 'Stripe Key', pattern: /sk_live_[0-9a-zA-Z]{24,}/g, severity: 'critical' as const },
  { type: 'Database URL', pattern: /postgres(ql)?:\/\/[^:]+:[^@]+@[^/]+\/[^\s"']+/g, severity: 'high' as const },
  { type: 'Generic API Key', pattern: /api[_-]?key['":\s=]+['"]?[a-zA-Z0-9]{20,}['"]?/gi, severity: 'medium' as const },
  { type: 'Generic Secret', pattern: /secret['":\s=]+['"]?[a-zA-Z0-9]{20,}['"]?/gi, severity: 'medium' as const },
  { type: 'Password in URL', pattern: /[a-z]+:\/\/[^:]+:[^@]+@/gi, severity: 'high' as const },
];

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

/**
 * List repositories for the authenticated user
 */
export async function github_list_repos(
  context: GitHubToolContext,
  toolCallId: string,
  args: { visibility?: 'all' | 'public' | 'private'; sort?: string; limit?: number }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const octokit = await createOctokitClient(context);
  if (!octokit) {
    return createResult(toolCallId, 'github_list_repos', false, undefined, 
      'Failed to authenticate with GitHub. Please reconnect your GitHub account.', startTime);
  }
  
  try {
    // Execute with retry and circuit breaker
    const repos = await githubCircuitBreaker.execute(async () => {
      return executeWithRetry(
        async () => {
          const { data } = await octokit.repos.listForAuthenticatedUser({
            visibility: args.visibility,
            sort: args.sort as 'created' | 'updated' | 'pushed' | 'full_name' | undefined,
            per_page: Math.min(args.limit || 30, 100),
          });
          return data;
        },
        { maxAttempts: 3, baseDelayMs: 1000 },
        'github'
      );
    });
    
    const normalizedRepos = repos.map(normalizeRepo);
    
    logger.info('Listed GitHub repos', { 
      userId: context.userId, 
      count: normalizedRepos.length,
    });
    
    return createResult(toolCallId, 'github_list_repos', true, {
      repositories: normalizedRepos,
      count: normalizedRepos.length,
    }, undefined, startTime);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('github_list_repos failed', { error: message });
    return createResult(toolCallId, 'github_list_repos', false, undefined, message, startTime);
  }
}

/**
 * Get detailed information about a repository
 */
export async function github_get_repo(
  context: GitHubToolContext,
  toolCallId: string,
  args: { owner: string; repo: string }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const octokit = await createOctokitClient(context);
  if (!octokit) {
    return createResult(toolCallId, 'github_get_repo', false, undefined,
      'Failed to authenticate with GitHub.', startTime);
  }
  
  try {
    const { data: repo } = await octokit.repos.get({
      owner: args.owner,
      repo: args.repo,
    });
    
    return createResult(toolCallId, 'github_get_repo', true, {
      repository: normalizeRepo(repo as Parameters<typeof normalizeRepo>[0]),
      owner: {
        login: repo.owner.login,
        type: repo.owner.type,
        avatarUrl: repo.owner.avatar_url,
      },
      license: repo.license?.name,
      topics: repo.topics,
      visibility: repo.visibility,
      hasIssues: repo.has_issues,
      hasProjects: repo.has_projects,
      hasWiki: repo.has_wiki,
    }, undefined, startTime);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return createResult(toolCallId, 'github_get_repo', false, undefined, message, startTime);
  }
}

/**
 * Read file contents from a repository
 */
export async function github_read_file(
  context: GitHubToolContext,
  toolCallId: string,
  args: { owner: string; repo: string; path: string; ref?: string }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const octokit = await createOctokitClient(context);
  if (!octokit) {
    return createResult(toolCallId, 'github_read_file', false, undefined,
      'Failed to authenticate with GitHub.', startTime);
  }
  
  try {
    const { data } = await octokit.repos.getContent({
      owner: args.owner,
      repo: args.repo,
      path: args.path,
      ref: args.ref,
    });
    
    if (Array.isArray(data)) {
      // It's a directory
      return createResult(toolCallId, 'github_read_file', true, {
        type: 'directory',
        path: args.path,
        files: data.map(f => ({ name: f.name, type: f.type, path: f.path })),
      }, undefined, startTime);
    }
    
    if (data.type !== 'file' || !('content' in data)) {
      return createResult(toolCallId, 'github_read_file', false, undefined,
        'Path is not a file', startTime);
    }
    
    // Decode base64 content
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    
    return createResult(toolCallId, 'github_read_file', true, {
      file: {
        name: data.name,
        path: data.path,
        sha: data.sha,
        size: data.size,
        content,
        encoding: 'utf-8',
      },
    }, undefined, startTime);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return createResult(toolCallId, 'github_read_file', false, undefined, message, startTime);
  }
}

/**
 * Scan repository for hardcoded secrets
 */
export async function github_scan_secrets(
  context: GitHubToolContext,
  toolCallId: string,
  args: { owner: string; repo: string; patterns?: string[]; maxFiles?: number }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const octokit = await createOctokitClient(context);
  if (!octokit) {
    return createResult(toolCallId, 'github_scan_secrets', false, undefined,
      'Failed to authenticate with GitHub.', startTime);
  }
  
  const findings: SecretFinding[] = [];
  const scannedFiles: string[] = [];
  const errors: string[] = [];
  const maxFilesToScan = Math.min(args.maxFiles || 100, 200); // Default 100, max 200
  
  try {
    // Get repository contents recursively (limited to avoid rate limits)
    const { data: tree } = await octokit.git.getTree({
      owner: args.owner,
      repo: args.repo,
      tree_sha: 'HEAD',
      recursive: 'true',
    });
    
    // Filter for files that might contain secrets
    const filesToScan = tree.tree
      .filter(item => {
        if (item.type !== 'blob') return false;
        const path = item.path || '';
        // Skip binaries and node_modules
        if (path.includes('node_modules/')) return false;
        if (path.includes('.min.')) return false;
        if (/\.(png|jpg|gif|ico|woff|ttf|eot|pdf|zip|tar|gz)$/i.test(path)) return false;
        return true;
      })
      .slice(0, maxFilesToScan); // Configurable limit with safety cap
    
    // Scan each file
    for (const file of filesToScan) {
      if (!file.path) continue;
      
      try {
        const { data } = await octokit.repos.getContent({
          owner: args.owner,
          repo: args.repo,
          path: file.path,
        });
        
        if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
          continue;
        }
        
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        const lines = content.split('\n');
        
        scannedFiles.push(file.path);
        
        // Build patterns list: use built-in SECRET_PATTERNS + any custom patterns
        const patternsToScan: Array<{ type: string; pattern: RegExp; severity: 'critical' | 'high' | 'medium' | 'low' }> = [...SECRET_PATTERNS];
        
        // Add custom patterns if provided
        if (args.patterns && args.patterns.length > 0) {
          for (const customPattern of args.patterns) {
            try {
              patternsToScan.push({
                type: 'custom',
                pattern: new RegExp(customPattern, 'gi'),
                severity: 'medium',
              });
            } catch {
              // Invalid regex, skip
              errors.push(`Invalid pattern: ${customPattern}`);
            }
          }
        }
        
        // Check each pattern
        for (const { type, pattern, severity } of patternsToScan) {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            pattern.lastIndex = 0; // Reset regex
            
            if (pattern.test(line)) {
              // Mask the actual secret in the snippet
              const maskedLine = line.replace(pattern, `[${type.toUpperCase()}_REDACTED]`);
              
              findings.push({
                type,
                pattern: pattern.source,
                file: file.path,
                line: i + 1,
                snippet: maskedLine.substring(0, 100),
                severity,
              });
            }
          }
        }
      } catch {
        // Skip files we can't read
        errors.push(`Could not read: ${file.path}`);
      }
    }
    
    // Sort findings by severity
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
    
    logger.info('Secret scan complete', {
      userId: context.userId,
      repo: `${args.owner}/${args.repo}`,
      filesScanned: scannedFiles.length,
      findingsCount: findings.length,
    });
    
    return createResult(toolCallId, 'github_scan_secrets', true, {
      findings,
      summary: {
        filesScanned: scannedFiles.length,
        totalFindings: findings.length,
        critical: findings.filter(f => f.severity === 'critical').length,
        high: findings.filter(f => f.severity === 'high').length,
        medium: findings.filter(f => f.severity === 'medium').length,
        low: findings.filter(f => f.severity === 'low').length,
      },
      errors: errors.length > 0 ? errors : undefined,
    }, undefined, startTime);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return createResult(toolCallId, 'github_scan_secrets', false, undefined, message, startTime);
  }
}

/**
 * Search code across repositories with pagination support
 */
export async function github_search_code(
  context: GitHubToolContext,
  toolCallId: string,
  args: { query: string; owner?: string; repo?: string; language?: string; perPage?: number; page?: number }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const octokit = await createOctokitClient(context);
  if (!octokit) {
    return createResult(toolCallId, 'github_search_code', false, undefined,
      'Failed to authenticate with GitHub.', startTime);
  }
  
  try {
    // Build search query
    let q = args.query;
    if (args.owner && args.repo) {
      q += ` repo:${args.owner}/${args.repo}`;
    } else if (args.owner) {
      q += ` user:${args.owner}`;
    }
    if (args.language) {
      q += ` language:${args.language}`;
    }
    
    const perPage = Math.min(args.perPage || 30, 100); // GitHub max is 100
    const page = args.page || 1;
    
    const { data } = await octokit.search.code({
      q,
      per_page: perPage,
      page,
    });
    
    const hasNextPage = data.total_count > page * perPage;
    
    return createResult(toolCallId, 'github_search_code', true, {
      totalCount: data.total_count,
      results: data.items.map(item => ({
        name: item.name,
        path: item.path,
        repository: item.repository.full_name,
        url: item.html_url,
        score: item.score,
      })),
      pagination: {
        page,
        perPage,
        hasNextPage,
        nextPage: hasNextPage ? page + 1 : undefined,
      },
    }, undefined, startTime);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return createResult(toolCallId, 'github_search_code', false, undefined, message, startTime);
  }
}

/**
 * Create a new issue
 */
export async function github_create_issue(
  context: GitHubToolContext,
  toolCallId: string,
  args: { 
    owner: string; 
    repo: string; 
    title: string; 
    body: string; 
    labels?: string[]; 
    assignees?: string[] 
  }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const octokit = await createOctokitClient(context);
  if (!octokit) {
    return createResult(toolCallId, 'github_create_issue', false, undefined,
      'Failed to authenticate with GitHub.', startTime);
  }
  
  try {
    const { data: issue } = await octokit.issues.create({
      owner: args.owner,
      repo: args.repo,
      title: args.title,
      body: args.body,
      labels: args.labels,
      assignees: args.assignees,
    });
    
    logger.info('Created GitHub issue', {
      userId: context.userId,
      repo: `${args.owner}/${args.repo}`,
      issueNumber: issue.number,
    });
    
    return createResult(toolCallId, 'github_create_issue', true, {
      issue: {
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        state: issue.state,
        createdAt: issue.created_at,
      },
    }, undefined, startTime);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return createResult(toolCallId, 'github_create_issue', false, undefined, message, startTime);
  }
}

/**
 * Create a new branch
 */
export async function github_create_branch(
  context: GitHubToolContext,
  toolCallId: string,
  args: { owner: string; repo: string; branch: string; from?: string }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const octokit = await createOctokitClient(context);
  if (!octokit) {
    return createResult(toolCallId, 'github_create_branch', false, undefined,
      'Failed to authenticate with GitHub.', startTime);
  }
  
  try {
    // Get source branch ref
    const sourceBranch = args.from || 'main';
    const { data: sourceRef } = await octokit.git.getRef({
      owner: args.owner,
      repo: args.repo,
      ref: `heads/${sourceBranch}`,
    }).catch(() => octokit.git.getRef({
      owner: args.owner,
      repo: args.repo,
      ref: 'heads/master',
    }));
    
    // Create new branch
    const { data: newRef } = await octokit.git.createRef({
      owner: args.owner,
      repo: args.repo,
      ref: `refs/heads/${args.branch}`,
      sha: sourceRef.object.sha,
    });
    
    logger.info('Created GitHub branch', {
      userId: context.userId,
      repo: `${args.owner}/${args.repo}`,
      branch: args.branch,
    });
    
    return createResult(toolCallId, 'github_create_branch', true, {
      branch: {
        name: args.branch,
        sha: newRef.object.sha,
        url: newRef.url,
      },
    }, undefined, startTime);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return createResult(toolCallId, 'github_create_branch', false, undefined, message, startTime);
  }
}

/**
 * Create a pull request
 */
export async function github_create_pr(
  context: GitHubToolContext,
  toolCallId: string,
  args: { 
    owner: string; 
    repo: string; 
    title: string; 
    body: string; 
    head: string; 
    base: string; 
    draft?: boolean 
  }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const octokit = await createOctokitClient(context);
  if (!octokit) {
    return createResult(toolCallId, 'github_create_pr', false, undefined,
      'Failed to authenticate with GitHub.', startTime);
  }
  
  try {
    const { data: pr } = await octokit.pulls.create({
      owner: args.owner,
      repo: args.repo,
      title: args.title,
      body: args.body,
      head: args.head,
      base: args.base,
      draft: args.draft,
    });
    
    logger.info('Created GitHub PR', {
      userId: context.userId,
      repo: `${args.owner}/${args.repo}`,
      prNumber: pr.number,
    });
    
    return createResult(toolCallId, 'github_create_pr', true, {
      pullRequest: {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state: pr.state,
        draft: pr.draft,
        head: pr.head.ref,
        base: pr.base.ref,
        createdAt: pr.created_at,
      },
    }, undefined, startTime);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return createResult(toolCallId, 'github_create_pr', false, undefined, message, startTime);
  }
}

/**
 * Merge a pull request (Level 5 - requires CIBA)
 */
export async function github_merge_pr(
  context: GitHubToolContext,
  toolCallId: string,
  args: { 
    owner: string; 
    repo: string; 
    pull_number: number; 
    merge_method?: 'merge' | 'squash' | 'rebase';
    commit_message?: string 
  }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const octokit = await createOctokitClient(context);
  if (!octokit) {
    return createResult(toolCallId, 'github_merge_pr', false, undefined,
      'Failed to authenticate with GitHub.', startTime);
  }
  
  try {
    const { data: merged } = await octokit.pulls.merge({
      owner: args.owner,
      repo: args.repo,
      pull_number: args.pull_number,
      merge_method: args.merge_method || 'merge',
      commit_message: args.commit_message,
    });
    
    logger.info('Merged GitHub PR', {
      userId: context.userId,
      repo: `${args.owner}/${args.repo}`,
      prNumber: args.pull_number,
      sha: merged.sha,
    });
    
    return createResult(toolCallId, 'github_merge_pr', true, {
      merged: true,
      sha: merged.sha,
      message: merged.message,
    }, undefined, startTime);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return createResult(toolCallId, 'github_merge_pr', false, undefined, message, startTime);
  }
}

/**
 * Delete a branch (Level 5 - requires CIBA)
 */
export async function github_delete_branch(
  context: GitHubToolContext,
  toolCallId: string,
  args: { owner: string; repo: string; branch: string }
): Promise<ToolResult> {
  const startTime = Date.now();
  
  const octokit = await createOctokitClient(context);
  if (!octokit) {
    return createResult(toolCallId, 'github_delete_branch', false, undefined,
      'Failed to authenticate with GitHub.', startTime);
  }
  
  try {
    await octokit.git.deleteRef({
      owner: args.owner,
      repo: args.repo,
      ref: `heads/${args.branch}`,
    });
    
    logger.info('Deleted GitHub branch', {
      userId: context.userId,
      repo: `${args.owner}/${args.repo}`,
      branch: args.branch,
    });
    
    return createResult(toolCallId, 'github_delete_branch', true, {
      deleted: true,
      branch: args.branch,
    }, undefined, startTime);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return createResult(toolCallId, 'github_delete_branch', false, undefined, message, startTime);
  }
}

// ============================================================================
// TOOL REGISTRY
// ============================================================================

export const GitHubTools = {
  github_list_repos,
  github_get_repo,
  github_read_file,
  github_scan_secrets,
  github_search_code,
  github_create_issue,
  github_create_branch,
  github_create_pr,
  github_merge_pr,
  github_delete_branch,
};

export type GitHubToolName = keyof typeof GitHubTools;
