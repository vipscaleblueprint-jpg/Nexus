"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskRouter = void 0;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const ruleEngine_1 = require("../services/ruleEngine");
const r2Service_1 = require("../services/r2Service");
const prisma = new client_1.PrismaClient();
exports.taskRouter = (0, express_1.Router)();
// POST /api/tasks (Create task)
exports.taskRouter.post('/', async (req, res) => {
    try {
        const { title, description, clientName, priority, listId, columnId, assigneeUserId, assigneeTeam, creatorId } = req.body;
        const task = await prisma.task.create({
            data: {
                title,
                description,
                clientName,
                priority: priority || 'MEDIUM',
                listId,
                columnId,
                assigneeUserId,
                assigneeTeam,
                creatorId,
            },
            include: {
                column: true,
                subtasks: true,
                checklists: { include: { items: true } },
            },
        });
        return res.status(201).json({ task });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// PATCH /api/tasks/:id/move (Move column status with rule engine validation)
exports.taskRouter.patch('/:id/move', async (req, res) => {
    try {
        const { id } = req.params;
        const { targetColumnId, userRoles } = req.body; // userRoles array e.g. ["PM", "TECH"]
        const validation = await (0, ruleEngine_1.validateTaskStatusTransition)(id, targetColumnId, userRoles || []);
        if (!validation.allowed) {
            return res.status(403).json({ error: validation.reason });
        }
        const updatedTask = await prisma.task.update({
            where: { id },
            data: { columnId: targetColumnId },
            include: { column: true },
        });
        return res.json({ task: updatedTask, message: 'Status updated successfully' });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// POST /api/tasks/:id/attachments/r2-url (Generate Cloudflare R2 presigned upload URL)
exports.taskRouter.post('/:id/attachments/r2-url', async (req, res) => {
    try {
        const { fileName, mimeType } = req.body;
        const r2Config = (0, r2Service_1.getR2PresignedUrl)(fileName, mimeType);
        return res.json(r2Config);
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
