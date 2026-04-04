/**
 * CIBA Routes
 * 
 * Handles CIBA-related endpoints including webhooks from Auth0
 * and status/management endpoints.
 */

import { Router, IRouter, Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { getUserFromToken, requireAdmin } from '../middleware/auth.js';
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
      const rawSignature = req.headers['x-auth0-signature'];
      
      if (!webhookSecret) {
        logger.error('CIBA_WEBHOOK_SECRET not configured in strict mode');
        return res.status(500).json({
          error: 'Webhook verification not configured',
          code: 'WEBHOOK_CONFIG_ERROR',
        });
      }
      
      // Validate signature header format
      if (!rawSignature || typeof rawSignature !== 'string') {
        logger.warn('Missing or invalid webhook signature header in strict mode', {
          hasSignature: !!rawSignature,
          signatureType: typeof rawSignature
        });
        return res.status(401).json({
          error: 'Missing or invalid webhook signature',
          code: 'WEBHOOK_SIGNATURE_MISSING',
        });
      }
      
      const signature = rawSignature.trim();
      
      // Verify HMAC signature with production-safe error handling
      // IMPORTANT: Must use raw body, not JSON.stringify(parsed body)
      // Express raw middleware captures this in req.body as Buffer
      const crypto = await import('crypto');
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
      
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');
      
      // Safe signature comparison that handles malformed input
      let signatureValid = false;
      try {
        // Ensure both signatures are the same length before comparison
        const receivedBuffer = Buffer.from(signature, 'hex');
        const expectedBuffer = Buffer.from(expectedSignature, 'hex');
        
        if (receivedBuffer.length === expectedBuffer.length) {
          signatureValid = crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
        }
        // If lengths don't match, signatureValid remains false
      } catch (error) {
        // Handle cases where signature is not valid hex, wrong encoding, etc.
        logger.warn('Malformed webhook signature', { 
          error: error instanceof Error ? error.message : 'Unknown error',
          signatureLength: signature.length,
        });
        signatureValid = false;
      }
      
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
    
    // Parse body if it's still a Buffer (from express.raw)
    const payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
    const { auth_req_id, status, token } = payload;
    
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
 * ADMIN ONLY - Can potentially impact performance
 */
cibaRouter.post('/poll', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getUserFromToken(req);
    
    logger.info('Manual CIBA poll triggered by admin', { userId: user?.userId });
    
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
 * Start background polling (ADMIN ONLY)
 * This affects global system behavior
 */
cibaRouter.post('/polling/start', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getUserFromToken(req);
    const { intervalMs } = req.body;
    const interval = intervalMs ? parseInt(intervalMs) : 5000;
    
    if (interval < 1000) {
      return res.status(400).json({
        error: 'Polling interval must be at least 1000ms',
        code: 'INVALID_INTERVAL',
      });
    }
    
    logger.info('CIBA polling started by admin', { 
      userId: user?.userId, 
      intervalMs: interval 
    });
    
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
 * Stop background polling (ADMIN ONLY)
 * This affects global system behavior
 */
cibaRouter.post('/polling/stop', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getUserFromToken(req);
    
    logger.info('CIBA polling stopped by admin', { userId: user?.userId });
    
    stopCIBAPolling();
    
    res.json({
      success: true,
      message: 'CIBA polling stopped',
    });
  } catch (error) {
    next(error);
  }
});
