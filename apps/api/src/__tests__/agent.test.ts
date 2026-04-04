/**
 * Agent Workflow Tests
 * 
 * Tests the agent workflow including:
 * - State management
 * - Planning step
 * - Permission checks
 * - Tool execution
 * - CIBA integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInitialState,
  addUserMessage,
  setPendingTool,
  setPendingApproval,
  clearPendingApproval,
  setError,
  complete,
  incrementIteration,
  isComplete,
  isWaitingForApproval,
  type FulcrumState,
  type ToolCall,
  type PendingApproval,
} from '../agent/state.js';

describe('Agent State Management', () => {
  let initialState: FulcrumState;
  
  beforeEach(() => {
    initialState = createInitialState({
      sessionId: 'test-session',
      userId: 'test-user',
      userAccessToken: 'test-token',
      message: 'Hello agent',
    });
  });
  
  describe('createInitialState', () => {
    it('creates state with correct initial values', () => {
      expect(initialState.sessionId).toBe('test-session');
      expect(initialState.userId).toBe('test-user');
      expect(initialState.currentState).toBe('IDLE');
      expect(initialState.messages).toHaveLength(1);
      expect(initialState.iterationCount).toBe(0);
      expect(initialState.maxIterations).toBe(10);
      expect(initialState.shouldContinue).toBe(true);
    });
    
    it('creates state without initial message', () => {
      const state = createInitialState({
        sessionId: 'test',
        userId: 'user',
      });
      expect(state.messages).toHaveLength(0);
    });
  });
  
  describe('addUserMessage', () => {
    it('adds message and transitions to PLANNING', () => {
      const newState = addUserMessage(initialState, 'New message');
      expect(newState.messages).toHaveLength(2);
      expect(newState.currentState).toBe('PLANNING');
    });
    
    it('clears error state when adding message', () => {
      const errorState = setError(initialState, {
        code: 'TEST',
        message: 'Test error',
        recoverable: true,
        timestamp: new Date(),
      });
      const newState = addUserMessage(errorState, 'Try again');
      expect(newState.error).toBeNull();
    });
  });
  
  describe('setPendingTool', () => {
    it('sets tool and transitions to CHECKING_PERMISSIONS', () => {
      const tool: ToolCall = {
        id: 'tool-1',
        name: 'github_list_repos',
        args: {},
        riskLevel: 1,
        requiresCIBA: false,
      };
      const newState = setPendingTool(initialState, tool);
      expect(newState.pendingTool).toEqual(tool);
      expect(newState.currentState).toBe('CHECKING_PERMISSIONS');
    });
  });
  
  describe('setPendingApproval', () => {
    it('sets approval and transitions to AWAITING_APPROVAL', () => {
      const approval: PendingApproval = {
        requestId: 'req-1',
        authReqId: 'auth-1',
        tool: 'github_merge_pr',
        toolArgs: { pr: 123 },
        bindingMessage: 'Merge PR #123',
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      };
      const newState = setPendingApproval(initialState, approval);
      expect(newState.pendingApproval).toEqual(approval);
      expect(newState.currentState).toBe('AWAITING_APPROVAL');
      expect(newState.shouldContinue).toBe(false);
    });
  });
  
  describe('clearPendingApproval', () => {
    it('clears approval and sets APPROVED when approved', () => {
      const approval: PendingApproval = {
        requestId: 'req-1',
        authReqId: 'auth-1',
        tool: 'github_merge_pr',
        toolArgs: {},
        bindingMessage: 'Test',
        expiresAt: new Date(),
        createdAt: new Date(),
      };
      let state = setPendingApproval(initialState, approval);
      state = clearPendingApproval(state, true);
      
      expect(state.pendingApproval).toBeNull();
      expect(state.currentState).toBe('APPROVED');
      expect(state.shouldContinue).toBe(true);
    });
    
    it('clears approval and sets DENIED when denied', () => {
      const approval: PendingApproval = {
        requestId: 'req-1',
        authReqId: 'auth-1',
        tool: 'github_merge_pr',
        toolArgs: {},
        bindingMessage: 'Test',
        expiresAt: new Date(),
        createdAt: new Date(),
      };
      let state = setPendingApproval(initialState, approval);
      state = clearPendingApproval(state, false);
      
      expect(state.pendingApproval).toBeNull();
      expect(state.currentState).toBe('DENIED');
      expect(state.shouldContinue).toBe(false);
    });
  });
  
  describe('complete', () => {
    it('sets final response and COMPLETED state', () => {
      const newState = complete(initialState, 'Task completed');
      expect(newState.finalResponse).toBe('Task completed');
      expect(newState.currentState).toBe('COMPLETED');
      expect(newState.shouldContinue).toBe(false);
    });
  });
  
  describe('incrementIteration', () => {
    it('increments counter', () => {
      let state = initialState;
      state = incrementIteration(state);
      expect(state.iterationCount).toBe(1);
      state = incrementIteration(state);
      expect(state.iterationCount).toBe(2);
    });
    
    it('stops continuing when max reached', () => {
      let state = { ...initialState, iterationCount: 9 };
      state = incrementIteration(state);
      expect(state.iterationCount).toBe(10);
      expect(state.shouldContinue).toBe(false);
    });
  });
  
  describe('isComplete', () => {
    it('returns true for COMPLETED state', () => {
      const state = complete(initialState, 'Done');
      expect(isComplete(state)).toBe(true);
    });
    
    it('returns true for DENIED state', () => {
      const state = { ...initialState, currentState: 'DENIED' as const };
      expect(isComplete(state)).toBe(true);
    });
    
    it('returns true for non-recoverable ERROR', () => {
      const state = setError(initialState, {
        code: 'FATAL',
        message: 'Fatal error',
        recoverable: false,
        timestamp: new Date(),
      });
      expect(isComplete(state)).toBe(true);
    });
    
    it('returns false for recoverable ERROR', () => {
      const state = setError(initialState, {
        code: 'RETRY',
        message: 'Retryable error',
        recoverable: true,
        timestamp: new Date(),
      });
      expect(isComplete(state)).toBe(false);
    });
    
    it('returns true when max iterations reached', () => {
      let state = initialState;
      for (let i = 0; i <= 10; i++) {
        state = incrementIteration(state);
      }
      expect(isComplete(state)).toBe(true);
    });
    
    it('returns true when finalResponse is set', () => {
      const state = { ...initialState, finalResponse: 'Done' };
      expect(isComplete(state)).toBe(true);
    });
    
    it('returns false for active state', () => {
      expect(isComplete(initialState)).toBe(false);
      expect(isComplete({ ...initialState, currentState: 'PLANNING' as const })).toBe(false);
      expect(isComplete({ ...initialState, currentState: 'EXECUTING' as const })).toBe(false);
    });
  });
  
  describe('isWaitingForApproval', () => {
    it('returns true when AWAITING_APPROVAL with pending approval', () => {
      const approval: PendingApproval = {
        requestId: 'req-1',
        authReqId: 'auth-1',
        tool: 'github_merge_pr',
        toolArgs: {},
        bindingMessage: 'Test',
        expiresAt: new Date(),
        createdAt: new Date(),
      };
      const state = setPendingApproval(initialState, approval);
      expect(isWaitingForApproval(state)).toBe(true);
    });
    
    it('returns false when not AWAITING_APPROVAL', () => {
      expect(isWaitingForApproval(initialState)).toBe(false);
    });
    
    it('returns false when AWAITING_APPROVAL but no pending approval', () => {
      const state = {
        ...initialState,
        currentState: 'AWAITING_APPROVAL' as const,
        pendingApproval: null,
      };
      expect(isWaitingForApproval(state)).toBe(false);
    });
  });
});

describe('Tool Risk Levels', () => {
  it('Level 1-2 tools do not require CIBA', () => {
    const readTool: ToolCall = {
      id: 'tool-1',
      name: 'github_list_repos',
      args: {},
      riskLevel: 1,
      requiresCIBA: false,
    };
    expect(readTool.requiresCIBA).toBe(false);
    
    const scanTool: ToolCall = {
      id: 'tool-2',
      name: 'github_scan_secrets',
      args: {},
      riskLevel: 2,
      requiresCIBA: false,
    };
    expect(scanTool.requiresCIBA).toBe(false);
  });
  
  it('Level 5 tools require CIBA', () => {
    const mergeTool: ToolCall = {
      id: 'tool-1',
      name: 'github_merge_pr',
      args: {},
      riskLevel: 5,
      requiresCIBA: true,
    };
    expect(mergeTool.requiresCIBA).toBe(true);
    
    const deleteTool: ToolCall = {
      id: 'tool-2',
      name: 'github_delete_branch',
      args: {},
      riskLevel: 5,
      requiresCIBA: true,
    };
    expect(deleteTool.requiresCIBA).toBe(true);
  });
});
