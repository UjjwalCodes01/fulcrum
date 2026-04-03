import { Router, IRouter } from 'express';

export const healthRouter: IRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'fulcrum-api',
    version: '0.1.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

healthRouter.get('/ready', async (_req, res) => {
  // Add database and service checks here
  const checks = {
    api: true,
    database: false, // Will be updated when DB is connected
    auth0: false,    // Will be updated when Auth0 is connected
    vertexAI: false, // Will be updated when Vertex AI is connected
  };

  const allHealthy = Object.values(checks).every(Boolean);
  
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ready' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});
