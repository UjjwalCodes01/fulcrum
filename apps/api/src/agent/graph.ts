/**
 * Agent Workflow
 * 
 * The core workflow for the Fulcrum security agent.
 * Implements a simple step-by-step workflow:
 * 1. Planning - Gemini analyzes user intent and selects tools
 * 2. Permission Check - FGA validates access before execution
 * 3. Approval Wait - CIBA for Level 5 actions
 * 4. Execution - Tool runs with Token Vault token
 * 5. Response - Generate final response
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

import {
  type FulcrumState,
  type ExecutionHistoryEntry,
  createInitialState,
  setPendingApproval,
  clearPendingApproval,
  setFGACheck,
  addHistoryEntry,
  setError,
  complete,
  incrementIteration,
  isComplete,
  isWaitingForApproval,
  HumanMessage,
  ToolMessage,
} from './state.js';

import {
  invokeLLM,
  isGeminiConfigured,
  getAvailableTools,
} from './llm.js';

import {
  executeTool,
  type ToolName,
} from './tools/index.js';

import {
  checkPermission,
} from '../services/fga.js';

import {
  initiateCIBA,
  getCIBARequestById,
} from '../services/ciba.js';

// ============================================================================
// WORKFLOW STEPS
// ============================================================================

/**
 * Planning Step
 * 
 * Uses Gemini to understand user intent and select tools
 */
async function planningStep(state: FulcrumState): Promise<FulcrumState> {
  logger.info('Planning step', { 
    sessionId: state.sessionId,
    messageCount: state.messages.length,
    iteration: state.iterationCount,
  });
  
  // Check iteration limit
  if (state.iterationCount >= state.maxIterations) {
    logger.warn('Max iterations reached', { 
      sessionId: state.sessionId,
      iterations: state.iterationCount,
    });
    return complete(state, 'I reached my thinking limit for this request. Please try a simpler question or break your request into smaller steps.');
  }
  
  // Check Gemini configuration
  if (!isGeminiConfigured()) {
    logger.warn('Gemini not configured');
    return complete(state, 'The AI model is not configured. Please check GCP_PROJECT_ID and Vertex AI settings.');
  }
  
  // Get available tools based on user's actual connections
  const userConnections = state.userConnections.length > 0 ? state.userConnections : [];
  const availableTools = getAvailableTools(userConnections);
  
  // If no connections, warn but allow direct responses
  if (userConnections.length === 0) {
    logger.warn('No user connections available', { userId: state.userId });
  }
  
  // Invoke the LLM with correct argument order: (messages, availableTools, userConnections)
  const result = await invokeLLM(
    state.messages,
    availableTools,
    userConnections
  );
  
  if (!result.success) {
    return setError(state, {
      code: 'LLM_ERROR',
      message: result.error || 'Failed to invoke AI model',
      recoverable: true,
      timestamp: new Date(),
    });
  }
  
  // Check if LLM wants to call a tool
  if (result.toolCalls && result.toolCalls.length > 0) {
    const toolCall = result.toolCalls[0]; // Handle one tool at a time
    logger.info('LLM selected tool', { 
      tool: toolCall.name,
      riskLevel: toolCall.riskLevel,
      requiresCIBA: toolCall.requiresCIBA,
    });
    
    return {
      ...state,
      pendingTool: toolCall,
      currentState: 'CHECKING_PERMISSIONS',
      iterationCount: state.iterationCount + 1,
    };
  }
  
  // No tool call - direct response
  if (result.text) {
    return complete(state, result.text);
  }
  
  // Empty response
  return complete(state, 'I understood your request but have nothing specific to say.');
}

/**
 * Permission Check Step
 * 
 * Validates with FGA before execution
 */
async function permissionCheckStep(state: FulcrumState): Promise<FulcrumState> {
  if (!state.pendingTool) {
    return setError(state, {
      code: 'NO_PENDING_TOOL',
      message: 'No tool to check permissions for',
      recoverable: false,
      timestamp: new Date(),
    });
  }
  
  const { pendingTool } = state;
  
  logger.info('Permission check', { 
    tool: pendingTool.name,
    userId: state.userId,
  });
  
  // Pass just the tool name - checkPermission already formats as action:${action}
  const fgaResult = await checkPermission(
    state.userId,
    pendingTool.name
  );
  
  const fgaState = {
    action: pendingTool.name,
    allowed: fgaResult.allowed,
    mode: (fgaResult.mode || 'permissive') as 'strict' | 'permissive',
    checkedAt: new Date(),
    requiresCIBA: pendingTool.requiresCIBA,
  };
  
  if (!fgaResult.allowed) {
    logger.warn('FGA denied tool execution', {
      tool: pendingTool.name,
      userId: state.userId,
      mode: fgaResult.mode,
    });
    
    const updatedState = setFGACheck(state, fgaState);
    return complete(updatedState, `I don't have permission to use ${pendingTool.name}. Please check your access rights.`);
  }
  
  // FGA allowed - check if CIBA is required
  if (pendingTool.requiresCIBA) {
    logger.info('CIBA required for tool', { tool: pendingTool.name });
    return {
      ...setFGACheck(state, fgaState),
      currentState: 'AWAITING_APPROVAL',
    };
  }
  
  // Ready to execute
  return {
    ...setFGACheck(state, fgaState),
    currentState: 'EXECUTING',
  };
}

/**
 * Approval Wait Step
 * 
 * Initiates CIBA for Level 5 actions
 */
async function approvalWaitStep(state: FulcrumState): Promise<FulcrumState> {
  if (!state.pendingTool) {
    return setError(state, {
      code: 'NO_PENDING_TOOL',
      message: 'No tool awaiting approval',
      recoverable: false,
      timestamp: new Date(),
    });
  }
  
  // Check if already have pending approval
  if (state.pendingApproval) {
    // Check CIBA status
    const cibaRequest = await getCIBARequestById(state.pendingApproval.requestId);
    
    if (!cibaRequest) {
      return setError(state, {
        code: 'CIBA_NOT_FOUND',
        message: 'CIBA request not found',
        recoverable: false,
        timestamp: new Date(),
      });
    }
    
    switch (cibaRequest.status) {
      case 'approved':
        return {
          ...clearPendingApproval(state, true),
          currentState: 'EXECUTING',
        };
      case 'denied':
        return {
          ...clearPendingApproval(state, false),
          finalResponse: `Action "${state.pendingTool.name}" was denied.`,
        };
      case 'expired':
        return {
          ...clearPendingApproval(state, false),
          finalResponse: `Approval for "${state.pendingTool.name}" timed out. Please try again.`,
        };
      case 'pending':
      default:
        // Still waiting
        return {
          ...state,
          shouldContinue: false, // Pause execution
        };
    }
  }
  
  // Initiate CIBA request
  logger.info('Initiating CIBA request', {
    tool: state.pendingTool.name,
    userId: state.userId,
  });
  
  const bindingMessage = `Fulcrum wants to execute: ${state.pendingTool.name}`;
  
  try {
    const cibaResult = await initiateCIBA({
      userId: state.userId,
      tool: state.pendingTool.name,
      sessionId: state.sessionId,
      bindingMessage,
      toolInput: state.pendingTool.args,
    });
    
    if (!cibaResult.success || !cibaResult.requestId) {
      return setError(state, {
        code: 'CIBA_INIT_FAILED',
        message: cibaResult.error || 'Failed to initiate approval',
        tool: state.pendingTool.name,
        recoverable: true,
        timestamp: new Date(),
      });
    }
    
    const expiresIn = cibaResult.expiresIn || 300; // Default 5 minutes
    const pendingApproval = {
      requestId: cibaResult.requestId,
      authReqId: cibaResult.authReqId || '',
      tool: state.pendingTool.name,
      toolArgs: state.pendingTool.args,
      bindingMessage,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      createdAt: new Date(),
    };
    
    return setPendingApproval(state, pendingApproval);
  } catch (error) {
    logger.error('Failed to initiate CIBA', { error });
    return setError(state, {
      code: 'CIBA_INIT_FAILED',
      message: 'Failed to request approval',
      tool: state.pendingTool.name,
      recoverable: true,
      timestamp: new Date(),
    });
  }
}

/**
 * Execution Step
 * 
 * Runs the tool with Token Vault token
 */
async function executionStep(state: FulcrumState): Promise<FulcrumState> {
  if (!state.pendingTool) {
    return setError(state, {
      code: 'NO_PENDING_TOOL',
      message: 'No tool to execute',
      recoverable: false,
      timestamp: new Date(),
    });
  }
  
  const { pendingTool } = state;
  const startTime = Date.now();
  
  logger.info('Executing tool', { 
    tool: pendingTool.name,
    userId: state.userId,
    sessionId: state.sessionId,
  });
  
  const result = await executeTool(
    pendingTool.name as ToolName,
    pendingTool.id,
    pendingTool.args,
    {
      userId: state.userId,
      userAccessToken: state.userAccessToken,
      sessionId: state.sessionId,
      fgaCheckPassed: state.lastFGACheck?.allowed ?? true,
      cibaApproved: state.currentState === 'APPROVED',
    }
  );
  
  const historyEntry: ExecutionHistoryEntry = {
    id: uuidv4(),
    tool: pendingTool.name,
    args: pendingTool.args,
    fgaCheck: state.lastFGACheck!,
    result: {
      toolCallId: pendingTool.id,
      toolName: pendingTool.name,
      success: result.success,
      result: result.result,
      error: result.error,
      executionTimeMs: result.executionTimeMs,
    },
    startedAt: new Date(startTime),
    completedAt: new Date(),
  };
  
  const newState = addHistoryEntry({
    ...state,
    pendingTool: null,
    lastToolResult: historyEntry.result || null,
    messages: [
      ...state.messages,
      new ToolMessage({
        content: JSON.stringify(result.success ? result.result : { error: result.error }),
        tool_call_id: pendingTool.id,
      }),
    ],
  }, historyEntry);
  
  if (!result.success) {
    logger.error('Tool execution failed', {
      tool: pendingTool.name,
      error: result.error,
    });
    return complete(newState, `Failed to execute ${pendingTool.name}: ${result.error}`);
  }
  
  // Return to planning to check if more work is needed
  return {
    ...newState,
    currentState: 'PLANNING',
  };
}

/**
 * Response Step
 * 
 * Generate final response based on tool results
 */
async function responseStep(state: FulcrumState): Promise<FulcrumState> {
  // If we already have a final response, we're done
  if (state.finalResponse) {
    return state;
  }
  
  // Generate response based on execution history
  if (state.executionHistory.length > 0) {
    const lastExecution = state.executionHistory[state.executionHistory.length - 1];
    if (lastExecution.result?.success) {
      const resultSummary = JSON.stringify(lastExecution.result.result, null, 2);
      return complete(state, `Here's what I found:\n\n${resultSummary}`);
    }
  }
  
  // Use LLM to generate response
  const result = await invokeLLM(state.messages, [], []);
  
  if (result.success && result.text) {
    return complete(state, result.text);
  }
  
  return complete(state, 'Request completed.');
}

// ============================================================================
// MAIN WORKFLOW
// ============================================================================

/**
 * Run the agent workflow
 */
export async function invokeAgent(params: {
  sessionId: string;
  userId: string;
  message: string;
  userAccessToken?: string;
  userConnections?: string[];
  existingState?: FulcrumState;
}): Promise<FulcrumState> {
  let state = params.existingState || createInitialState({
    sessionId: params.sessionId,
    userId: params.userId,
    userAccessToken: params.userAccessToken,
    userConnections: params.userConnections,
    message: params.message,
  });
  
  // If resuming with existing state, add the new message and update connections
  if (params.existingState) {
    state = {
      ...state,
      messages: [...state.messages, new HumanMessage(params.message)],
      currentState: 'PLANNING',
      // Update connections if provided (they may have changed)
      userConnections: params.userConnections || state.userConnections,
    };
  } else {
    state = {
      ...state,
      currentState: 'PLANNING',
    };
  }
  
  logger.info('Starting agent workflow', {
    sessionId: state.sessionId,
    userId: state.userId,
    messageCount: state.messages.length,
    connections: state.userConnections,
  });
  
  // Run workflow until complete or paused
  while (!isComplete(state) && !isWaitingForApproval(state)) {
    switch (state.currentState) {
      case 'PLANNING':
        state = await planningStep(state);
        break;
      case 'CHECKING_PERMISSIONS':
        state = await permissionCheckStep(state);
        break;
      case 'AWAITING_APPROVAL':
        state = await approvalWaitStep(state);
        break;
      case 'EXECUTING':
        state = await executionStep(state);
        break;
      case 'APPROVED':
        // After approval, move to execution
        state = { ...state, currentState: 'EXECUTING' };
        break;
      case 'DENIED':
      case 'COMPLETED':
      case 'ERROR':
        // End states
        break;
      default:
        state = await responseStep(state);
    }
    
    // Safety check
    state = incrementIteration(state);
    if (state.iterationCount > state.maxIterations * 2) {
      logger.error('Agent workflow stuck', { state });
      break;
    }
  }
  
  logger.info('Agent workflow complete', {
    sessionId: state.sessionId,
    finalState: state.currentState,
    iterations: state.iterationCount,
    historyCount: state.executionHistory.length,
  });
  
  return state;
}

/**
 * Resume after CIBA approval
 */
export async function resumeAfterApproval(params: {
  requestId: string;
  approved: boolean;
  state: FulcrumState;
}): Promise<FulcrumState> {
  const { requestId, approved, state } = params;
  
  logger.info('Resuming after approval', {
    requestId,
    approved,
    sessionId: state.sessionId,
  });
  
  // Clear the pending approval
  let newState = clearPendingApproval(state, approved);
  
  if (!approved) {
    return complete(newState, 'The action was denied.');
  }
  
  // Move to execution
  newState = { ...newState, currentState: 'EXECUTING' };
  
  // Continue the workflow
  while (!isComplete(newState)) {
    switch (newState.currentState) {
      case 'EXECUTING':
        newState = await executionStep(newState);
        break;
      case 'PLANNING':
        newState = await planningStep(newState);
        break;
      case 'CHECKING_PERMISSIONS':
        newState = await permissionCheckStep(newState);
        break;
      case 'AWAITING_APPROVAL':
        // Another approval needed - return and wait
        newState = await approvalWaitStep(newState);
        if (isWaitingForApproval(newState)) {
          return newState;
        }
        break;
      default:
        newState = await responseStep(newState);
    }
    
    newState = incrementIteration(newState);
    if (newState.iterationCount > newState.maxIterations * 2) {
      break;
    }
  }
  
  return newState;
}

// Export step functions for testing
export {
  planningStep,
  permissionCheckStep,
  approvalWaitStep,
  executionStep,
  responseStep,
};
