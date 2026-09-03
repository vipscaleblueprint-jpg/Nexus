import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { authRouter } from './routes/auth.routes';
import { spaceRouter } from './routes/space.routes';
import { taskRouter } from './routes/task.routes';

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(cookieParser());

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Nexus Architecture Server Running' });
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/spaces', spaceRouter);
app.use('/api/tasks', taskRouter);

io.on('connection', (socket) => {
  console.log('[Socket.io] Client connected:', socket.id);

  // Urgent Task Pop-up Signal broadcast
  socket.on('urgent_task_created', (data: { taskId: string; assigneeUserId: string; title: string }) => {
    io.emit(`urgent_popup:${data.assigneeUserId}`, data);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 [Nexus Server] Running on http://localhost:${PORT}`);
});
