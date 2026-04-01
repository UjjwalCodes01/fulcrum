import 'dotenv/config';
import express from 'express';
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
import { logger } from './utils/logger.js';
import { errorHandler } from './utils/error-handler.js';

const app = express();
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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Make io available to routes
app.set('io', io);

// Routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/agent', agentRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/audit', auditRouter);

// Error handling
app.use(errorHandler);

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  
  socket.on('join-session', (sessionId: string) => {
    socket.join(`session:${sessionId}`);
    logger.info(`Socket ${socket.id} joined session ${sessionId}`);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Start server
const PORT = parseInt(process.env.PORT || '3001');

httpServer.listen(PORT, () => {
  logger.info(`🚀 Fulcrum API running on port ${PORT}`);
  logger.info(`📊 Rate limit: ${process.env.RATE_LIMIT_PER_USER || 100} requests per 15 min`);
  logger.info(`💰 Max Vertex AI requests/day: ${process.env.MAX_DAILY_VERTEX_REQUESTS || 50}`);
});

export { app, io };
