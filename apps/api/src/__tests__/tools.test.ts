/**
 * Tool Integration Tests
 * 
 * Tests tool execution including:
 * - Happy path execution
 * - Failure handling
 * - Input validation
 * - Audit logging
 * - Rate limiting and circuit breakers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeTool,
  getToolsForConnection,
  toolRequiresCIBA,
  getToolRiskLevel,
  ToolDefinitions,
  type ToolName,
  type ToolContext,
} from '../agent/tools/index.js';

// Mock the external dependencies
vi.mock('../utils/audit.js', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
  recordToolExecution: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ============================================================================
// TOOL DEFINITION TESTS
// ============================================================================

describe('Tool Definitions', () => {
  describe('ToolDefinitions registry', () => {
    it('should define all expected GitHub tools', () => {
      const githubTools = [
        'github_list_repos',
        'github_get_repo',
        'github_read_file',
        'github_scan_secrets',
        'github_search_code',
        'github_create_issue',
        'github_create_branch',
        'github_create_pr',
        'github_merge_pr',
        'github_delete_branch',
      ] as const;
      
      githubTools.forEach(tool => {
        expect(ToolDefinitions[tool]).toBeDefined();
        expect(ToolDefinitions[tool].connection).toBe('github');
      });
    });

    it('should define all expected Jira tools', () => {
      const jiraTools = [
        'jira_list_projects',
        'jira_get_issue',
        'jira_search_issues',
        'jira_create_issue',
        'jira_update_issue',
        'jira_transition_issue',
        'jira_delete_issue',
      ] as const;
      
      jiraTools.forEach(tool => {
        expect(ToolDefinitions[tool]).toBeDefined();
        expect(ToolDefinitions[tool].connection).toBe('jira');
      });
    });

    it('should define all expected Slack tools', () => {
      const slackTools = [
        'slack_list_channels',
        'slack_get_channel',
        'slack_search_messages',
        'slack_send_message',
        'slack_post_alert',
        'slack_update_message',
        'slack_invite_user',
        'slack_remove_user',
      ] as const;
      
      slackTools.forEach(tool => {
        expect(ToolDefinitions[tool]).toBeDefined();
        expect(ToolDefinitions[tool].connection).toBe('slack');
      });
    });
  });

  describe('Risk level configuration', () => {
    it('should have valid risk levels (1-5) for all tools', () => {
      Object.entries(ToolDefinitions).forEach(([_name, def]) => {
        expect(def.riskLevel).toBeGreaterThanOrEqual(1);
        expect(def.riskLevel).toBeLessThanOrEqual(5);
      });
    });

    it('should mark Level 5 tools as requiring CIBA', () => {
      Object.entries(ToolDefinitions).forEach(([_name, def]) => {
        if (def.riskLevel === 5) {
          expect(def.requiresCIBA).toBe(true);
        }
      });
    });

    it('should not mark Level 1-4 tools as requiring CIBA', () => {
      Object.entries(ToolDefinitions).forEach(([_name, def]) => {
        if (def.riskLevel < 5) {
          expect(def.requiresCIBA).toBe(false);
        }
      });
    });
  });

  describe('CIBA-required tools', () => {
    const cibaTools = [
      'github_merge_pr',
      'github_delete_branch',
      'jira_delete_issue',
      'slack_invite_user',
      'slack_remove_user',
    ];

    cibaTools.forEach(tool => {
      it(`should require CIBA for ${tool}`, () => {
        expect(toolRequiresCIBA(tool)).toBe(true);
      });
    });
  });
});

// ============================================================================
// TOOL HELPER TESTS
// ============================================================================

describe('Tool Helpers', () => {
  describe('getToolsForConnection', () => {
    it('should return GitHub tools for github connection', () => {
      const tools = getToolsForConnection('github');
      const toolNames = tools.map(t => t.name);
      expect(tools.length).toBeGreaterThan(0);
      expect(toolNames).toContain('github_list_repos');
      expect(toolNames).toContain('github_create_pr');
      // Should not contain non-GitHub tools
      expect(toolNames).not.toContain('jira_list_projects');
      expect(toolNames).not.toContain('slack_list_channels');
    });

    it('should return Jira tools for jira connection', () => {
      const tools = getToolsForConnection('jira');
      const toolNames = tools.map(t => t.name);
      expect(tools.length).toBeGreaterThan(0);
      expect(toolNames).toContain('jira_list_projects');
      expect(toolNames).toContain('jira_create_issue');
      // Should not contain non-Jira tools
      expect(toolNames).not.toContain('github_list_repos');
      expect(toolNames).not.toContain('slack_list_channels');
    });

    it('should return Slack tools for slack connection', () => {
      const tools = getToolsForConnection('slack');
      const toolNames = tools.map(t => t.name);
      expect(tools.length).toBeGreaterThan(0);
      expect(toolNames).toContain('slack_list_channels');
      expect(toolNames).toContain('slack_send_message');
      // Should not contain non-Slack tools
      expect(toolNames).not.toContain('github_list_repos');
      expect(toolNames).not.toContain('jira_list_projects');
    });

    it('should return empty array for unknown connection', () => {
      const tools = getToolsForConnection('unknown' as any);
      expect(tools).toEqual([]);
    });
  });

  describe('getToolRiskLevel', () => {
    it('should return correct risk level for Level 1 tools', () => {
      expect(getToolRiskLevel('github_list_repos')).toBe(1);
      expect(getToolRiskLevel('jira_list_projects')).toBe(1);
      expect(getToolRiskLevel('slack_list_channels')).toBe(1);
    });

    it('should return correct risk level for Level 5 tools', () => {
      expect(getToolRiskLevel('github_merge_pr')).toBe(5);
      expect(getToolRiskLevel('github_delete_branch')).toBe(5);
      expect(getToolRiskLevel('jira_delete_issue')).toBe(5);
      expect(getToolRiskLevel('slack_invite_user')).toBe(5);
      expect(getToolRiskLevel('slack_remove_user')).toBe(5);
    });

    it('should return 0 for unknown tools', () => {
      expect(getToolRiskLevel('unknown_tool')).toBe(0);
    });
  });

  describe('toolRequiresCIBA', () => {
    it('should return true for Level 5 actions', () => {
      expect(toolRequiresCIBA('github_merge_pr')).toBe(true);
      expect(toolRequiresCIBA('jira_delete_issue')).toBe(true);
    });

    it('should return false for lower risk actions', () => {
      expect(toolRequiresCIBA('github_list_repos')).toBe(false);
      expect(toolRequiresCIBA('jira_create_issue')).toBe(false);
      expect(toolRequiresCIBA('slack_send_message')).toBe(false);
    });

    it('should return false for unknown tools', () => {
      expect(toolRequiresCIBA('unknown_tool')).toBe(false);
    });
  });
});

// ============================================================================
// TOOL EXECUTION TESTS
// ============================================================================

describe('Tool Execution', () => {
  const mockContext: ToolContext = {
    userId: 'test-user',
    userAccessToken: 'mock-token',
    sessionId: 'test-session',
    fgaCheckPassed: true,
    cibaApproved: false,
  };

  describe('executeTool', () => {
    it('should return error for unknown tool', async () => {
      const result = await executeTool(
        'unknown_tool' as ToolName,
        'test-call-id',
        {},
        mockContext
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });

    it('should include execution time in result', async () => {
      const result = await executeTool(
        'github_list_repos' as ToolName,
        'test-call-id',
        {},
        mockContext
      );
      
      expect(typeof result.executionTimeMs).toBe('number');
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should include tool name in result', async () => {
      const result = await executeTool(
        'github_list_repos' as ToolName,
        'test-call-id',
        {},
        mockContext
      );
      
      expect(result.toolName).toBe('github_list_repos');
    });

    it('should include tool call ID in result', async () => {
      const result = await executeTool(
        'github_list_repos' as ToolName,
        'test-call-id-123',
        {},
        mockContext
      );
      
      expect(result.toolCallId).toBe('test-call-id-123');
    });
  });

  describe('Tool input validation', () => {
    it('should handle missing required parameters', async () => {
      // github_get_repo requires owner and repo
      const result = await executeTool(
        'github_get_repo' as ToolName,
        'test-call-id',
        {}, // missing owner and repo
        mockContext
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle invalid parameter types gracefully', async () => {
      const result = await executeTool(
        'github_read_file' as ToolName,
        'test-call-id',
        {
          owner: 123, // should be string
          repo: ['array'], // should be string
          path: true, // should be string
        },
        mockContext
      );
      
      // Should handle gracefully even with wrong types
      expect(result.toolCallId).toBe('test-call-id');
    });
  });
});

// ============================================================================
// TOOL SCHEMA TESTS
// ============================================================================

describe('Tool Schemas', () => {
  describe('Schema validation', () => {
    it('all tools should have name and description', () => {
      Object.entries(ToolDefinitions).forEach(([name, def]) => {
        expect(def.name).toBe(name);
        expect(def.description).toBeDefined();
        expect(def.description.length).toBeGreaterThan(10);
      });
    });

    it('all tools should have a valid connection type', () => {
      const validConnections = ['github', 'jira', 'slack'];
      Object.entries(ToolDefinitions).forEach(([_name, def]) => {
        expect(validConnections).toContain(def.connection);
      });
    });
  });
});

// ============================================================================
// CIRCUIT BREAKER TESTS
// ============================================================================

describe('Circuit Breaker Behavior', () => {
  it('should not immediately fail on first error', async () => {
    // First call - even if it fails, circuit should not be open yet
    const result1 = await executeTool(
      'github_list_repos' as ToolName,
      'test-call-1',
      {},
      mockContext
    );
    
    // Second call should also attempt to execute
    const result2 = await executeTool(
      'github_list_repos' as ToolName,
      'test-call-2',
      {},
      mockContext
    );
    
    // Both should have made attempts (circuit not open)
    expect(result1.toolCallId).toBe('test-call-1');
    expect(result2.toolCallId).toBe('test-call-2');
  });
});

// ============================================================================
// AUDIT LOGGING INTEGRATION TESTS
// ============================================================================

describe('Audit Logging Integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should record audit log on unknown tool', async () => {
    const { recordAuditLog } = await import('../utils/audit.js');
    
    await executeTool(
      'unknown_tool' as ToolName,
      'test-call-id',
      {},
      mockContext
    );
    
    expect(recordAuditLog).toHaveBeenCalled();
  });

  it('should record tool execution on successful execution', async () => {
    const { recordToolExecution } = await import('../utils/audit.js');
    
    await executeTool(
      'github_list_repos' as ToolName,
      'test-call-id',
      {},
      mockContext
    );
    
    // recordToolExecution is called in executeTool
    expect(recordToolExecution).toHaveBeenCalled();
  });

  it('should pass session ID to audit functions', async () => {
    const { recordAuditLog } = await import('../utils/audit.js');
    
    const contextWithSession: ToolContext = {
      ...mockContext,
      sessionId: 'specific-session-id',
    };
    
    await executeTool(
      'unknown_tool' as ToolName,
      'test-call-id',
      {},
      contextWithSession
    );
    
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'specific-session-id',
      })
    );
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe('Edge Cases', () => {
  describe('Empty and null inputs', () => {
    it('should handle empty args object', async () => {
      const result = await executeTool(
        'github_list_repos' as ToolName,
        'test-call-id',
        {},
        mockContext
      );
      
      expect(result.toolCallId).toBeDefined();
    });

    it('should handle undefined values in args', async () => {
      const result = await executeTool(
        'github_read_file' as ToolName,
        'test-call-id',
        {
          owner: undefined,
          repo: undefined,
          path: undefined,
        },
        mockContext
      );
      
      expect(result.toolCallId).toBeDefined();
    });
  });

  describe('Context edge cases', () => {
    it('should handle missing sessionId', async () => {
      const contextNoSession: ToolContext = {
        userId: 'test-user',
        userAccessToken: 'mock-token',
        // no sessionId
      };
      
      const result = await executeTool(
        'github_list_repos' as ToolName,
        'test-call-id',
        {},
        contextNoSession
      );
      
      expect(result.toolCallId).toBeDefined();
    });

    it('should handle empty token', async () => {
      const contextEmptyToken: ToolContext = {
        userId: 'test-user',
        userAccessToken: '',
        sessionId: 'test-session',
      };
      
      const result = await executeTool(
        'github_list_repos' as ToolName,
        'test-call-id',
        {},
        contextEmptyToken
      );
      
      // Should still attempt execution, may fail due to auth
      expect(result.toolCallId).toBeDefined();
    });
  });

  describe('Large inputs', () => {
    it('should handle very long string parameters', async () => {
      const longString = 'a'.repeat(10000);
      
      const result = await executeTool(
        'github_read_file' as ToolName,
        'test-call-id',
        {
          owner: longString,
          repo: longString,
          path: longString,
        },
        mockContext
      );
      
      expect(result.toolCallId).toBeDefined();
    });

    it('should handle many parameters', async () => {
      const manyParams: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        manyParams[`param${i}`] = `value${i}`;
      }
      
      const result = await executeTool(
        'jira_search_issues' as ToolName,
        'test-call-id',
        manyParams,
        mockContext
      );
      
      expect(result.toolCallId).toBeDefined();
    });
  });

  describe('Special characters', () => {
    it('should handle special characters in parameters', async () => {
      const result = await executeTool(
        'github_read_file' as ToolName,
        'test-call-id',
        {
          owner: 'test-owner',
          repo: 'test-repo',
          path: 'src/file with spaces & special <chars>.ts',
        },
        mockContext
      );
      
      expect(result.toolCallId).toBeDefined();
    });

    it('should handle unicode in parameters', async () => {
      const result = await executeTool(
        'slack_send_message' as ToolName,
        'test-call-id',
        {
          channel: 'test-channel',
          text: '你好世界 🎉 مرحبا',
        },
        mockContext
      );
      
      expect(result.toolCallId).toBeDefined();
    });
  });
});

// ============================================================================
// RISK LEVEL BOUNDARY TESTS
// ============================================================================

describe('Risk Level Boundaries', () => {
  it('should have Level 1 tools (read-only, safe)', () => {
    const level1Tools = Object.entries(ToolDefinitions)
      .filter(([_, def]) => def.riskLevel === 1)
      .map(([name]) => name);
    
    expect(level1Tools.length).toBeGreaterThan(0);
    // Level 1 tools should be read-only operations
    expect(level1Tools).toContain('github_list_repos');
    expect(level1Tools).toContain('jira_list_projects');
    expect(level1Tools).toContain('slack_list_channels');
  });

  it('should have Level 2 tools (read with context)', () => {
    const level2Tools = Object.entries(ToolDefinitions)
      .filter(([_, def]) => def.riskLevel === 2)
      .map(([name]) => name);
    
    expect(level2Tools.length).toBeGreaterThan(0);
    expect(level2Tools).toContain('github_scan_secrets');
    expect(level2Tools).toContain('jira_search_issues');
  });

  it('should have Level 3 tools (create operations)', () => {
    const level3Tools = Object.entries(ToolDefinitions)
      .filter(([_, def]) => def.riskLevel === 3)
      .map(([name]) => name);
    
    expect(level3Tools.length).toBeGreaterThan(0);
    expect(level3Tools).toContain('github_create_issue');
    expect(level3Tools).toContain('jira_create_issue');
    expect(level3Tools).toContain('slack_send_message');
  });

  it('should have Level 4 tools (modify operations)', () => {
    const level4Tools = Object.entries(ToolDefinitions)
      .filter(([_, def]) => def.riskLevel === 4)
      .map(([name]) => name);
    
    expect(level4Tools.length).toBeGreaterThan(0);
    expect(level4Tools).toContain('github_create_pr');
    expect(level4Tools).toContain('jira_update_issue');
    expect(level4Tools).toContain('slack_update_message');
  });

  it('should have Level 5 tools (destructive operations)', () => {
    const level5Tools = Object.entries(ToolDefinitions)
      .filter(([_, def]) => def.riskLevel === 5)
      .map(([name]) => name);
    
    expect(level5Tools.length).toBeGreaterThan(0);
    expect(level5Tools).toContain('github_merge_pr');
    expect(level5Tools).toContain('github_delete_branch');
    expect(level5Tools).toContain('jira_delete_issue');
    expect(level5Tools).toContain('slack_invite_user');
    expect(level5Tools).toContain('slack_remove_user');
  });

  it('should only have tools with risk levels 1-5', () => {
    Object.entries(ToolDefinitions).forEach(([_name, def]) => {
      expect(def.riskLevel).toBeGreaterThanOrEqual(1);
      expect(def.riskLevel).toBeLessThanOrEqual(5);
    });
  });
});

// ============================================================================
// TOOL COVERAGE TESTS
// ============================================================================

describe('Tool Coverage', () => {
  const totalExpectedTools = 26; // 10 GitHub + 8 Jira + 8 Slack

  it('should have expected total number of tools', () => {
    const toolCount = Object.keys(ToolDefinitions).length;
    expect(toolCount).toBe(totalExpectedTools);
  });

  it('should have 10 GitHub tools', () => {
    const githubTools = Object.entries(ToolDefinitions)
      .filter(([_, def]) => def.connection === 'github');
    expect(githubTools.length).toBe(10);
  });

  it('should have 8 Jira tools', () => {
    const jiraTools = Object.entries(ToolDefinitions)
      .filter(([_, def]) => def.connection === 'jira');
    expect(jiraTools.length).toBe(8);
  });

  it('should have 8 Slack tools', () => {
    const slackTools = Object.entries(ToolDefinitions)
      .filter(([_, def]) => def.connection === 'slack');
    expect(slackTools.length).toBe(8);
  });
});

const mockContext: ToolContext = {
  userId: 'test-user',
  userAccessToken: 'mock-token',
  sessionId: 'test-session',
  fgaCheckPassed: true,
  cibaApproved: false,
};
