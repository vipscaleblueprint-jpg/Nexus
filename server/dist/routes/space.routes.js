"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spaceRouter = void 0;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
exports.spaceRouter = (0, express_1.Router)();
// GET /api/spaces (Get full hierarchy: Spaces -> Folders -> Subfolders -> Lists/Docs)
exports.spaceRouter.get('/', async (req, res) => {
    try {
        const spaces = await prisma.space.findMany({
            include: {
                folders: {
                    include: {
                        subfolders: {
                            include: { lists: true, docs: true },
                        },
                        lists: true,
                        docs: true,
                    },
                },
                lists: true,
                docs: true,
            },
        });
        return res.json({ spaces });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// POST /api/spaces (Create Space)
exports.spaceRouter.post('/', async (req, res) => {
    try {
        const { name, icon, color, ownerId } = req.body;
        const space = await prisma.space.create({
            data: { name, icon, color, ownerId },
        });
        return res.status(201).json({ space });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// POST /api/docs (Create Doc, organized by date)
exports.spaceRouter.post('/docs', async (req, res) => {
    try {
        const { title, content, docDate, spaceId, folderId, subfolderId } = req.body;
        const doc = await prisma.doc.create({
            data: {
                title,
                content,
                docDate: docDate ? new Date(docDate) : new Date(),
                spaceId,
                folderId,
                subfolderId,
            },
        });
        return res.status(201).json({ doc });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// GET /api/docs/:id/task-subtab (Auto-list available tasks/subtasks sorted by client)
exports.spaceRouter.get('/docs/:id/task-subtab', async (req, res) => {
    try {
        const tasks = await prisma.task.findMany({
            include: {
                subtasks: true,
                column: true,
                assigneeUser: { select: { id: true, name: true, email: true } },
            },
            orderBy: { clientName: 'asc' },
        });
        return res.json({ tasks });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
