import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import { Hocuspocus } from '@hocuspocus/server';
import { requireEnv, optionalEnv } from './config/env';
import { logger, createLogger, errMsg } from './config/logger';
import { httpLogger } from './middleware/logging.middleware';
import { serverTiming, getInFlightRequests } from './middleware/serverTiming.middleware';
import { startRuntimeMetrics } from './config/runtimeMetrics';
import { rateLimiter, botBlocker, corsOptions } from './middleware/security.middleware';
import { requireLoginExcept, verifyAccessToken, readCookie } from './middleware/auth.middleware';
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
import externalRoutes from './routes/external.routes';
import webhookRoutes from './routes/webhook.routes';
import teamRouter from './routes/team.routes';
import clickupRoutes from './routes/clickup.routes';
import activityRoutes from './routes/activity.routes';

// Import workers to initialize them
import './workers/task.worker';
import { dailyRolloverQueue } from './queues/dailyRollover.queue';
import { JOURNAL_CATCH_UP_JOB } from './workers/dailyRollover.worker';
import { toolsSyncQueue } from './queues/toolsSync.queue';
import './workers/toolsSync.worker';

const app = express();
const server = http.createServer(app);

// Initialize daily rollover cron job
(async () => {
  await dailyRolloverQueue.add('checkRollovers', {}, {
    repeat: {
      pattern: '0 0 * * *', // Every day at midnight
      tz: 'Asia/Singapore'
    }
  });

  // Safety net for the journal auto-append (appendMissingTasksToJournal), every 5 minutes. Kept in Redis, so a
  // server restart doesn't lose it.
  await dailyRolloverQueue.add(JOURNAL_CATCH_UP_JOB, {}, {
    repeat: { every: 5 * 60 * 1000 },
    jobId: 'journal-catch-up',
    attempts: 1, // the next scheduled run is the retry
    removeOnFail: 50,
  });

  // Two-way user sync with the tools (VIPScale), every 10 minutes.
  await toolsSyncQueue.add('reconcile', {}, {
    repeat: { every: 10 * 60 * 1000 },
    jobId: 'tools-sync-reconcile',
  });
})();

// Hocuspocus WebSocket Server for Collaborative Editing
const hocuspocus = new Hocuspocus();
hocuspocus.configure({
  async onConnect(data) {
    logger.info(`Hocuspocus Client connecting to document: ${data.documentName}`);
  },
  // Fires on every edit (each keystroke), so debug only: at info it floods the production log
  async onChange(data) {
    logger.debug(`Hocuspocus Document changed: ${data.documentName}`);
  },
});
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (request, socket, head) => {
  const url = request.url || '';
  logger.debug(`WebSocket Upgrade request to: ${url}`);
  if (url.startsWith('/collaboration')) {
    // Same session as the HTTP API: the browser sends the accessToken cookie with the WebSocket handshake
    const user = await verifyAccessToken(readCookie(request.headers.cookie, 'accessToken'));
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    // HocuspocusProvider appends the document name to the URL path.
    // e.g. ws://host/collaboration/task-abc123 → document name = "task-abc123"
    // Strip /collaboration prefix so Hocuspocus sees "/<docName>" and parses it correctly.
    const docPath = url.replace(/^\/collaboration/, '') || '/default';
    const documentName = docPath.split('?')[0].replace(/^\//, '') || 'default';
    
    logger.debug(`Accepting Hocuspocus connection for document: ${documentName}`);
    wss.handleUpgrade(request, socket, head, (ws) => {
      // Rewrite request.url so Hocuspocus internal parsing reads the correct document name
      request.url = '/' + documentName;
      hocuspocus.handleConnection(ws as any, request as any);
    });
  }
});

// Behind a reverse proxy, req.ip is the proxy's address unless Express trusts it, so every user would share one
// rate-limit bucket. TRUST_PROXY = how many proxies sit in front of this server (e.g. 1); unset trusts none.
const trustProxyHops = Number(optionalEnv('TRUST_PROXY'));
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set('trust proxy', trustProxyHops);
}

// Global Security, Logging & CORS Middlewares
app.use(serverTiming);
app.use(httpLogger);
app.use(cors(corsOptions));
app.use(botBlocker);
app.use(rateLimiter);
app.use(cookieParser());
// Every API section needs a logged-in user except these, which authenticate themselves: the login flows, and the
// integrations that use an API key (/external) or the shared VIPScale key (/webhooks).
// Before body parsing, so anonymous requests never get a large body parsed.
app.use('/api', requireLoginExcept(['health', 'auth', 'external', 'webhooks']));
// Login, signup and password-reset bodies are tiny: anonymous callers don't get the 50 MB limit
app.use('/api/auth', express.json({ limit: '100kb' }), express.urlencoded({ limit: '100kb', extended: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
      '/api/external',
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
app.use('/api/external', externalRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/teams', teamRouter);
app.use('/api/clickup', clickupRoutes);
app.use('/api/activity', activityRoutes);

// Catch-all error handler
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log.error({ err }, `Unhandled request error: ${errMsg(err)}`);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const io = new Server(server, {
  cors: corsOptions,
});

const socketLog = createLogger('socket.io');

// Sockets need the same login as the HTTP API (the accessToken cookie, sent with the handshake via withCredentials).
// Without this anyone could connect, join any user/list/doc room, and receive every global broadcast.
io.use(async (socket, next) => {
  const user = await verifyAccessToken(readCookie(socket.request.headers.cookie, 'accessToken'));
  if (!user) return next(new Error('Unauthorized'));
  socket.data.user = user;
  next();
});

startRuntimeMetrics(() => ({ sockets: io.engine.clientsCount, inFlight: getInFlightRequests() }));

io.on('connection', (socket) => {
  socketLog.info({ socketId: socket.id }, 'Client connected');

  socket.on('disconnect', (reason) => {
    socketLog.info({ socketId: socket.id, reason }, 'Client disconnected');
  });

  // Real-time Urgent Task Notification broadcast
  socket.on('urgent_task_created', (data: { taskId: string; assigneeUserId: string; title: string }) => {
    socketLog.debug({ taskId: data.taskId, assigneeUserId: data.assigneeUserId }, 'Broadcasting urgent task');
    // Only to the assignee's own room, not to every connected client
    io.to(`user:${data.assigneeUserId}`).emit(`urgent_popup:${data.assigneeUserId}`, data);
  });

  // Kanban Real-time Sync
  socket.on('join_list', (listId: string) => {
    socket.join(`list:${listId}`);
    socketLog.debug({ socketId: socket.id, listId }, 'Client joined list room');
  });

  // User Real-time Notifications
  socket.on('join_user', (userId: string) => {
    // Only your own notification room
    if (userId !== socket.data.user.id) return;
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

  socket.on('reorder_groups', (data: { listId: string; customGroups: string[] }) => {
    socket.to(`list:${data.listId}`).emit('list:groups_reordered', data.customGroups);
  });

  socket.on('delete_group', (data: { listId: string; group: string }) => {
    socket.to(`list:${data.listId}`).emit('list:group_deleted', data.group);
  });

  socket.on('rename_group', (data: { listId: string; oldName: string; newName: string }) => {
    socket.to(`list:${data.listId}`).emit('list:group_renamed', data);
  });

  // Handle task activity broadcast
  socket.on('task_activity', (data: { listId: string; taskId: string; activity: any }) => {
    socket.to(`list:${data.listId}`).emit('task_activity', data);
  });

  // Handle task reorder broadcast
  socket.on('task_reorder', (data: { listId: string; status: string; taskIds: string[] }) => {
    socket.to(`list:${data.listId}`).emit('task_reorder', { status: data.status, taskIds: data.taskIds });
  });

  // Handle task move preview (sync dragging across clients instantly)
  socket.on('task_move_preview', (data: { listId: string; taskId: string; status: string }) => {
    socket.to(`list:${data.listId}`).emit('task_move_preview', data);
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
    socket.to(`list:${data.listId}`).emit('task_editing_stop', data);
  });

  socket.on('subtask_editing_start', (data: { listId: string; taskId: string; subtaskId: string; userName: string }) => {
    socket.to(`list:${data.listId}`).emit('subtask_editing_start', data);
  });

  socket.on('subtask_editing_content', (data: { listId: string; taskId: string; subtaskId: string; content: string }) => {
    socket.to(`list:${data.listId}`).emit('subtask_editing_content', data);
  });

  socket.on('subtask_editing_stop', (data: { listId: string; taskId: string; subtaskId: string }) => {
    socket.to(`list:${data.listId}`).emit('subtask_editing_stop', data);
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
if (!process.env.STANDALONE_SCRIPT) {
  server.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV ?? 'development' }, 'Nexus Server API listening');
  });
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, `Unhandled promise rejection: ${errMsg(reason)}`);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, `Uncaught exception, shutting down: ${errMsg(err)}`);
  process.exit(1);
});
