import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import { Hocuspocus } from '@hocuspocus/server';
import { requireEnv } from './config/env';
import { logger, createLogger, errMsg } from './config/logger';
import { httpLogger } from './middleware/logging.middleware';
import { rateLimiter, botBlocker, corsOptions } from './middleware/security.middleware';
import { authRouter } from './routes/auth.routes';
import { userRouter } from './routes/user.routes';
import { spaceRouter } from './routes/space.routes';
import { listRouter } from './routes/list.routes';
import notificationRoutes from './routes/notification.routes';
import { taskRouter } from './routes/task.routes';
import { chatRouter } from './routes/chat.routes';
import { invitationRouter } from './routes/invitation.routes';
import { rolesRouter } from './routes/roles.routes';
import { uploadRouter } from './routes/upload.routes';

// Import workers to initialize them
import './workers/task.worker';

const app = express();
const server = http.createServer(app);

// Hocuspocus WebSocket Server for Collaborative Editing
const hocuspocus = new Hocuspocus();
hocuspocus.configure({
  async onConnect(data) {
    logger.info(`Hocuspocus Client connecting to document: ${data.documentName}`);
  },
  async onChange(data) {
    logger.info(`Hocuspocus Document changed: ${data.documentName}`);
  },
});
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = request.url || '';
  logger.info(`WebSocket Upgrade request to: ${url}`);
  if (url.startsWith('/collaboration')) {
    // HocuspocusProvider appends the document name to the URL path.
    // e.g. ws://host/collaboration/task-abc123 → document name = "task-abc123"
    // Strip /collaboration prefix so Hocuspocus sees "/<docName>" and parses it correctly.
    const docPath = url.replace(/^\/collaboration/, '') || '/default';
    const documentName = docPath.split('?')[0].replace(/^\//, '') || 'default';
    
    logger.info(`Accepting Hocuspocus connection for document: ${documentName}`);
    wss.handleUpgrade(request, socket, head, (ws) => {
      // Rewrite request.url so Hocuspocus internal parsing reads the correct document name
      request.url = '/' + documentName;
      hocuspocus.handleConnection(ws as any, request as any);
    });
  }
});

// Global Security, Logging & CORS Middlewares
app.use(httpLogger);
app.use(cors(corsOptions));
app.use(botBlocker);
app.use(rateLimiter);
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
app.use('/api/notifications', notificationRoutes);
app.use('/api/tasks', taskRouter);
app.use('/api/chat', chatRouter);
app.use('/api/invitations', invitationRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/upload', uploadRouter);

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

  // Kanban Real-time Sync
  socket.on('join_list', (listId: string) => {
    socket.join(`list:${listId}`);
    socketLog.debug({ socketId: socket.id, listId }, 'Client joined list room');
  });

  // User Real-time Notifications
  socket.on('join_user', (userId: string) => {
    socket.join(`user:${userId}`);
    socketLog.debug({ socketId: socket.id, userId }, 'Client joined user room');
  });

  socket.on('leave_user', (userId: string) => {
    socket.leave(`user:${userId}`);
  });

  socket.on('leave_list', (listId: string) => {
    socket.leave(`list:${listId}`);
    socketLog.debug({ socketId: socket.id, listId }, 'Client left list room');
  });

  socket.on('add_group', (data: { listId: string; group: string }) => {
    logger.debug(`Group ${data.group} added to list ${data.listId}`);
    socket.to(`list:${data.listId}`).emit('list:group_added', data.group);
  });

  // Handle task activity broadcast
  socket.on('task_activity', (data: { listId: string; taskId: string; activity: any }) => {
    socket.to(`list:${data.listId}`).emit('task_activity', data);
  });

  // Handle task reorder broadcast
  socket.on('task_reorder', (data: { listId: string; status: string; taskIds: string[] }) => {
    socket.to(`list:${data.listId}`).emit('task_reorder', { status: data.status, taskIds: data.taskIds });
  });

  // Handle task description editing lock
  socket.on('task_editing_start', (data: { listId: string; taskId: string; userName: string }) => {
    socket.to(`list:${data.listId}`).emit('task_editing_start', { taskId: data.taskId, userName: data.userName });
  });

  // Handle live content streaming while editing
  socket.on('task_editing_content', (data: { listId: string; taskId: string; content: string }) => {
    socket.to(`list:${data.listId}`).emit('task_editing_content', { taskId: data.taskId, content: data.content });
  });

  // Handle task description editing unlock + broadcast new content
  socket.on('task_editing_stop', (data: { listId: string; taskId: string; description: string }) => {
    socket.to(`list:${data.listId}`).emit('task_editing_stop', { taskId: data.taskId, description: data.description });
  });

  // --- Document Real-time Sync ---
  socket.on('join_doc', (docId: string) => {
    socket.join(`doc:${docId}`);
    socketLog.debug({ socketId: socket.id, docId }, 'Client joined doc room');
  });

  socket.on('leave_doc', (docId: string) => {
    socket.leave(`doc:${docId}`);
    socketLog.debug({ socketId: socket.id, docId }, 'Client left doc room');
  });

  socket.on('block_focus', (data: { docId: string; blockId: string; userId: string; userName: string }) => {
    socket.to(`doc:${data.docId}`).emit('block_locked', { blockId: data.blockId, userId: data.userId, userName: data.userName });
  });

  socket.on('block_blur', (data: { docId: string; blockId: string; userId: string }) => {
    socket.to(`doc:${data.docId}`).emit('block_unlocked', { blockId: data.blockId, userId: data.userId });
  });

  socket.on('block_content_update', (data: { docId: string; blockId: string; content: string }) => {
    socket.to(`doc:${data.docId}`).emit('block_content_update', { blockId: data.blockId, content: data.content });
  });

  socket.on('page_updated', (data: { docId: string; pageId: string }) => {
    socket.to(`doc:${data.docId}`).emit('page_updated', { pageId: data.pageId });
  });
});

export { io };

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
