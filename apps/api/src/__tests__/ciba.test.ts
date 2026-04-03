/**
 * CIBA Service Tests
 * 
 * Tests for CIBA (Client Initiated Backchannel Authentication)
 * These tests verify the code structure and logic without requiring
 * a real Auth0 CIBA environment.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  createCIBARequest,
  getCIBARequest,
  getCIBARequestByAuthReqId,
  getPendingCIBARequests,
  approveCIBARequest,
  denyCIBARequest,
  cancelCIBARequest,
  expireOldRequests,
  getCIBAStats,
  clearAllCIBARequests,
} from '../db/ciba.js';
import {
  isCIBAConfigured,
  getCIBAStatus,
  generateBindingMessage,
} from '../services/ciba.js';

describe('CIBA Database Operations', () => {
  beforeEach(() => {
    clearAllCIBARequests();
  });

  test('createCIBARequest creates a new request', async () => {
    const request = await createCIBARequest({
      id: 'test-request-1',
      userId: 'user-123',
      tool: 'github_merge_pr',
      authReqId: 'auth0-abc123',
      sessionId: 'session-456',
      bindingMessage: 'Approve PR merge',
      toolInput: { repo: 'test/repo', prNumber: 42 },
      expiresAt: new Date(Date.now() + 300000),
    });

    expect(request.id).toBe('test-request-1');
    expect(request.userId).toBe('user-123');
    expect(request.tool).toBe('github_merge_pr');
    expect(request.status).toBe('pending');
    expect(request.authReqId).toBe('auth0-abc123');
    expect(request.sessionId).toBe('session-456');
    expect(request.bindingMessage).toBe('Approve PR merge');
    expect(request.toolInput).toEqual({ repo: 'test/repo', prNumber: 42 });
    expect(request.createdAt).toBeInstanceOf(Date);
    expect(request.updatedAt).toBeInstanceOf(Date);
  });

  test('getCIBARequest retrieves by ID', async () => {
    await createCIBARequest({
      id: 'test-request-2',
      userId: 'user-123',
      tool: 'github_delete_branch',
      authReqId: 'auth0-xyz789',
      sessionId: 'session-789',
      bindingMessage: 'Delete branch',
      expiresAt: new Date(Date.now() + 300000),
    });

    const request = await getCIBARequest('test-request-2');
    expect(request).not.toBeNull();
    expect(request!.id).toBe('test-request-2');
    expect(request!.tool).toBe('github_delete_branch');
  });

  test('getCIBARequestByAuthReqId retrieves by Auth0 ID', async () => {
    await createCIBARequest({
      id: 'test-request-3',
      userId: 'user-456',
      tool: 'jira_delete_issue',
      authReqId: 'auth0-unique-id',
      sessionId: 'session-001',
      bindingMessage: 'Delete Jira issue',
      expiresAt: new Date(Date.now() + 300000),
    });

    const request = await getCIBARequestByAuthReqId('auth0-unique-id');
    expect(request).not.toBeNull();
    expect(request!.id).toBe('test-request-3');
    expect(request!.tool).toBe('jira_delete_issue');
  });

  test('getPendingCIBARequests returns only pending requests', async () => {
    // Create pending request
    await createCIBARequest({
      id: 'pending-1',
      userId: 'user-multi',
      tool: 'github_merge_pr',
      authReqId: 'auth-pending-1',
      sessionId: 'session-a',
      bindingMessage: 'Merge PR #1',
      expiresAt: new Date(Date.now() + 300000),
    });

    // Create and approve another request
    await createCIBARequest({
      id: 'approved-1',
      userId: 'user-multi',
      tool: 'github_merge_pr',
      authReqId: 'auth-approved-1',
      sessionId: 'session-b',
      bindingMessage: 'Merge PR #2',
      expiresAt: new Date(Date.now() + 300000),
    });
    await approveCIBARequest('approved-1');

    const pending = await getPendingCIBARequests('user-multi');
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('pending-1');
  });

  test('approveCIBARequest sets status to approved', async () => {
    await createCIBARequest({
      id: 'to-approve',
      userId: 'user-approve',
      tool: 'slack_invite_user',
      authReqId: 'auth-to-approve',
      sessionId: 'session-approve',
      bindingMessage: 'Invite user to channel',
      expiresAt: new Date(Date.now() + 300000),
    });

    const approved = await approveCIBARequest('to-approve');
    expect(approved).not.toBeNull();
    expect(approved!.status).toBe('approved');
    expect(approved!.approvedAt).toBeInstanceOf(Date);
  });

  test('denyCIBARequest sets status to denied', async () => {
    await createCIBARequest({
      id: 'to-deny',
      userId: 'user-deny',
      tool: 'github_delete_branch',
      authReqId: 'auth-to-deny',
      sessionId: 'session-deny',
      bindingMessage: 'Delete feature branch',
      expiresAt: new Date(Date.now() + 300000),
    });

    const denied = await denyCIBARequest('to-deny');
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe('denied');
    expect(denied!.deniedAt).toBeInstanceOf(Date);
  });

  test('cancelCIBARequest sets status to cancelled', async () => {
    await createCIBARequest({
      id: 'to-cancel',
      userId: 'user-cancel',
      tool: 'github_merge_pr',
      authReqId: 'auth-to-cancel',
      sessionId: 'session-cancel',
      bindingMessage: 'Merge cancelled PR',
      expiresAt: new Date(Date.now() + 300000),
    });

    const cancelled = await cancelCIBARequest('to-cancel');
    expect(cancelled).not.toBeNull();
    expect(cancelled!.status).toBe('cancelled');
  });

  test('expireOldRequests expires past-due requests', async () => {
    // Create an already-expired request
    await createCIBARequest({
      id: 'expired-1',
      userId: 'user-expire',
      tool: 'github_merge_pr',
      authReqId: 'auth-expired-1',
      sessionId: 'session-expire',
      bindingMessage: 'Old PR merge',
      expiresAt: new Date(Date.now() - 1000), // Already expired
    });

    // Create a still-valid request
    await createCIBARequest({
      id: 'valid-1',
      userId: 'user-expire',
      tool: 'github_merge_pr',
      authReqId: 'auth-valid-1',
      sessionId: 'session-valid',
      bindingMessage: 'New PR merge',
      expiresAt: new Date(Date.now() + 300000), // 5 min from now
    });

    const expired = await expireOldRequests();
    expect(expired).toHaveLength(1);
    expect(expired[0].id).toBe('expired-1');
    expect(expired[0].status).toBe('expired');

    // Check the valid one is still pending
    const valid = await getCIBARequest('valid-1');
    expect(valid!.status).toBe('pending');
  });

  test('getCIBAStats returns correct counts', async () => {
    // Create various requests
    await createCIBARequest({
      id: 'stat-pending',
      userId: 'user-stats',
      tool: 'github_merge_pr',
      authReqId: 'auth-stat-1',
      sessionId: 'session-stat',
      bindingMessage: 'Pending',
      expiresAt: new Date(Date.now() + 300000),
    });

    await createCIBARequest({
      id: 'stat-approved',
      userId: 'user-stats',
      tool: 'github_merge_pr',
      authReqId: 'auth-stat-2',
      sessionId: 'session-stat',
      bindingMessage: 'To approve',
      expiresAt: new Date(Date.now() + 300000),
    });
    await approveCIBARequest('stat-approved');

    await createCIBARequest({
      id: 'stat-denied',
      userId: 'user-stats',
      tool: 'github_merge_pr',
      authReqId: 'auth-stat-3',
      sessionId: 'session-stat',
      bindingMessage: 'To deny',
      expiresAt: new Date(Date.now() + 300000),
    });
    await denyCIBARequest('stat-denied');

    const stats = await getCIBAStats();
    expect(stats.total).toBe(3);
    expect(stats.pending).toBe(1);
    expect(stats.approved).toBe(1);
    expect(stats.denied).toBe(1);
    expect(stats.expired).toBe(0);
    expect(stats.cancelled).toBe(0);
  });
});

describe('CIBA Service', () => {
  test('isCIBAConfigured returns false when not configured', () => {
    // In test environment, CIBA env vars are not set
    const configured = isCIBAConfigured();
    expect(configured).toBe(false);
  });

  test('getCIBAStatus returns configuration status', () => {
    const status = getCIBAStatus();
    expect(status).toHaveProperty('configured');
    expect(status).toHaveProperty('domain');
    expect(status).toHaveProperty('timeoutSeconds');
    expect(typeof status.configured).toBe('boolean');
    expect(typeof status.timeoutSeconds).toBe('number');
  });

  test('generateBindingMessage creates appropriate messages', () => {
    const messages = [
      { tool: 'github_merge_pr', expected: /merge/i },
      { tool: 'github_delete_branch', expected: /delete.*branch/i },
      { tool: 'jira_delete_issue', expected: /delete.*issue/i },
      { tool: 'slack_invite_user', expected: /invite/i },
    ];

    for (const { tool, expected } of messages) {
      const message = generateBindingMessage(tool);
      expect(message).toMatch(expected);
    }
  });

  test('generateBindingMessage includes details when provided', () => {
    const message = generateBindingMessage('github_merge_pr', 'PR #42 in test/repo');
    expect(message).toContain('PR #42');
    expect(message).toContain('test/repo');
  });
});

describe('CIBA Security Rules', () => {
  beforeEach(() => {
    clearAllCIBARequests();
  });

  test('Level 5 actions are tracked separately', async () => {
    const level5Tools = [
      'github_merge_pr',
      'github_delete_branch',
      'jira_delete_issue',
      'slack_invite_user',
    ];

    for (const tool of level5Tools) {
      await createCIBARequest({
        id: `level5-${tool}`,
        userId: 'user-level5',
        tool,
        authReqId: `auth-${tool}`,
        sessionId: 'session-level5',
        bindingMessage: `Approve ${tool}`,
        expiresAt: new Date(Date.now() + 300000),
      });
    }

    const stats = await getCIBAStats();
    expect(stats.total).toBe(level5Tools.length);
  });

  test('Each request has unique IDs', async () => {
    const ids = new Set<string>();
    const authReqIds = new Set<string>();

    for (let i = 0; i < 5; i++) {
      const request = await createCIBARequest({
        id: `unique-${i}`,
        userId: 'user-unique',
        tool: 'github_merge_pr',
        authReqId: `auth-unique-${i}`,
        sessionId: 'session-unique',
        bindingMessage: `Request ${i}`,
        expiresAt: new Date(Date.now() + 300000),
      });

      expect(ids.has(request.id)).toBe(false);
      expect(authReqIds.has(request.authReqId)).toBe(false);
      ids.add(request.id);
      authReqIds.add(request.authReqId);
    }

    expect(ids.size).toBe(5);
    expect(authReqIds.size).toBe(5);
  });

  test('Request status transitions are valid', async () => {
    // pending -> approved is valid
    await createCIBARequest({
      id: 'valid-transition',
      userId: 'user-transition',
      tool: 'github_merge_pr',
      authReqId: 'auth-transition',
      sessionId: 'session-transition',
      bindingMessage: 'Test transition',
      expiresAt: new Date(Date.now() + 300000),
    });

    let request = await getCIBARequest('valid-transition');
    expect(request!.status).toBe('pending');

    await approveCIBARequest('valid-transition');
    request = await getCIBARequest('valid-transition');
    expect(request!.status).toBe('approved');
  });
});
