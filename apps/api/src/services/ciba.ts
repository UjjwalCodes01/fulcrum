/**
 * CIBA (Client Initiated Backchannel Authentication) Service
 * 
 * This is a KEY HACKATHON REQUIREMENT - Auth0 CIBA for Level 5 actions.
 * 
 * CIBA allows the agent to request human approval for destructive actions
 * via push notification to the user's device. The user approves or denies
 * with biometric authentication (Face ID, fingerprint, etc).
 * 
 * Flow:
 * 1. Agent wants to execute Level 5 action (e.g., merge PR)
 * 2. Backend calls Auth0 CIBA to initiate approval request
 * 3. User receives push notification on their device
 * 4. User approves/denies with biometric auth
 * 5. Auth0 notifies backend of decision
 * 6. If approved, action proceeds; if denied, action is blocked
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import {
  createCIBARequest,
  getCIBARequest,
  getCIBARequestByAuthReqId,
  approveCIBARequest,
  denyCIBARequest,
  expireCIBARequest,
  cancelCIBARequest,
  getPendingCIBARequests,
  updateCIBARequestStatus,
  expireOldRequests,
  getStorageModeInfo,
  CIBARequest,
  CIBAStatus,
} from '../db/ciba.js';

// CIBA Configuration
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || '';
const CIBA_CLIENT_ID = process.env.AUTH0_CIBA_CLIENT_ID || process.env.AUTH0_CLIENT_ID || '';
const CIBA_CLIENT_SECRET = process.env.AUTH0_CIBA_CLIENT_SECRET || process.env.AUTH0_CLIENT_SECRET || '';
const CIBA_TIMEOUT_SECONDS = parseInt(process.env.CIBA_TIMEOUT_SECONDS || '300'); // 5 minutes default

// Auth0 CIBA endpoints
const CIBA_INITIATE_URL = `https://${AUTH0_DOMAIN}/bc-authorize`;
const CIBA_TOKEN_URL = `https://${AUTH0_DOMAIN}/oauth/token`;

// CIBA Response types
interface CIBAInitiateResponse {
  auth_req_id: string;
  expires_in: number;
  interval: number;
}

interface CIBATokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

interface CIBAErrorResponse {
  error: string;
  error_description?: string;
}

// Poll status types
export type CIBAPollStatus = 
  | 'pending'           // Still waiting for user
  | 'approved'          // User approved
  | 'denied'            // User denied
  | 'expired'           // Request timed out
  | 'slow_down'         // Polling too fast
  | 'authorization_pending'; // Same as pending (Auth0's term)

// Result type for initiation
export interface CIBAInitiateResult {
  success: boolean;
  requestId?: string;
  authReqId?: string;
  expiresIn?: number;
  pollInterval?: number;
  error?: string;
  errorCode?: string;
}

// Result type for status check
export interface CIBAStatusResult {
  success: boolean;
  status: CIBAPollStatus | CIBAStatus;
  request?: CIBARequest;
  accessToken?: string;
  error?: string;
}

/**
 * Check if CIBA is configured
 */
export function isCIBAConfigured(): boolean {
  return Boolean(AUTH0_DOMAIN && CIBA_CLIENT_ID && CIBA_CLIENT_SECRET);
}

/**
 * Get CIBA service status
 */
export function getCIBAStatus(): {
  configured: boolean;
  domain: string;
  timeoutSeconds: number;
} {
  return {
    configured: isCIBAConfigured(),
    domain: AUTH0_DOMAIN,
    timeoutSeconds: CIBA_TIMEOUT_SECONDS,
  };
}

/**
 * Initiate a CIBA approval request
 * 
 * This starts the backchannel authentication flow. Auth0 will send a push
 * notification to the user's registered device.
 * 
 * @param userId - The Auth0 user ID (sub claim)
 * @param tool - The Level 5 tool being executed
 * @param sessionId - The agent session ID
 * @param bindingMessage - Human-readable description shown to user
 * @param toolInput - Optional tool input parameters to store
 */
export async function initiateCIBA(params: {
  userId: string;
  tool: string;
  sessionId: string;
  bindingMessage: string;
  toolInput?: Record<string, unknown>;
}): Promise<CIBAInitiateResult> {
  const { userId, tool, sessionId, bindingMessage, toolInput } = params;

  // Check configuration
  if (!isCIBAConfigured()) {
    logger.error('CIBA not configured - cannot initiate approval request');
    return {
      success: false,
      error: 'CIBA not configured',
      errorCode: 'CIBA_NOT_CONFIGURED',
    };
  }

  const requestId = uuidv4();

  try {
    // Call Auth0 CIBA endpoint
    logger.info('Initiating CIBA request', { userId, tool, requestId });

    const response = await fetch(CIBA_INITIATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: CIBA_CLIENT_ID,
        client_secret: CIBA_CLIENT_SECRET,
        scope: 'openid profile',
        // login_hint identifies which user should approve
        login_hint: userId,
        // binding_message is shown to user on their device
        binding_message: bindingMessage,
      }),
    });

    if (!response.ok) {
      const error = await response.json() as CIBAErrorResponse;
      logger.error('CIBA initiation failed', {
        userId,
        tool,
        status: response.status,
        error: error.error,
        description: error.error_description,
      });

      // Handle specific error cases
      if (error.error === 'invalid_request') {
        return {
          success: false,
          error: error.error_description || 'Invalid CIBA request',
          errorCode: 'CIBA_INVALID_REQUEST',
        };
      }

      if (error.error === 'unauthorized_client') {
        return {
          success: false,
          error: 'CIBA client not authorized',
          errorCode: 'CIBA_UNAUTHORIZED',
        };
      }

      return {
        success: false,
        error: error.error_description || error.error || 'CIBA initiation failed',
        errorCode: 'CIBA_INIT_FAILED',
      };
    }

    const cibaResponse = await response.json() as CIBAInitiateResponse;

    // Calculate expiry time
    const expiresAt = new Date(Date.now() + cibaResponse.expires_in * 1000);

    // Store the request in our database
    await createCIBARequest({
      id: requestId,
      userId,
      tool,
      authReqId: cibaResponse.auth_req_id,
      sessionId,
      bindingMessage,
      toolInput,
      expiresAt,
    });

    logger.info('CIBA request initiated successfully', {
      requestId,
      authReqId: cibaResponse.auth_req_id,
      expiresIn: cibaResponse.expires_in,
      pollInterval: cibaResponse.interval,
    });

    return {
      success: true,
      requestId,
      authReqId: cibaResponse.auth_req_id,
      expiresIn: cibaResponse.expires_in,
      pollInterval: cibaResponse.interval,
    };
  } catch (error) {
    logger.error('CIBA initiation error', {
      userId,
      tool,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'CIBA initiation failed',
      errorCode: 'CIBA_ERROR',
    };
  }
}

/**
 * Poll Auth0 for CIBA request status
 * 
 * This checks if the user has approved or denied the request.
 * Should be called at the interval specified by initiateCIBA.
 * 
 * @param authReqId - The Auth0 auth_req_id from initiation
 */
export async function pollCIBAStatus(authReqId: string): Promise<CIBAStatusResult> {
  if (!isCIBAConfigured()) {
    return {
      success: false,
      status: 'expired',
      error: 'CIBA not configured',
    };
  }

  // Get our stored request
  const request = await getCIBARequestByAuthReqId(authReqId);
  if (!request) {
    return {
      success: false,
      status: 'expired',
      error: 'CIBA request not found',
    };
  }

  // Check if already resolved
  if (request.status !== 'pending') {
    return {
      success: true,
      status: request.status,
      request,
    };
  }

  // Check if expired locally
  if (new Date() > request.expiresAt) {
    await expireCIBARequest(request.id);
    return {
      success: true,
      status: 'expired',
      request: { ...request, status: 'expired' },
    };
  }

  try {
    // Poll Auth0 token endpoint
    const response = await fetch(CIBA_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: CIBA_CLIENT_ID,
        client_secret: CIBA_CLIENT_SECRET,
        grant_type: 'urn:openid:params:grant-type:ciba',
        auth_req_id: authReqId,
      }),
    });

    // Success means approved - we got tokens
    if (response.ok) {
      const tokenResponse = await response.json() as CIBATokenResponse;
      await approveCIBARequest(request.id);
      
      logger.info('CIBA request approved', {
        requestId: request.id,
        tool: request.tool,
        userId: request.userId,
      });

      return {
        success: true,
        status: 'approved',
        request: { ...request, status: 'approved', approvedAt: new Date() },
        accessToken: tokenResponse.access_token,
      };
    }

    // Handle error responses
    const error = await response.json() as CIBAErrorResponse;

    switch (error.error) {
      case 'authorization_pending':
        // User hasn't responded yet
        return {
          success: true,
          status: 'pending',
          request,
        };

      case 'slow_down':
        // Polling too fast
        return {
          success: true,
          status: 'slow_down',
          request,
        };

      case 'access_denied':
        // User denied the request
        await denyCIBARequest(request.id);
        logger.info('CIBA request denied by user', {
          requestId: request.id,
          tool: request.tool,
          userId: request.userId,
        });
        return {
          success: true,
          status: 'denied',
          request: { ...request, status: 'denied', deniedAt: new Date() },
        };

      case 'expired_token':
        // Request expired
        await expireCIBARequest(request.id);
        logger.info('CIBA request expired', {
          requestId: request.id,
          tool: request.tool,
          userId: request.userId,
        });
        return {
          success: true,
          status: 'expired',
          request: { ...request, status: 'expired' },
        };

      default:
        logger.error('CIBA poll error', {
          authReqId,
          error: error.error,
          description: error.error_description,
        });
        return {
          success: false,
          status: 'pending',
          request,
          error: error.error_description || error.error,
        };
    }
  } catch (error) {
    logger.error('CIBA poll exception', {
      authReqId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      status: 'pending',
      request,
      error: error instanceof Error ? error.message : 'Poll failed',
    };
  }
}

/**
 * Get CIBA request by ID
 */
export async function getCIBARequestById(requestId: string): Promise<CIBARequest | null> {
  return getCIBARequest(requestId);
}

/**
 * Get pending CIBA requests for a user
 */
export async function getUserPendingRequests(userId: string): Promise<CIBARequest[]> {
  return getPendingCIBARequests(userId);
}

/**
 * Cancel a CIBA request
 */
export async function cancelRequest(requestId: string): Promise<boolean> {
  const result = await cancelCIBARequest(requestId);
  return result !== null;
}

/**
 * Manually approve a CIBA request (for development/testing)
 * 
 * In production, approvals come from Auth0 CIBA flow.
 * This allows testing without real push notifications.
 */
export async function manuallyApprove(requestId: string): Promise<CIBARequest | null> {
  logger.warn('CIBA request manually approved (dev mode)', { requestId });
  return approveCIBARequest(requestId);
}

/**
 * Manually deny a CIBA request (for development/testing)
 */
export async function manuallyDeny(requestId: string): Promise<CIBARequest | null> {
  logger.warn('CIBA request manually denied (dev mode)', { requestId });
  return denyCIBARequest(requestId);
}

/**
 * Generate a binding message for a tool execution
 */
export function generateBindingMessage(tool: string, details?: string): string {
  const toolDescriptions: Record<string, string> = {
    github_merge_pr: 'Merge a pull request',
    github_delete_branch: 'Delete a branch',
    github_delete_repo: 'Delete a repository',
    jira_delete_issue: 'Delete a Jira issue',
    slack_invite_user: 'Invite a user to Slack',
    slack_remove_user: 'Remove a user from Slack',
  };

  const description = toolDescriptions[tool] || tool;
  const base = `Fulcrum wants to: ${description}`;
  
  return details ? `${base}\n${details}` : base;
}

// Export types
export type { CIBARequest, CIBAStatus };

// Re-export for pubsub handler
export type CIBARequestStatus = CIBAStatus;
export { 
  updateCIBARequestStatus as updateRequestStatus, 
  expireOldRequests,
  getStorageModeInfo,
  getPendingCIBARequests,
};
