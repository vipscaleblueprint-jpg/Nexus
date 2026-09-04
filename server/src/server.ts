import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { requireEnv } from './config/env';
import { logger, createLogger, errMsg } from './config/logger';
import { httpLogger } from './middleware/logging.middleware';
import { rateLimiter, botBlocker, corsOptions } from './middleware/security.middleware';
import { authRouter } from './routes/auth.routes';
import { userRouter } from './routes/user.routes';
import { spaceRouter } from './routes/space.routes';
import { listRouter } from './routes/list.routes';
import { taskRouter } from './routes/task.routes';
import { chatRouter } from './routes/chat.routes';

const app = express();
const server = http.createServer(app);

// Global Security, Logging & CORS Middlewares
app.use(httpLogger);
app.use(botBlocker);
app.use(rateLimiter);
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Health Check API
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Nexus Full Stack Architecture API Server Active',
    version: '1.0.0',
    endpoints: [
      '/api/auth',
      '/api/users',
      '/api/spaces',
      '/api/lists',
      '/api/tasks',
      '/api/chat',
    ],
  });
});

// Mounted API Endpoints
app.use('/api/auth', authRouter);
app.use('/api/users', userRouter);
app.use('/api/spaces', spaceRouter);
app.use('/api/lists', listRouter);
app.use('/api/tasks', taskRouter);
app.use('/api/chat', chatRouter);

// Catch-all error handler
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log.error({ err }, `Unhandled request error: ${errMsg(err)}`);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const io = new Server(server, {
  cors: {
    origin: requireEnv('CORS_ORIGIN'),
    credentials: true,
  },
});

const socketLog = createLogger('socket.io');

io.on('connection', (socket) => {
  socketLog.info({ socketId: socket.id }, 'Client connected');

  socket.on('disconnect', (reason) => {
    socketLog.info({ socketId: socket.id, reason }, 'Client disconnected');
  });

  // Real-time Urgent Task Notification broadcast
  socket.on('urgent_task_created', (data: { taskId: string; assigneeUserId: string; title: string }) => {
    socketLog.debug({ taskId: data.taskId, assigneeUserId: data.assigneeUserId }, 'Broadcasting urgent task');
    io.emit(`urgent_popup:${data.assigneeUserId}`, data);
  });
});

const PORT = requireEnv('PORT');
server.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV ?? 'development' }, 'Nexus Server API listening');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, `Unhandled promise rejection: ${errMsg(reason)}`);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, `Uncaught exception, shutting down: ${errMsg(err)}`);
  process.exit(1);
});
