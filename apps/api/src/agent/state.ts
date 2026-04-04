/**
 * Agent State Types
 * 
 * Defines the state schema for the Fulcrum security agent.
 * Uses a simple interface pattern for state management.
 * 
 * The state tracks:
 * - Session/user context
 * - Conversation messages
 * - Current execution state (IDLE, PLANNING, EXECUTING, AWAITING_APPROVAL, etc.)
 * - Pending tool calls and CIBA approvals
 * - Execution history for audit trail
 */

import { BaseMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Agent execution states
 * These map directly to the state machine described in claude.md
 */
export type AgentExecutionState = 
  | 'IDLE'                    // Waiting for user input
  | 'PLANNING'                // Gemini analyzing intent
  | 'CHECKING_PERMISSIONS'    // FGA validation
  | 'EXECUTING'               // Running tool
  | 'AWAITING_APPROVAL'       // CIBA pending
  | 'APPROVED'                // CIBA approved, resuming
  | 'DENIED'                  // FGA or CIBA denied
  | 'COMPLETED'               // Task done
  | 'ERROR';                  // Something broke

/**
 * Tool call representation
 */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  riskLevel: number;
  requiresCIBA: boolean;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  executionTimeMs: number;
  tokenUsed?: boolean;
}

/**
 * CIBA approval request reference
 */
export interface PendingApproval {
  requestId: string;
  authReqId: string;
  tool: string;
  toolArgs: Record<string, unknown>;
  bindingMessage: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * FGA check result stored in state
 */
export interface FGACheckState {
  action: string;
  allowed: boolean;
  mode: 'strict' | 'permissive';
  checkedAt: Date;
  requiresCIBA: boolean;
}

/**
 * Tool execution history entry (for audit)
 */
export interface ExecutionHistoryEntry {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  fgaCheck: FGACheckState;
  cibaApproval?: {
    requestId: string;
    status: 'pending' | 'approved' | 'denied' | 'expired';
    approvedAt?: Date;
    deniedAt?: Date;
  };
  result?: ToolResult;
  startedAt: Date;
  completedAt?: Date;
}

/**
 * Error information stored in state
 */
export interface AgentError {
  code: string;
  message: string;
  tool?: string;
  recoverable: boolean;
  timestamp: Date;
}

// ============================================================================
// STATE INTERFACE
// ============================================================================

/**
 * FulcrumState - The main state object that flows through the agent
 * 
 * Each function reads/updates this state.
 */
export interface FulcrumState {
  // Session context
  sessionId: string;
  userId: string;
  threadId: string;
  userAccessToken: string;
  
  // User's connected services (github, jira, slack)
  userConnections: string[];
  
  // Conversation messages
  messages: BaseMessage[];
  
  // Current execution state
  currentState: AgentExecutionState;
  
  // Pending tool call (set by planning, cleared after execution)
  pendingTool: ToolCall | null;
  
  // Pending CIBA approval (set when Level 5 action needs approval)
  pendingApproval: PendingApproval | null;
  
  // Last FGA check result
  lastFGACheck: FGACheckState | null;
  
  // Last tool execution result
  lastToolResult: ToolResult | null;
  
  // Execution history (append-only for audit)
  executionHistory: ExecutionHistoryEntry[];
  
  // Error state
  error: AgentError | null;
  
  // Iteration count (prevent infinite loops)
  iterationCount: number;
  
  // Max iterations before forcing completion
  maxIterations: number;
  
  // Whether agent should continue or stop
  shouldContinue: boolean;
  
  // Final response to user (set by response function)
  finalResponse: string | null;
}

// ============================================================================
// STATE HELPERS
// ============================================================================

/**
 * Create initial state for a new agent session
 */
export function createInitialState(params: {
  sessionId: string;
  userId: string;
  threadId?: string;
  userAccessToken?: string;
  userConnections?: string[];
  message?: string;
}): FulcrumState {
  const messages: BaseMessage[] = [];
  
  if (params.message) {
    messages.push(new HumanMessage(params.message));
  }
  
  return {
    sessionId: params.sessionId,
    userId: params.userId,
    threadId: params.threadId || params.sessionId,
    userAccessToken: params.userAccessToken || '',
    userConnections: params.userConnections || [],
    messages,
    currentState: 'IDLE',
    pendingTool: null,
    pendingApproval: null,
    lastFGACheck: null,
    lastToolResult: null,
    executionHistory: [],
    error: null,
    iterationCount: 0,
    maxIterations: 10,
    shouldContinue: true,
    finalResponse: null,
  };
}

/**
 * Add a user message to state
 */
export function addUserMessage(state: FulcrumState, content: string): FulcrumState {
  return {
    ...state,
    messages: [...state.messages, new HumanMessage(content)],
    currentState: 'PLANNING',
    error: null,
  };
}

/**
 * Add an AI message to state
 */
export function addAIMessage(state: FulcrumState, content: string): FulcrumState {
  return {
    ...state,
    messages: [...state.messages, new AIMessage(content)],
  };
}

/**
 * Add a tool result message
 */
export function addToolMessage(state: FulcrumState, result: ToolResult): FulcrumState {
  return {
    ...state,
    messages: [...state.messages, new ToolMessage({
      content: JSON.stringify(result.result),
      tool_call_id: result.toolCallId,
    })],
    lastToolResult: result,
  };
}

/**
 * Set pending tool call
 */
export function setPendingTool(state: FulcrumState, tool: ToolCall): FulcrumState {
  return {
    ...state,
    pendingTool: tool,
    currentState: 'CHECKING_PERMISSIONS',
  };
}

/**
 * Set pending approval for Level 5 action
 */
export function setPendingApproval(state: FulcrumState, approval: PendingApproval): FulcrumState {
  return {
    ...state,
    pendingApproval: approval,
    currentState: 'AWAITING_APPROVAL',
    shouldContinue: false, // Pause execution until approval
  };
}

/**
 * Clear pending approval after resolution
 */
export function clearPendingApproval(state: FulcrumState, approved: boolean): FulcrumState {
  return {
    ...state,
    pendingApproval: null,
    currentState: approved ? 'APPROVED' : 'DENIED',
    shouldContinue: approved,
  };
}

/**
 * Set FGA check result
 */
export function setFGACheck(state: FulcrumState, check: FGACheckState): FulcrumState {
  return {
    ...state,
    lastFGACheck: check,
    currentState: check.allowed ? 
      (check.requiresCIBA ? 'AWAITING_APPROVAL' : 'EXECUTING') : 
      'DENIED',
  };
}

/**
 * Add execution history entry
 */
export function addHistoryEntry(state: FulcrumState, entry: ExecutionHistoryEntry): FulcrumState {
  return {
    ...state,
    executionHistory: [...state.executionHistory, entry],
  };
}

/**
 * Set error state
 */
export function setError(state: FulcrumState, error: AgentError): FulcrumState {
  return {
    ...state,
    error,
    currentState: 'ERROR',
    shouldContinue: error.recoverable,
  };
}

/**
 * Complete with final response
 */
export function complete(state: FulcrumState, response: string): FulcrumState {
  return {
    ...state,
    finalResponse: response,
    currentState: 'COMPLETED',
    shouldContinue: false,
  };
}

/**
 * Increment iteration counter
 */
export function incrementIteration(state: FulcrumState): FulcrumState {
  const newCount = state.iterationCount + 1;
  return {
    ...state,
    iterationCount: newCount,
    shouldContinue: newCount < state.maxIterations,
  };
}

/**
 * Check if state indicates completion
 */
export function isComplete(state: FulcrumState): boolean {
  return (
    state.currentState === 'COMPLETED' ||
    state.currentState === 'DENIED' ||
    (state.currentState === 'ERROR' && !state.error?.recoverable) ||
    !state.shouldContinue ||
    state.iterationCount >= state.maxIterations ||
    state.finalResponse !== null
  );
}

/**
 * Check if waiting for approval
 */
export function isWaitingForApproval(state: FulcrumState): boolean {
  return state.currentState === 'AWAITING_APPROVAL' && state.pendingApproval !== null;
}

// Re-export message types for convenience
export { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
export type { BaseMessage } from '@langchain/core/messages';
