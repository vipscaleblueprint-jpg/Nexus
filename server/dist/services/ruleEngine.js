"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTaskStatusTransition = validateTaskStatusTransition;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function validateTaskStatusTransition(taskId, targetColumnId, userRoles) {
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
            subtasks: true,
            checklists: {
                include: { items: true },
            },
        },
    });
    if (!task) {
        return { allowed: false, reason: 'Task not found' };
    }
    const targetColumn = await prisma.taskColumn.findUnique({
        where: { id: targetColumnId },
        include: { statusRules: true },
    });
    if (!targetColumn) {
        return { allowed: false, reason: 'Target column not found' };
    }
    for (const rule of targetColumn.statusRules) {
        // 1. Check Subtasks completion
        if (rule.requireAllSubtasksComplete) {
            const hasUnfinishedSubtask = task.subtasks.some((st) => !st.isDone);
            if (hasUnfinishedSubtask) {
                return {
                    allowed: false,
                    reason: 'Cannot transition status: All subtasks must be completed first.',
                };
            }
        }
        // 2. Check Checklist items completion
        if (rule.requireAllChecklistItemsComplete) {
            const allItems = task.checklists.flatMap((c) => c.items);
            const hasUncheckedItem = allItems.some((item) => !item.isDone);
            if (hasUncheckedItem) {
                return {
                    allowed: false,
                    reason: 'Cannot transition status: All checklist items must be checked first.',
                };
            }
        }
        // 3. Check Role Permissions
        if (rule.allowedRoles && rule.allowedRoles.length > 0) {
            const hasAllowedRole = userRoles.some((role) => rule.allowedRoles.includes(role));
            if (!hasAllowedRole) {
                return {
                    allowed: false,
                    reason: `Insufficient role permissions. Required roles: ${rule.allowedRoles.join(', ')}`,
                };
            }
        }
    }
    return { allowed: true };
}
