/**
 * FGA Unit Tests
 * 
 * These are UNIT TESTS that verify:
 * - Exported functions have correct signatures
 * - Tool definitions are complete and consistent
 * - Risk levels are properly defined
 * 
 * NOTE: These tests run with FGA NOT CONFIGURED (dev mode).
 * They do NOT verify actual FGA integration with Auth0.
 * 
 * For PRODUCTION validation, you need:
 * 1. Integration tests with real Auth0 FGA configured
 * 2. End-to-end tests that verify permission checks work
 * 3. Manual verification in staging environment
 * 
 * The passing tests here prove code structure is correct,
 * NOT that production authorization is working.
 */

import { describe, it, expect } from 'vitest';
import {
  checkPermission,
  grantAgentPermissions,
  grantConnectionPermissions,
  revokeConnectionPermissions,
  getFGAStatus,
  requiresApproval,
  TOOL_RISK_LEVELS,
} from '../services/fga.js';

describe('FGA Service - Unit Tests (Dev Mode)', () => {
  const testUserId = 'auth0|test-user-123';

  describe('Agent Permission Functions', () => {
    it('should define agent actions in TOOL_RISK_LEVELS', () => {
      expect(TOOL_RISK_LEVELS['agent_interact']).toBe(1);
      expect(TOOL_RISK_LEVELS['agent_approve']).toBe(2);
      expect(TOOL_RISK_LEVELS['agent_deny']).toBe(2);
    });

    it('should expose grantAgentPermissions function', () => {
      expect(typeof grantAgentPermissions).toBe('function');
    });

    it('should return success in dev mode (FGA not configured)', async () => {
      // NOTE: This only proves dev mode works, NOT production FGA
      const result = await grantAgentPermissions(testUserId);
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(true);
    });
  });

  describe('Connection Permission Functions', () => {
    it('should expose grantConnectionPermissions function', () => {
      expect(typeof grantConnectionPermissions).toBe('function');
    });

    it('should return success in dev mode (FGA not configured)', async () => {
      // NOTE: This only proves dev mode works, NOT production FGA
      const result = await grantConnectionPermissions(testUserId, 'github');
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(true);
    });

    it('should expose revokeConnectionPermissions function', () => {
      expect(typeof revokeConnectionPermissions).toBe('function');
    });

    it('should return success for revoke in dev mode', async () => {
      const result = await revokeConnectionPermissions(testUserId, 'github');
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(true);
    });
  });

  describe('Permission Check Functions', () => {
    it('should return allowed=true in dev mode (FGA not configured)', async () => {
      // NOTE: This is the dev mode fallback behavior
      // In production with FGA configured, this would actually check permissions
      const result = await checkPermission(testUserId, 'agent_interact');
      expect(result).toHaveProperty('allowed');
      expect(result.allowed).toBe(true);
      // Dev mode should indicate why it's allowing
      expect(result.reason).toContain('not configured');
    });

    it('should identify Level 5 actions that require CIBA', () => {
      const level5Tools = Object.entries(TOOL_RISK_LEVELS)
        .filter(([_action, risk]) => risk === 5)
        .map(([action]) => action);
      
      expect(level5Tools.length).toBeGreaterThan(0);
      expect(level5Tools).toContain('github_merge_pr');
      expect(level5Tools).toContain('github_delete_branch');
      expect(level5Tools).toContain('jira_delete_issue');
    });

    it('should have requiresApproval function', () => {
      expect(typeof requiresApproval).toBe('function');
      
      // Level 5 actions should require approval
      expect(requiresApproval('github_merge_pr')).toBe(true);
      expect(requiresApproval('github_delete_branch')).toBe(true);
      
      // Level 1-4 actions should not
      expect(requiresApproval('github_list_repos')).toBe(false);
      expect(requiresApproval('agent_interact')).toBe(false);
    });
  });

  describe('FGA Status', () => {
    it('should return FGA status with required fields', () => {
      const status = getFGAStatus();
      
      expect(status).toHaveProperty('configured');
      expect(status).toHaveProperty('mode');
      expect(status).toHaveProperty('strictMode');
      expect(status.mode).toMatch(/^(strict|permissive)$/);
      expect(typeof status.strictMode).toBe('boolean');
    });

    it('should report FGA as not configured in test environment', () => {
      const status = getFGAStatus();
      // Tests run without FGA credentials
      expect(status.configured).toBe(false);
    });
  });

  describe('Tool Definitions Integrity', () => {
    it('should have valid risk levels (1-5) for all tools', () => {
      Object.values(TOOL_RISK_LEVELS).forEach(riskLevel => {
        expect(riskLevel).toBeGreaterThanOrEqual(1);
        expect(riskLevel).toBeLessThanOrEqual(5);
      });
    });

    it('should have unique tool names', () => {
      const names = Object.keys(TOOL_RISK_LEVELS);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });

    it('should define all required tools (service + agent)', () => {
      const toolNames = Object.keys(TOOL_RISK_LEVELS);
      
      // Agent actions
      expect(toolNames).toContain('agent_interact');
      expect(toolNames).toContain('agent_approve');
      expect(toolNames).toContain('agent_deny');
      
      // GitHub tools
      expect(toolNames).toContain('github_list_repos');
      expect(toolNames).toContain('github_scan_secrets');
      expect(toolNames).toContain('github_merge_pr');
      
      // Slack tools
      expect(toolNames).toContain('slack_list_channels');
      expect(toolNames).toContain('slack_send_message');
      
      // Jira tools
      expect(toolNames).toContain('jira_list_projects');
      expect(toolNames).toContain('jira_create_issue');
      expect(toolNames).toContain('jira_delete_issue');
    });

    it('should correctly map connection to tool prefixes', () => {
      const githubTools = Object.keys(TOOL_RISK_LEVELS).filter(t => t.startsWith('github_'));
      const slackTools = Object.keys(TOOL_RISK_LEVELS).filter(t => t.startsWith('slack_'));
      const jiraTools = Object.keys(TOOL_RISK_LEVELS).filter(t => t.startsWith('jira_'));
      const agentTools = Object.keys(TOOL_RISK_LEVELS).filter(t => t.startsWith('agent_'));
      
      expect(githubTools.length).toBeGreaterThan(0);
      expect(slackTools.length).toBeGreaterThan(0);
      expect(jiraTools.length).toBeGreaterThan(0);
      expect(agentTools.length).toBe(3);
    });
  });
});
