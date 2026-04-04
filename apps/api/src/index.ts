import 'dotenv/config';
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';

import { authRouter } from './routes/auth.js';
import { agentRouter } from './routes/agent.js';
import { connectionsRouter } from './routes/connections.js';
import { auditRouter } from './routes/audit.js';
import { healthRouter } from './routes/health.js';
import { fgaRouter } from './routes/fga.js';
import { cibaRouter } from './routes/ciba.js';
import { metricsRouter } from './routes/metrics.js';
import { logger } from './utils/logger.js';
import { errorHandler } from './utils/error-handler.js';
import { startCIBAPolling } from './pubsub/ciba-handler.js';
import { initializeDatabase, isDatabaseConfigured } from './db/client.js';
import { initializeAuditTables } from './utils/audit.js';

const app: Express = express();
const httpServer = createServer(app);

// Socket.io for real-time updates
const io = new SocketServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Rate limiting (CRITICAL for cost protection)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_PER_USER || '100'),
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Body parsing
// For webhook signature verification, we need raw body for CIBA webhooks
app.use('/api/ciba/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Make io available to routes
app.set('io', io);

// Routes
app.use('/api/health', healthRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/auth', authRouter);
app.use('/api/agent', agentRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/audit', auditRouter);
app.use('/api/fga', fgaRouter);
app.use('/api/ciba', cibaRouter);

// Error handling
app.use(errorHandler);

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  
  socket.on('join-session', (sessionId: string) => {
    socket.join(`session:${sessionId}`);
    logger.info(`Socket ${socket.id} joined session ${sessionId}`);
    
    // Register real-time CIBA listener for this session
    const { registerSessionListener } = require('./pubsub/ciba-handler.js');
    
    // Register listener and get cleanup function
    const cleanup = registerSessionListener(sessionId, (event: any) => {
      // Emit CIBA status update to this session's room
      io.to(`session:${sessionId}`).emit('ciba-status-update', {
        requestId: event.requestId,
        status: event.status,
        timestamp: event.timestamp,
      });
      
      logger.debug('CIBA status update pushed to session', {
        sessionId,
        requestId: event.requestId,
        status: event.status,
      });
    });
    
    // Store cleanup function and sessionId on socket for later use
    socket.data.cibaCleanup = cleanup;
    socket.data.sessionId = sessionId;
    
    // Clean up listener when socket leaves session
    socket.on('leave-session', () => {
      if (socket.data.cibaCleanup) {
        socket.data.cibaCleanup();
        socket.data.cibaCleanup = null;
        socket.data.sessionId = null;
      }
      logger.info(`Socket ${socket.id} left session ${sessionId}`);
    });
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
    
    // Clean up CIBA listener on disconnect (handles browser tab close, etc.)
    if (socket.data.cibaCleanup) {
      socket.data.cibaCleanup();
      logger.debug(`CIBA listener cleaned up on disconnect for session ${socket.data.sessionId}`);
    }
  });
});

// Start server
const PORT = parseInt(process.env.PORT || '3001');

httpServer.listen(PORT, async () => {
  logger.info(`🚀 Fulcrum API running on port ${PORT}`);
  logger.info(`📊 Rate limit: ${process.env.RATE_LIMIT_PER_USER || 100} requests per 15 min`);
  logger.info(`💰 Max Vertex AI requests/day: ${process.env.MAX_DAILY_VERTEX_REQUESTS || 50}`);
  
  // Initialize database if configured
  try {
    const dbConfigured = await isDatabaseConfigured();
    if (dbConfigured) {
      await initializeDatabase();
      logger.info('💾 PostgreSQL database initialized');
      
      // Initialize audit tables
      await initializeAuditTables();
      logger.info('📊 Audit tables initialized');
    } else {
      logger.warn('⚠️ Database not configured - using in-memory storage (NOT production safe)');
    }
  } catch (error) {
    logger.error('Failed to initialize database', { error });
    if (process.env.CIBA_STRICT_MODE === 'true') {
      logger.error('CIBA_STRICT_MODE=true requires database - exiting');
      process.exit(1);
    }
  }
  
  // Start CIBA background polling (every 5 seconds)
  if (process.env.CIBA_POLLING_ENABLED !== 'false') {
    const pollInterval = parseInt(process.env.CIBA_POLL_INTERVAL_MS || '5000');
    startCIBAPolling(pollInterval);
    logger.info(`🔄 CIBA polling started (interval: ${pollInterval}ms)`);
  }
});

export { app, io };
