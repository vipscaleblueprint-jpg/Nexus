"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const dotenv_1 = __importDefault(require("dotenv"));
const auth_routes_1 = require("./routes/auth.routes");
const space_routes_1 = require("./routes/space.routes");
const task_routes_1 = require("./routes/task.routes");
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
app.use((0, cors_1.default)({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true }));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
const io = new socket_io_1.Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
        credentials: true,
    },
});
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Nexus Architecture Server Running' });
});
// API Routes
app.use('/api/auth', auth_routes_1.authRouter);
app.use('/api/spaces', space_routes_1.spaceRouter);
app.use('/api/tasks', task_routes_1.taskRouter);
io.on('connection', (socket) => {
    console.log('[Socket.io] Client connected:', socket.id);
    // Urgent Task Pop-up Signal broadcast
    socket.on('urgent_task_created', (data) => {
        io.emit(`urgent_popup:${data.assigneeUserId}`, data);
    });
});
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 [Nexus Server] Running on http://localhost:${PORT}`);
});
