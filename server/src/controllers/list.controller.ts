import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getCache, setCache, invalidateCache } from '../services/redisService';
import { compareTaskOrder } from '../services/taskOrderService';

// GET /api/lists - Redis Cache-Aside
export async function listLists(req: Request, res: Response) {
  try {
    const cachedLists = await getCache<any[]>('lists:all');
    if (cachedLists) {
      return res.json({ lists: cachedLists, cached: true });
    }

    const lists = await prisma.list.findMany({
      include: {
        statuses: { orderBy: { order: 'asc' } },
        tasks: {
          include: {
            subtasks: {
              include: { checklists: { include: { items: true } } }
            },
            checklists: { include: { items: true } },
            comments: { select: { id: true } },
            attachments: { select: { id: true } },
            assignee: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    await setCache('lists:all', lists, 300);

    return res.json({ lists, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// GET /api/lists/:id
export async function getList(req: Request, res: Response) {
  try {
    const excludeTasks = req.query.excludeTasks === 'true';

    const list = await prisma.list.findUnique({
      where: { id: req.params.id },
      include: {
        space: { select: { id: true, name: true, color: true } },
        folder: { select: { id: true, name: true } },
        statuses: { orderBy: { order: 'asc' } },
        ...(excludeTasks ? {} : {
          tasks: {
            orderBy: { createdAt: 'asc' },
            include: {
              assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
              assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
              creator: { select: { id: true, name: true, email: true, avatarUrl: true } },
              subtasks: { 
                include: { 
                  checklists: { include: { items: true } }
                } 
              },
              checklists: { include: { items: true } },
              _count: {
                select: {
                  comments: true,
                  attachments: true,
                }
              }
            },
          }
        })
      },
    });

    if (!list) return res.status(404).json({ error: 'List not found' });

    // Stable sort on top of the createdAt ordering, so only positioned tasks (e.g. duplicates) move
    if ('tasks' in list) list.tasks.sort(compareTaskOrder);

    return res.json({ list });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}




// Default statuses seeded on every new list — mirrors KanbanBoard CATEGORIES
const DEFAULT_STATUSES = [
  { name: 'KYC', color: '#3A8F55', groupName: 'Client Details' },
  { name: 'PIN BOARD', color: '#1F8A6E', groupName: 'Client Details' },
  { name: 'DAILY', color: '#2F7BD0', groupName: 'Recurring' },
  { name: 'WEEKLY', color: '#2F7BD0', groupName: 'Recurring' },
  { name: 'MONTHLY', color: '#2F7BD0', groupName: 'Recurring' },
  { name: 'PENDING', color: '#D29A2A', groupName: 'Workflow & Progress' },
  { name: 'IN PROGRESS', color: '#D04A7C', groupName: 'Workflow & Progress' },
  { name: 'REVISION', color: '#5B6BD6', groupName: 'Workflow & Progress' },
  { name: 'WAITING', color: '#D9534F', groupName: 'Management' },
  { name: 'IN REVIEW', color: '#D97B3A', groupName: 'Management' },
  { name: 'CHECKING', color: '#A35DB8', groupName: 'Management' },
  { name: 'CRM', color: '#22A3AE', groupName: 'Management' },
  { name: 'CLOSED', color: '#2FA37A', groupName: 'Workflow & Progress' },
  { name: 'ON-HOLD', color: '#8A8F98', groupName: 'Workflow & Progress' },
];

// POST /api/lists
export async function createList(req: Request, res: Response) {
  try {
    const { name, spaceId, folderId } = req.body;
    const list = await prisma.list.create({
      data: { 
        name, 
        spaceId: spaceId || null, 
        folderId: folderId || null,
        customGroups: ['Client Details', 'Recurring', 'Workflow & Progress', 'Management']
      },
    });

    const defaultStatusesToSeed = DEFAULT_STATUSES.map(s => {
      if (s.name === 'KYC') {
        return { ...s, name: list.name, allowedRoles: [], listId: list.id };
      }
      return { ...s, allowedRoles: [], listId: list.id };
    });

    // Auto-seed default statuses for every new list
    await prisma.listStatus.createMany({
      data: defaultStatusesToSeed,
      skipDuplicates: true,
    });

    await invalidateCache('lists:all', 'spaces:all', 'dashboard:all');

    return res.status(201).json({ list });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/lists/:id
export async function updateList(req: Request, res: Response) {
  try {
    const { name, customGroups, applyToAll } = req.body;
    const list = await prisma.list.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(customGroups && { customGroups }),
      },
    });

    if (applyToAll && customGroups) {
      const allLists = await prisma.list.findMany({ select: { id: true, customGroups: true } });
      const newGroup = customGroups[customGroups.length - 1]; 
      
      const updatePromises = allLists.map(l => {
        if (!l.customGroups.includes(newGroup)) {
          return prisma.list.update({
            where: { id: l.id },
            data: { customGroups: { push: newGroup } } 
          });
        }
      });
      await Promise.all(updatePromises.filter(Boolean));
    }

    await invalidateCache('lists:all', 'spaces:all', 'dashboard:all');

    return res.json({ list });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'List not found' });
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/lists/:id/duplicate
export async function duplicateList(req: Request, res: Response) {
  try {
    const original = await prisma.list.findUnique({ where: { id: req.params.id } });
    if (!original) return res.status(404).json({ error: 'List not found' });

    const list = await prisma.list.create({
      data: {
        name: `${original.name} (Copy)`,
        spaceId: original.spaceId,
        folderId: original.folderId,
      },
    });

    await invalidateCache('lists:all', 'spaces:all', 'dashboard:all');

    return res.status(201).json({ list });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/lists/:id
export async function deleteList(req: Request, res: Response) {
  try {
    await prisma.list.delete({ where: { id: req.params.id } });

    await invalidateCache('lists:all', 'spaces:all', 'dashboard:all');

    return res.json({ message: 'List deleted successfully' });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'List not found' });
    return res.status(500).json({ error: err.message });
  }
}

const DEFAULT_STATUS_THEMES: Record<string, string> = {
  KYC: '#3A8F55',
  Kyc: '#3A8F55',
  'Pin Board': '#1F8A6E',
  'PIN BOARD': '#1F8A6E',
  PIN_BOARD: '#1F8A6E',
  Daily: '#2F7BD0',
  DAILY: '#2F7BD0',
  Weekly: '#2F7BD0',
  WEEKLY: '#2F7BD0',
  Monthly: '#2F7BD0',
  MONTHLY: '#2F7BD0',
  Pending: '#D29A2A',
  PENDING: '#D29A2A',
  'In Progress': '#D04A7C',
  'IN PROGRESS': '#D04A7C',
  IN_PROGRESS: '#D04A7C',
  Revision: '#5B6BD6',
  REVISION: '#5B6BD6',
  Waiting: '#D9534F',
  WAITING: '#D9534F',
  'In Review': '#D97B3A',
  'IN REVIEW': '#D97B3A',
  IN_REVIEW: '#D97B3A',
  Checking: '#A35DB8',
  CHECKING: '#A35DB8',
  CRM: '#22A3AE',
  Crm: '#22A3AE',
  'On-Hold': '#8A8F98',
  'ON-HOLD': '#8A8F98',
  ON_HOLD: '#8A8F98',
  Closed: '#2FA37A',
  CLOSED: '#2FA37A',
  TODO: '#475569',
  DONE: '#2FA37A',
  COMPLETE: '#2FA37A',
  COMPLETED: '#2FA37A',
  CANCELLED: 'rose',
};

// POST /api/lists/:id/statuses
export async function createStatus(req: Request, res: Response) {
  try {
    const { name, color, allowedRoles, groupName, applyToAll } = req.body;
    const defaultColor = DEFAULT_STATUS_THEMES[name] || 'zinc';

    if (applyToAll) {
      const allLists = await prisma.list.findMany({
        include: { statuses: { select: { name: true } } }
      });
      
      const statusesToCreate = allLists
        .filter(l => !l.statuses.some(s => s.name === name))
        .map(l => ({
          name,
          color: color || defaultColor,
          allowedRoles: allowedRoles || [],
          groupName: groupName || null,
          listId: l.id,
        }));
      
      if (statusesToCreate.length > 0) {
        await prisma.listStatus.createMany({
          data: statusesToCreate,
        });
      }

      let status = await prisma.listStatus.findFirst({
        where: { listId: req.params.id, name },
      });
      
      if (!status) {
        status = await prisma.listStatus.create({
          data: {
            name,
            color: color || defaultColor,
            allowedRoles: allowedRoles || [],
            groupName: groupName || null,
            listId: req.params.id,
          },
        });
      }

      await invalidateCache('lists:all', 'spaces:all', 'dashboard:all');
      return res.status(201).json({ status });
    } else {
      const status = await prisma.listStatus.create({
        data: {
          name,
          color: color || defaultColor,
          allowedRoles: allowedRoles || [],
          groupName: groupName || null,
          listId: req.params.id,
        },
      });
      await invalidateCache('lists:all', 'spaces:all', 'dashboard:all');
      return res.status(201).json({ status });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/lists/:id/statuses/:statusId
export async function updateStatus(req: Request, res: Response) {
  try {
    const { name, color, allowedRoles, groupName } = req.body;
    
    if (name) {
      const oldStatus = await prisma.listStatus.findUnique({
        where: { id: req.params.statusId },
      });
      if (oldStatus && oldStatus.name !== name) {
        // Update all tasks in this list that have the old status
        await prisma.task.updateMany({
          where: { listId: req.params.id, status: oldStatus.name },
          data: { status: name },
        });
      }
    }

    const status = await prisma.listStatus.update({
      where: { id: req.params.statusId },
      data: {
        ...(name && { name }),
        ...(color && { color }),
        ...(allowedRoles && { allowedRoles }),
        ...(groupName !== undefined && { groupName }),
      },
    });
    return res.json({ status });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Status not found' });
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/lists/:id/statuses/:statusId
export const deleteStatus = async (req: Request, res: Response) => {
  try {
    await prisma.listStatus.delete({ where: { id: req.params.statusId } });
    return res.json({ success: true });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Status not found' });
    return res.status(500).json({ error: err.message });
  }
};

// PATCH /api/lists/:id/statuses/reorder
export const reorderStatuses = async (req: Request, res: Response) => {
  try {
    const { listId, orderedStatusIds } = req.body;
    
    // Use transaction to update all orders
    const updates = orderedStatusIds.map((statusId: string, index: number) => {
      return prisma.listStatus.update({
        where: { id: statusId },
        data: { order: index },
      });
    });

    await prisma.$transaction(updates);

    return res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to reorder statuses:', err);
    return res.status(500).json({ error: err.message });
  }
};
