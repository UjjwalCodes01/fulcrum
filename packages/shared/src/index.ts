import { z } from 'zod';

// ==========================================
// Agent State Types
// ==========================================

export const AgentStateEnum = z.enum([
  'IDLE',
  'PLANNING',
  'CHECKING_PERMISSIONS',
  'EXECUTING',
  'AWAITING_APPROVAL',
  'APPROVED',
  'DENIED',
  'COMPLETED',
  'ERROR',
]);

export type AgentState = z.infer<typeof AgentStateEnum>;

// ==========================================
// Tool Types
// ==========================================

export const ToolRiskLevel = z.number().min(1).max(5);

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  riskLevel: ToolRiskLevel,
  requiresCIBA: z.boolean(),
  requiredScopes: z.array(z.string()),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

// ==========================================
// Connection Types
// ==========================================

export const ConnectionTypeEnum = z.enum(['github', 'jira', 'slack']);
export type ConnectionType = z.infer<typeof ConnectionTypeEnum>;

export const ConnectionSchema = z.object({
  id: z.string(),
  type: ConnectionTypeEnum,
  userId: z.string(),
  connected: z.boolean(),
  scopes: z.array(z.string()),
  connectedAt: z.string().datetime().optional(),
});

export type Connection = z.infer<typeof ConnectionSchema>;

// ==========================================
// Audit Log Types
// ==========================================

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  auth0TraceId: z.string().optional(),
  sessionId: z.string().uuid(),
  userId: z.string(),
  agentId: z.string().default('fulcrum:security-auditor'),
  action: z.string(),
  resource: z.string().optional(),
  fgaResult: z.enum(['PASSED', 'DENIED', 'SKIPPED']).optional(),
  cibaStatus: z.enum(['PENDING', 'APPROVED', 'DENIED', 'TIMEOUT']).optional(),
  result: z.enum(['EXECUTED', 'BLOCKED', 'ERROR']),
  details: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
});

export type AuditLog = z.infer<typeof AuditLogSchema>;

// ==========================================
// CIBA Types
// ==========================================

export const CIBARequestSchema = z.object({
  id: z.string().uuid(),
  authReqId: z.string(),
  sessionId: z.string().uuid(),
  actionRequested: z.string(),
  bindingMessage: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'DENIED', 'EXPIRED']),
  expiresAt: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
  deniedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});

export type CIBARequest = z.infer<typeof CIBARequestSchema>;

// ==========================================
// Message Types
// ==========================================

export const MessageRoleEnum = z.enum(['user', 'assistant', 'system', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleEnum>;

export const MessageSchema = z.object({
  id: z.string(),
  role: MessageRoleEnum,
  content: z.string(),
  toolName: z.string().optional(),
  toolResult: z.unknown().optional(),
  timestamp: z.string().datetime(),
});

export type Message = z.infer<typeof MessageSchema>;

// ==========================================
// API Response Types
// ==========================================

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z
      .object({
        message: z.string(),
        code: z.string().optional(),
      })
      .optional(),
  });

// ==========================================
// Constants
// ==========================================

export const RISK_LEVELS = {
  READ: 1,
  SEARCH: 2,
  CREATE: 3,
  UPDATE: 4,
  DELETE: 5,
} as const;

export const CIBA_REQUIRED_ACTIONS = [
  'github_merge_pr',
  'github_delete_branch',
  'github_delete_repo',
  'jira_delete_issue',
  'slack_invite_user',
] as const;

export const MAX_INPUT_LENGTH = 5000;
export const CIBA_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
