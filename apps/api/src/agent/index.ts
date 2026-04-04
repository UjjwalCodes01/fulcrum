/**
 * Agent Module Index
 * 
 * Exports all agent-related functionality.
 */

// State types and helpers
export {
  type FulcrumState,
  type AgentExecutionState,
  type ToolCall,
  type ToolResult,
  type PendingApproval,
  type FGACheckState,
  type ExecutionHistoryEntry,
  type AgentError,
  createInitialState,
  addUserMessage,
  addAIMessage,
  addToolMessage,
  setPendingTool,
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
  AIMessage,
  ToolMessage,
  type BaseMessage,
} from './state.js';

// LLM client
export {
  getGeminiClient,
  isGeminiConfigured,
  getUsageStats,
  invokeLLM,
  generateTextResponse,
  getAvailableTools,
  createToolDefinitions,
  ToolSchemas,
  type LLMResult,
} from './llm.js';

// Graph
export {
  invokeAgent,
  resumeAfterApproval,
  planningStep,
  permissionCheckStep,
  approvalWaitStep,
  executionStep,
  responseStep,
} from './graph.js';

// Tools
export {
  AllTools,
  ToolDefinitions,
  executeTool,
  getToolDefinition,
  getToolsForConnection,
  toolRequiresCIBA,
  getToolRiskLevel,
  type ToolName,
  type ToolDefinition,
  type ToolContext,
} from './tools/index.js';

// Prompts
export {
  FULCRUM_SYSTEM_PROMPT,
  TOOL_SELECTION_PROMPT,
  SECURITY_SCAN_PROMPT,
  REMEDIATION_PROMPT,
  TOOL_DESCRIPTIONS,
  buildContextPrompt,
  buildToolPrompt,
  buildErrorPrompt,
  buildApprovalPrompt,
  getToolDescription,
} from './prompts.js';
