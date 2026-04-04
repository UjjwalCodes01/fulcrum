/**
 * Observability and Metrics Router
 * 
 * Provides operational visibility into:
 * - Session store health
 * - Rate limiter usage
 * - Circuit breaker states
 * - Error rates by category
 * - Tool execution metrics
 */

import { Router, IRouter } from 'express';
import { jwtCheck, getUserFromToken } from '../middleware/auth.js';
import { getSessionStats } from '../db/sessions.js';
import { getRateLimiterUsage } from '../utils/error-handling.js';
import { logger } from '../utils/logger.js';

export const metricsRouter: IRouter = Router();

/**
 * GET /api/metrics/health
 * Overall system health check
 */
metricsRouter.get('/health', async (_req, res) => {
  try {
    const sessionStats = await getSessionStats();
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024),
      },
      sessions: sessionStats,
    };
    
    res.json(health);
  } catch (error) {
    logger.error('Health check failed', { error });
    res.status(500).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/metrics/rate-limits
 * Rate limiter usage across all providers
 * Requires authentication
 */
metricsRouter.get('/rate-limits', jwtCheck, async (_req, res) => {
  try {
    const providers = ['github', 'jira', 'slack', 'gemini'];
    const usage: Record<string, any> = {};
    
    for (const provider of providers) {
      usage[provider] = getRateLimiterUsage(provider);
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      providers: usage,
    });
  } catch (error) {
    logger.error('Failed to get rate limits', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/metrics/sessions
 * Session store statistics
 * Requires authentication
 */
metricsRouter.get('/sessions', jwtCheck, async (_req, res) => {
  try {
    const stats = await getSessionStats();
    
    res.json({
      timestamp: new Date().toISOString(),
      ...stats,
    });
  } catch (error) {
    logger.error('Failed to get session stats', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/metrics/performance
 * Performance metrics and bottlenecks
 * Requires authentication
 */
metricsRouter.get('/performance', jwtCheck, async (req, res) => {
  try {
    const user = getUserFromToken(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Get process metrics
    const metrics = {
      timestamp: new Date().toISOString(),
      userId: user.userId,
      process: {
        uptime: process.uptime(),
        cpu: process.cpuUsage(),
        memory: {
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024),
        },
      },
      sessions: await getSessionStats(),
      rateLimits: {
        github: getRateLimiterUsage('github'),
        jira: getRateLimiterUsage('jira'),
        slack: getRateLimiterUsage('slack'),
        gemini: getRateLimiterUsage('gemini'),
      },
    };
    
    res.json(metrics);
  } catch (error) {
    logger.error('Failed to get performance metrics', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/metrics/log
 * Client-side error logging endpoint
 * Requires authentication
 */
metricsRouter.post('/log', jwtCheck, async (req, res) => {
  try {
    const user = getUserFromToken(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { level, message, context } = req.body;
    
    // Type-safe logger access
    const logLevel = level && ['info', 'warn', 'error', 'debug'].includes(level) ? level : 'info';
    logger[logLevel as keyof typeof logger](`[Client] ${message}`, {
      userId: user.userId,
      ...context,
    });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to log client message', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
