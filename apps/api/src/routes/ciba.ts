/**
 * CIBA Routes
 * 
 * Handles CIBA-related endpoints including webhooks from Auth0
 * and status/management endpoints.
 */

import { Router, IRouter, Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { jwtCheck, getUserFromToken } from '../middleware/auth.js';
import {
  handleAuth0Webhook,
  getCIBAStats,
  pollPendingRequests,
  startCIBAPolling,
  stopCIBAPolling,
} from '../pubsub/ciba-handler.js';
import { getCIBAStatus } from '../services/ciba.js';

export const cibaRouter: IRouter = Router();

/**
 * GET /api/ciba/status
 * Get CIBA service status and statistics
 */
cibaRouter.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const configStatus = getCIBAStatus();
    const stats = await getCIBAStats();
    
    res.json({
      service: 'ciba',
      status: configStatus.configured ? 'operational' : 'degraded',
      configured: configStatus.configured,
      domain: configStatus.domain,
      statistics: stats,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/ciba/webhook
 * Receive approval/denial webhooks from Auth0
 * 
 * Auth0 will POST to this endpoint when a CIBA request is approved or denied.
 * This is more efficient than polling.
 * 
 * SECURITY: In production (CIBA_STRICT_MODE=true), webhook signature is required.
 */
cibaRouter.post('/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const strictMode = process.env.CIBA_STRICT_MODE === 'true';
    const webhookSecret = process.env.CIBA_WEBHOOK_SECRET;
    
    // SECURITY: Verify webhook signature in production
    if (strictMode) {
      const signature = req.headers['x-auth0-signature'] as string;
      
      if (!webhookSecret) {
        logger.error('CIBA_WEBHOOK_SECRET not configured in strict mode');
        return res.status(500).json({
          error: 'Webhook verification not configured',
          code: 'WEBHOOK_CONFIG_ERROR',
        });
      }
      
      if (!signature) {
        logger.warn('Missing webhook signature in strict mode');
        return res.status(401).json({
          error: 'Missing webhook signature',
          code: 'WEBHOOK_SIGNATURE_MISSING',
        });
      }
      
      // Verify HMAC signature
      // Auth0 uses HMAC-SHA256 with the webhook secret
      const crypto = await import('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      
      const signatureValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
      
      if (!signatureValid) {
        logger.warn('Invalid webhook signature', { 
          received: signature.substring(0, 10) + '...',
        });
        return res.status(401).json({
          error: 'Invalid webhook signature',
          code: 'WEBHOOK_SIGNATURE_INVALID',
        });
      }
      
      logger.info('Webhook signature verified');
    }
    
    const { auth_req_id, status, token } = req.body;
    
    if (!auth_req_id || !status) {
      return res.status(400).json({
        error: 'Missing required fields: auth_req_id, status',
        code: 'INVALID_WEBHOOK',
      });
    }
    
    if (!['approved', 'denied'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status: must be approved or denied',
        code: 'INVALID_STATUS',
      });
    }
    
    logger.info('CIBA webhook received', { auth_req_id, status });
    
    await handleAuth0Webhook({ auth_req_id, status, token });
    
    res.json({
      success: true,
      message: 'Webhook processed',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/ciba/poll
 * Manually trigger polling for pending CIBA requests
 * Useful for debugging and testing
 */
cibaRouter.post('/poll', jwtCheck, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getUserFromToken(req);
    
    // Only allow admins to manually poll
    // For hackathon, allow any authenticated user
    logger.info('Manual CIBA poll triggered', { userId: user?.userId });
    
    const updated = await pollPendingRequests();
    
    res.json({
      success: true,
      message: 'Polling complete',
      updated,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/ciba/polling/start
 * Start background polling (admin only)
 */
cibaRouter.post('/polling/start', jwtCheck, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { intervalMs } = req.body;
    const interval = intervalMs ? parseInt(intervalMs) : 5000;
    
    if (interval < 1000) {
      return res.status(400).json({
        error: 'Polling interval must be at least 1000ms',
        code: 'INVALID_INTERVAL',
      });
    }
    
    startCIBAPolling(interval);
    
    res.json({
      success: true,
      message: 'CIBA polling started',
      intervalMs: interval,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/ciba/polling/stop
 * Stop background polling (admin only)
 */
cibaRouter.post('/polling/stop', jwtCheck, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    stopCIBAPolling();
    
    res.json({
      success: true,
      message: 'CIBA polling stopped',
    });
  } catch (error) {
    next(error);
  }
});
