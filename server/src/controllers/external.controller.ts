import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'crypto';
import { io } from '../server';
import { hashApiKey } from '../utils/apiKey';
import { invalidateCache, redis } from '../services/redisService';
import { appendTaskToJournal, NEW_TASK_BADGE } from '../utils/pageBlocks';
import { updatePageBlocks } from '../services/pageContentService';
import { injectSubtaskIntoJournal } from '../services/journalInjectionService';
import {
  resolveClickUpListId,
  mapNexusStatusToClickUp,
  mapNexusPriorityToClickUp,
  safeCreateClickUpTask,
  safeCreateClickUpChecklist,
  safeCreateClickUpChecklistItem,
} from '../services/clickupService';
import { getStatusChangeRecipients } from '../utils/roleNotification';
import { filterUsersByNotificationPreference } from '../utils/notificationPreferences';
import { toNotificationPreview } from '../utils/mentionNotification';


async function getOrCreateVipScaleUser() {
  let vipScaleUser = await prisma.user.findFirst({
    where: { name: { equals: 'VIPSCALE', mode: 'insensitive' } }
  });

  if (!vipScaleUser) {
    const password = await bcrypt.hash(Math.random().toString(36), 10);
    vipScaleUser = await prisma.user.create({
      data: {
        name: 'VIPSCALE',
        email: 'api-vipscale@system.local',
        password,
        systemRole: 'ADMIN',
      }
    });
  }

  return vipScaleUser;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function dropCommentCache(taskId: string, subtaskId?: string | null) {
  if (redis) {
    const keys = [`comments:list:${taskId}`];
    if (subtaskId) keys.push(`comments:list:${taskId}:sub:${subtaskId}`);
    await redis.del(...keys).catch(() => {});
  }
}

interface TargetResolution {
  task: any | null;
  subtask: any | null;
  isSubtask: boolean;
  taskId: string;
  subtaskId: string | null;
}

/**
 * Resolves target task and/or subtask from input which could be:
 * - A bare UUID (either main task or subtask)
 * - Explicit { taskId, subtaskId }
 * - A Nexus link (.../lists/<listId>?task=<taskId>&subtask=<subtaskId> or .../tasks/<id> or .../subtasks/<id>)
 * - A ClickUp link or ClickUp task ID
 */
async function resolveTargetTaskAndSubtask(
  inputTaskId?: string | null,
  inputSubtaskId?: string | null,
  link?: string | null
): Promise<TargetResolution | null> {
  let rawTaskId = inputTaskId?.trim() || null;
  let rawSubtaskId = inputSubtaskId?.trim() || null;

  if (link && typeof link === 'string' && link.trim()) {
    const val = link.trim();
    if (UUID_REGEX.test(val)) {
      if (!rawTaskId) rawTaskId = val;
    } else {
      try {
        const url = new URL(val);
        const qTask = url.searchParams.get('task');
        const qSubtask = url.searchParams.get('subtask');
        if (qTask) rawTaskId = qTask;
        if (qSubtask) rawSubtaskId = qSubtask;
        const pathMatch = url.pathname.match(/\/(tasks|subtasks)\/([0-9a-f-]{36})/i);
        if (pathMatch) {
          if (pathMatch[1].toLowerCase() === 'subtasks') {
            rawSubtaskId = pathMatch[2];
          } else if (!rawTaskId) {
            rawTaskId = pathMatch[2];
          }
        }
      } catch {
        // Not a standard URL
      }
    }
  }

  // 1. If explicit subtaskId is provided:
  if (rawSubtaskId && UUID_REGEX.test(rawSubtaskId)) {
    const subtask = await prisma.subtask.findUnique({
      where: { id: rawSubtaskId },
      include: {
        task: {
          include: {
            list: { select: { id: true, name: true, space: { select: { id: true, name: true } } } },
            assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
            assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
          }
        },
        User: { select: { id: true, name: true, avatarUrl: true } },
        assignees: { select: { id: true, name: true, avatarUrl: true } },
      }
    });
    if (subtask) {
      return {
        task: subtask.task,
        subtask,
        isSubtask: true,
        taskId: subtask.taskId,
        subtaskId: subtask.id,
      };
    }
  }

  // 2. If rawTaskId is provided:
  if (rawTaskId && UUID_REGEX.test(rawTaskId)) {
    // Check if it's a main task
    const task = await prisma.task.findUnique({
      where: { id: rawTaskId },
      include: {
        list: { select: { id: true, name: true, space: { select: { id: true, name: true } } } },
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
        assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
        subtasks: true,
      }
    });
    if (task) {
      return {
        task,
        subtask: null,
        isSubtask: false,
        taskId: task.id,
        subtaskId: null,
      };
    }

    // Check if rawTaskId is actually a subtask ID
    const subtask = await prisma.subtask.findUnique({
      where: { id: rawTaskId },
      include: {
        task: {
          include: {
            list: { select: { id: true, name: true, space: { select: { id: true, name: true } } } },
            assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
            assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
          }
        },
        User: { select: { id: true, name: true, avatarUrl: true } },
        assignees: { select: { id: true, name: true, avatarUrl: true } },
      }
    });
    if (subtask) {
      return {
        task: subtask.task,
        subtask,
        isSubtask: true,
        taskId: subtask.taskId,
        subtaskId: subtask.id,
      };
    }
  }

  // 3. Fallback: ClickUp link / ID lookup if link or rawTaskId has ClickUp ID
  const cuCandidate = link || rawTaskId;
  if (cuCandidate) {
    const cuId = cuCandidate.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
    if (cuId && /^[a-z0-9]+$/i.test(cuId)) {
      const match = { OR: [{ externalId: cuId }, { externalId: { endsWith: `/${cuId}` } }] };
      const [subtask, task] = await Promise.all([
        prisma.subtask.findFirst({
          where: match,
          include: {
            task: {
              include: {
                list: { select: { id: true, name: true, space: { select: { id: true, name: true } } } },
                assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
                assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
              }
            },
            User: { select: { id: true, name: true, avatarUrl: true } },
            assignees: { select: { id: true, name: true, avatarUrl: true } },
          }
        }),
        prisma.task.findFirst({
          where: match,
          include: {
            list: { select: { id: true, name: true, space: { select: { id: true, name: true } } } },
            assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
            assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
            subtasks: true,
          }
        }),
      ]);
      if (subtask) {
        return {
          task: subtask.task,
          subtask,
          isSubtask: true,
          taskId: subtask.taskId,
          subtaskId: subtask.id,
        };
      }
      if (task) {
        return {
          task,
          subtask: null,
          isSubtask: false,
          taskId: task.id,
          subtaskId: null,
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Auth helper: validates API key and returns the key record (with user)
// ---------------------------------------------------------------------------
async function authenticateApiKey(req: Request, res: Response) {
  const authHeader = req.headers.authorization || req.headers['x-api-key'] as string;
  if (!authHeader) {
    res.status(401).json({ error: 'Missing API Key' });
    return null;
  }

  const token = authHeader.replace('Bearer ', '').trim();

  // VIPScale Tools authenticates every Nexus call (webhooks and this API) with the
  // one shared VIPSCALE_API_KEY secret, acting as the VIPSCALE system user.
  const sharedKey = process.env.VIPSCALE_API_KEY?.trim();
  if (sharedKey && token.length === sharedKey.length && timingSafeEqual(Buffer.from(token), Buffer.from(sharedKey))) {
    const user = await getOrCreateVipScaleUser();
    return { id: null, userId: user.id, user };
  }

  const hashedToken = hashApiKey(token);

  let apiKey = await (prisma as any).apiKey.findUnique({
    where: { key: hashedToken },
    include: { user: true }
  });

  // Backward compatibility & automatic migration:
  // If not found by hash, check if an unhashed legacy key exists
  if (!apiKey) {
    const legacyKey = await (prisma as any).apiKey.findUnique({
      where: { key: token },
      include: { user: true }
    });

    if (legacyKey) {
      // Auto-migrate legacy key to SHA-256 hash immediately
      await (prisma as any).apiKey.update({
        where: { id: legacyKey.id },
        data: { key: hashedToken }
      });
      apiKey = legacyKey;
    }
  }

  if (!apiKey) {
    res.status(401).json({ error: 'Invalid API Key' });
    return null;
  }

  // Track last usage
  await (prisma as any).apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsed: new Date() }
  });

  return apiKey;
}

// ---------------------------------------------------------------------------
// POST /api/external/lists
// Creates a new list (board) with specific statuses
// ---------------------------------------------------------------------------
export async function createExternalList(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { name, spaceId, folderId, statuses, externalId, clickUpListId } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    let targetSpaceId = spaceId;
    let targetFolderId = folderId;
    
    // If user didn't specify a folder ID, fallback to 'Client Dashboard' folder automatically
    if (!targetFolderId) {
      const dashboardFolder = await prisma.folder.findFirst({ where: { name: 'Client Dashboard' } });
      if (dashboardFolder) {
        targetFolderId = dashboardFolder.id;
        targetSpaceId = targetSpaceId || dashboardFolder.spaceId;
      }
    }

    const customGroups = statuses 
      ? Array.from(new Set(statuses.map((s: any) => s.groupName).filter(Boolean))) as string[]
      : ['Client Details', 'Recurring', 'Workflow & Progress'];

    // /webhooks/sync-clients usually creates the client's list moments before this call,
    // so match it by VIPScale client id first, then by name within the folder (ignoring
    // case/whitespace and space), instead of creating a second list next to it.
    let list = externalId
      ? await prisma.list.findUnique({ where: { externalId: String(externalId) } })
      : null;

    if (!list) {
      list = await prisma.list.findFirst({
        where: {
          name: { equals: String(name).trim(), mode: 'insensitive' },
          folderId: targetFolderId || null,
          ...(targetFolderId ? {} : { spaceId: targetSpaceId || null }),
        }
      });
      if (list && externalId && !list.externalId) {
        list = await prisma.list.update({ where: { id: list.id }, data: { externalId: String(externalId) } });
      }
    }

    if (list) {
      // If list already exists, ensure clickUpListId is updated if passed
      if (clickUpListId && !list.clickUpListId) {
        list = await prisma.list.update({ where: { id: list.id }, data: { clickUpListId: String(clickUpListId) } });
      }
      // Return early if the list already exists (to avoid duplicate status seeding).
      // existingTaskTitles lets callers that seed tasks skip the ones already there.
      const existingTasks = await prisma.task.findMany({ where: { listId: list.id }, select: { title: true } });
      return res.status(200).json({ list, created: false, existingTaskTitles: existingTasks.map(t => t.title) });
    }

    list = await prisma.list.create({
      data: {
        name,
        spaceId: targetSpaceId || null,
        folderId: targetFolderId || null,
        externalId: externalId ? String(externalId) : null,
        clickUpListId: clickUpListId ? String(clickUpListId) : null,
        customGroups: ['Client Details', 'Recurring', 'Workflow & Progress', 'Management', 'Closed Task']
      }
    });

    // We will use standard DEFAULT_STATUSES but NEVER rename KYC to list.name
    // (As requested: "instead of names of the boards it should be kyc")
    const DEFAULT_STATUSES = [
      { name: 'KYC', color: '#3A8F55', groupName: 'Client Details' },
      { name: 'PIN BOARD', color: '#1F8A6E', groupName: 'Client Details' },
      { name: 'DAILY', color: '#2F7BD0', groupName: 'Recurring' },
      { name: 'WEEKLY', color: '#2F7BD0', groupName: 'Recurring' },
      { name: 'MONTHLY', color: '#2F7BD0', groupName: 'Recurring' },
      { name: 'PENDING', color: '#D29A2A', groupName: 'Workflow & Progress' },
      { name: 'IN PROGRESS', color: '#D04A7C', groupName: 'Workflow & Progress' },
      { name: 'REVISION', color: '#5B6BD6', groupName: 'Workflow & Progress' },
      { name: 'ON-HOLD', color: '#8A8F98', groupName: 'Workflow & Progress' },
      { name: 'CLOSED', color: '#2FA37A', groupName: 'Closed Task' },
      { name: 'WAITING', color: '#D9534F', groupName: 'Management' },
      { name: 'IN REVIEW', color: '#D97B3A', groupName: 'Management' },
      { name: 'CHECKING', color: '#A35DB8', groupName: 'Management' },
      { name: 'CRM', color: '#22A3AE', groupName: 'Management' },
    ];

    const statusesToCreate: any[] = [];
    if (statuses && Array.isArray(statuses) && statuses.length > 0) {
      // If caller explicitly provides statuses, use them
      statuses.forEach((s, i) => {
        statusesToCreate.push({
          name: s.name,
          color: s.color || 'blue',
          groupName: s.groupName || null,
          order: i,
          listId: list.id
        });
      });
    } else {
      // Use DEFAULT_STATUSES (keep KYC as KYC)
      DEFAULT_STATUSES.forEach((s, i) => {
        statusesToCreate.push({
          name: s.name,
          color: s.color,
          groupName: s.groupName,
          order: i,
          listId: list.id
        });
      });
    }

    if (statusesToCreate.length > 0) {
      await prisma.listStatus.createMany({
        data: statusesToCreate,
        skipDuplicates: true
      });
    }

    await invalidateCache('lists:all', 'spaces:all', 'dashboard:all');

    io.emit('spaces_updated');

    return res.status(201).json({ list, created: true, existingTaskTitles: [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/external/tasks
// Returns tasks with title, status, client (space name), listName, and link
// ---------------------------------------------------------------------------
export async function getTasks(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { status, listId, externalId, title } = req.query;

    // Fast-path: caller wants a single task by its ClickUp URL (externalId) or exact title
    // Returns the same shape as the list response so callers can handle both uniformly.
    if (externalId || title) {
      const findWhere: any = {};
      if (externalId && title) {
        findWhere.OR = [
          { externalId: { contains: String(externalId) } },
          { title: { contains: String(title), mode: 'insensitive' } }
        ];
      } else {
        if (externalId) findWhere.externalId = { contains: String(externalId) };
        if (title) findWhere.title = { contains: String(title), mode: 'insensitive' };
      }

      const task = await prisma.task.findFirst({
        where: findWhere,
        select: {
          id: true,
          title: true,
          status: true,
          listId: true,
          externalId: true,
          createdAt: true,
          updatedAt: true,
          list: {
            select: {
              name: true,
              space: { select: { name: true } }
            }
          }
        },
        orderBy: { updatedAt: 'desc' } // if multiple matches, get the most recently updated
      });

      if (!task) return res.json({ tasks: [] });

      return res.json({
        tasks: [{
          id: task.id,
          title: task.title,
          status: task.status,
          externalId: task.externalId,
          client: task.list?.space?.name || 'Unknown Client',
          listName: task.list?.name || 'Unknown List',
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          link: `${process.env.FRONTEND_URL || 'https://nexus.vipscaleph.com'}/lists/${task.listId}?task=${task.id}`
        }]
      });
    }

    const where: any = {};
    if (status) where.status = String(status);
    if (listId) where.listId = String(listId);

    const tasks = await prisma.task.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        listId: true,
        createdAt: true,
        updatedAt: true,
        list: {
          select: {
            name: true,
            space: {
              select: { name: true }
            }
          }
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: 50
    });

    const formattedTasks = tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      client: task.list?.space?.name || 'Unknown Client',
      listName: task.list?.name || 'Unknown List',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      link: `${process.env.FRONTEND_URL || 'https://nexus.vipscaleph.com'}/lists/${task.listId}?task=${task.id}`
    }));

    return res.json({ tasks: formattedTasks });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/external/tasks/:taskId
// Returns full details of a specific task
// ---------------------------------------------------------------------------
export async function getTask(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { taskId } = req.params;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        list: { select: { name: true, space: { select: { name: true } } } },
        assignee: { select: { id: true, name: true, email: true } },
        subtasks: true,
        comments: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (task) {
      return res.json({ task, isSubtask: false });
    }

    // Check if taskId is a subtask
    const subtask = await prisma.subtask.findUnique({
      where: { id: taskId },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            listId: true,
            list: { select: { name: true, space: { select: { name: true } } } }
          }
        },
        User: { select: { id: true, name: true, email: true } },
        comments: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (subtask) {
      const formattedSubtask = {
        id: subtask.id,
        title: subtask.title,
        description: subtask.description,
        status: subtask.status,
        completed: subtask.completed,
        priority: subtask.priority,
        dueDate: subtask.dueDate,
        parentTaskId: subtask.taskId,
        listId: subtask.task?.listId,
        list: subtask.task?.list,
        assignee: subtask.User,
        comments: subtask.comments,
        createdAt: subtask.createdAt,
        updatedAt: (subtask as any).updatedAt ?? subtask.createdAt,
      };
      return res.json({ task: formattedSubtask, isSubtask: true });
    }

    return res.status(404).json({ error: 'Task not found' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/external/tasks
// Creates a new task
// Body: title (required), listId (required), description, priority, status
// ---------------------------------------------------------------------------
export async function createTask(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { title, listId, description, priority, status, assigneeId, checklists, externalId } = req.body;

    if (!title || !listId) {
      return res.status(400).json({ error: 'title and listId are required' });
    }

    const list = await prisma.list.findUnique({ where: { id: listId }, include: { statuses: true } });
    if (!list) return res.status(404).json({ error: 'List not found' });

    // Skip auto-seeding if statuses already exist to prevent duplicating/messing up createExternalList statuses
    if (list.statuses.length === 0) {
      const defaultGroupedStatuses = [
        { name: 'KYC', color: '#3A8F55', groupName: 'Client Details', order: 0 },
        { name: 'PIN BOARD', color: '#1F8A6E', groupName: 'Client Details', order: 1 },
        { name: 'DAILY', color: '#2F7BD0', groupName: 'Recurring', order: 0 },
        { name: 'WEEKLY', color: '#2F7BD0', groupName: 'Recurring', order: 1 },
        { name: 'MONTHLY', color: '#2F7BD0', groupName: 'Recurring', order: 2 },
        { name: 'PENDING', color: '#D29A2A', groupName: 'Workflow & Progress', order: 0 },
        { name: 'IN PROGRESS', color: '#D04A7C', groupName: 'Workflow & Progress', order: 1 },
        { name: 'REVISION', color: '#5B6BD6', groupName: 'Workflow & Progress', order: 2 },
        { name: 'ON-HOLD', color: '#8A8F98', groupName: 'Workflow & Progress', order: 3 },
        { name: 'CLOSED', color: '#2FA37A', groupName: 'Closed Task', order: 4 },
        { name: 'WAITING', color: '#D9534F', groupName: 'Management', order: 0 },
        { name: 'IN REVIEW', color: '#D97B3A', groupName: 'Management', order: 1 },
        { name: 'CHECKING', color: '#A35DB8', groupName: 'Management', order: 2 },
        { name: 'CRM', color: '#22A3AE', groupName: 'Management', order: 3 },
      ];

      await prisma.list.update({
        where: { id: list.id },
        data: {
          customGroups: ['Client Details', 'Recurring', 'Workflow & Progress', 'Management', 'Closed Task']
        }
      });

      for (const st of defaultGroupedStatuses) {
        if (!list.statuses.some(existing => existing.name.toUpperCase() === st.name.toUpperCase())) {
          await prisma.listStatus.create({
            data: {
              name: st.name,
              color: st.color,
              groupName: st.groupName,
              order: st.order,
              listId: list.id
            }
          });
        }
      }
    }

    const vipScaleUser = await getOrCreateVipScaleUser();

    const task = await prisma.task.create({
      data: {
        title,
        listId,
        description: description || '',
        priority: priority || 'MEDIUM',
        status: status || 'PENDING',
        creatorId: vipScaleUser.id,
        assigneeId: assigneeId || undefined,
        externalId: externalId ? String(externalId) : undefined,
      }
    });

    let finalChecklists = checklists && Array.isArray(checklists) ? [...checklists] : [];
    
    // Auto-inject Instructions Audit to satisfy getRequiredAudits for external tasks
    if (!req.body.skipAutoAudit) {
      let auditChecklist = finalChecklists.find(c => c.name && c.name.toLowerCase().includes('audit'));
      if (!auditChecklist) {
        auditChecklist = { name: 'Task Audit', items: [] };
        finalChecklists.push(auditChecklist);
      }
      if (!auditChecklist.items) auditChecklist.items = [];
      if (!auditChecklist.items.includes('Instructions Audit')) {
        auditChecklist.items.push('Instructions Audit');
      }
    }

    for (const cl of finalChecklists) {
      const checklist = await prisma.checklist.create({
        data: {
          name: cl.name,
          taskId: task.id
        }
      });
      if (cl.items && Array.isArray(cl.items)) {
        await prisma.checklistItem.createMany({
          data: cl.items.map((itemText: string) => ({
            text: itemText,
            completed: false,
            checklistId: checklist.id
          }))
        });
      }
    }

    try {
      const doc = await prisma.doc.findFirst({ where: { isDailyRollover: true } });
      if (doc) {
        const tz = (doc as any).rolloverTimezone || 'Asia/Singapore';
        const dayFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });
        const dayTitle = dayFormatter.format(new Date());

        const todayPage = await prisma.page.findFirst({
          where: { 
            docId: doc.id, 
            title: dayTitle 
          },
          orderBy: { createdAt: 'desc' }
        });

        if (todayPage && todayPage.content) {
          const clientName = list.name || 'Unknown Client';
          const taskBlock = {
            id: `blk-t-${Date.now()}-${task.id}`,
            type: "text",
            content: `<p><span data-type="mention" data-id="${task.id}" data-label="${task.title}" data-mention-type="task" data-task-list-name="${clientName}">@${task.title}</span> ${NEW_TASK_BADGE}</p>`
          };

          const written = await updatePageBlocks(todayPage, (blocks) => {
            appendTaskToJournal(blocks, clientName, taskBlock);
          });

          if (written) io.to(`doc:${doc.id}`).emit('page_updated', { docId: doc.id, pageId: todayPage.id });
        }
      }
    } catch (error) {
      console.error('Failed to inject task into Priorities Journal:', error);
    }

    // --- ClickUp Sync: fallback if externalId was not pre-created ---
    if (!externalId) {
      (async () => {
        try {
          const clickUpListId = resolveClickUpListId(list);
          if (clickUpListId) {
            const cuPayload = {
              name: task.title,
              description: task.description || undefined,
              status: mapNexusStatusToClickUp(task.status),
              priority: mapNexusPriorityToClickUp(task.priority),
            };
            const clickUpTaskId = await safeCreateClickUpTask(clickUpListId, cuPayload);
            if (clickUpTaskId) {
              await prisma.task.update({
                where: { id: task.id },
                data: { externalId: clickUpTaskId },
              });

              for (const cl of finalChecklists) {
                const cuChecklistId = await safeCreateClickUpChecklist(clickUpTaskId, cl.name);
                if (cuChecklistId && cl.items && Array.isArray(cl.items)) {
                  for (const itemText of cl.items) {
                    await safeCreateClickUpChecklistItem(cuChecklistId, itemText);
                  }
                }
              }
            }
          }
        } catch (cuErr) {
          console.error('[ClickUp] external createTask fallback sync error:', cuErr);
        }
      })();
    }

    // --- REALTIME WEBSOCKET AND CACHE INVALIDATION ---
    // Emit task:created so KanbanBoard live-updates without refresh!
    io.emit('task:created', task); // Global broadcast reaches list-room members too
    
    // Invalidate Redis caches so manual refresh shows the new tasks
    await invalidateCache('lists:all', 'dashboard:all');

    return res.status(201).json({ message: 'Task created successfully', task });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/external/tasks/:taskId
// Updates task fields (title, description, status, priority, assigneeId)
// ---------------------------------------------------------------------------
export async function updateTask(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { taskId } = req.params;
    const { title, description, status, priority, assigneeId, completed } = req.body;

    const target = await resolveTargetTaskAndSubtask(taskId);
    if (!target) return res.status(404).json({ error: 'Task not found' });

    // Handle subtask update if taskId resolved to a subtask
    if (target.isSubtask && target.subtask) {
      const existingSubtask = target.subtask;
      const normalizedStatus = status !== undefined ? String(status).toUpperCase() : undefined;
      const isCompleted = completed !== undefined 
        ? Boolean(completed) 
        : normalizedStatus !== undefined 
          ? ['CLOSED', 'COMPLETED', 'COMPLETE', 'DONE'].includes(normalizedStatus)
          : undefined;

      const updatedSub = await prisma.subtask.update({
        where: { id: existingSubtask.id },
        data: {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(normalizedStatus !== undefined && { status: normalizedStatus }),
          ...(priority !== undefined && { priority }),
          ...(assigneeId !== undefined && { assigneeId }),
          ...(isCompleted !== undefined && { completed: isCompleted }),
        },
        include: {
          User: { select: { id: true, name: true, email: true, avatarUrl: true } },
          assignees: { select: { id: true, name: true, email: true, avatarUrl: true } },
        }
      });

      // Audit log & activity feed when subtask status changed
      if (normalizedStatus !== undefined && normalizedStatus !== existingSubtask.status) {
        try {
          const actor = apiKey.user || await getOrCreateVipScaleUser();
          const authorName = 'VIPScale';
          const log = await prisma.auditLog.create({
            data: {
              action: 'STATUS_CHANGE',
              entity: 'TASK',
              entityId: target.taskId,
              userId: actor.id,
              details: { oldStatus: existingSubtask.status, newStatus: normalizedStatus, subtaskTitle: updatedSub.title, source: 'external' },
            }
          });
          const activity = {
            id: log.id,
            type: 'status_change',
            author: authorName,
            oldStatus: existingSubtask.status,
            newStatus: normalizedStatus,
            subtaskTitle: updatedSub.title,
            subtaskId: updatedSub.id,
            date: log.createdAt,
            user: { ...actor, name: authorName },
          };
          io.emit('task_activity', { listId: target.task?.listId, taskId: target.taskId, activity });
          if (target.task?.listId) {
            io.to(`list:${target.task.listId}`).emit('task_activity', { listId: target.task.listId, taskId: target.taskId, activity });
          }
        } catch (actErr) {
          console.error('[external.updateTask] subtask activity log error:', actErr);
        }
      }

      io.emit('subtask_updated', { taskId: target.taskId, subtask: updatedSub });
      const fullParent = await prisma.task.findUnique({
        where: { id: target.taskId },
        include: {
          assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
          assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
          subtasks: {
            include: {
              User: { select: { id: true, name: true, avatarUrl: true } },
              assignees: { select: { id: true, name: true, avatarUrl: true } },
            }
          }
        }
      });
      if (fullParent) {
        io.emit('task:updated', fullParent);
        if (fullParent.listId) {
          io.to(`list:${fullParent.listId}`).emit('task:updated', fullParent);
        }
      }

      invalidateCache(
        `task:${target.taskId}`,
        `task:${updatedSub.id}`,
        `task:activities:${target.taskId}`,
        'tasks:all',
        'lists:all',
        'dashboard:all',
        'spaces:all'
      ).catch(() => {});

      return res.json({ message: 'Subtask updated successfully', task: updatedSub, isSubtask: true });
    }

    // Main task update
    const existingTask = target.task;
    const task = await prisma.task.update({
      where: { id: target.taskId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(priority !== undefined && { priority }),
        ...(assigneeId !== undefined && { assigneeId }),
      },
      include: {
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
        assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
      }
    });

    // Cascade main task status to all child subtasks
    if (status !== undefined) {
      const normalizedStatus = String(status).toUpperCase();
      const isDoneStatus = ['CLOSED', 'COMPLETED', 'COMPLETE', 'DONE'].includes(normalizedStatus);
      await prisma.subtask.updateMany({
        where: { taskId: task.id },
        data: {
          status: normalizedStatus,
          completed: isDoneStatus,
        }
      });
    }

    // Re-fetch populated task with updated subtasks for broadcast
    const updatedFullTask = await prisma.task.findUnique({
      where: { id: task.id },
      include: {
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
        assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
        subtasks: {
          include: {
            User: { select: { id: true, name: true, avatarUrl: true } },
            assignees: { select: { id: true, name: true, avatarUrl: true } },
          }
        }
      }
    });

    const broadcastPayload = updatedFullTask || task;
    io.emit('task:updated', broadcastPayload);
    if (task.listId) {
      io.to(`list:${task.listId}`).emit('task:updated', broadcastPayload);
    }

    // Invalidate Redis caches so fetch/refresh queries reflect the updated task
    invalidateCache(
      `task:${task.id}`,
      `task:activities:${task.id}`,
      'tasks:all',
      'lists:all',
      'dashboard:all',
      'spaces:all'
    ).catch(() => {});

    // Audit log & activity feed broadcast when status changed
    if (status !== undefined && status !== existingTask.status) {
      try {
        const actor = apiKey.user || await getOrCreateVipScaleUser();
        const authorName = 'VIPScale';
        const log = await prisma.auditLog.create({
          data: {
            action: 'STATUS_CHANGE',
            entity: 'TASK',
            entityId: task.id,
            userId: actor.id,
            details: { oldStatus: existingTask.status, newStatus: status, source: 'external' },
          }
        });
        const activity = {
          id: log.id,
          type: 'status_change',
          author: authorName,
          oldStatus: existingTask.status,
          newStatus: status,
          date: log.createdAt,
          user: { ...actor, name: authorName },
        };
        io.emit('task_activity', { listId: task.listId, taskId: task.id, activity });
        if (task.listId) {
          io.to(`list:${task.listId}`).emit('task_activity', { listId: task.listId, taskId: task.id, activity });
        }

        // Send task notifications to relevant workspace users (assignees, auditors, PMs)
        const rawUsersToNotify = await getStatusChangeRecipients(
          status,
          { ...task, teamId: task.teamId },
          actor.id
        );
        const usersToNotify = await filterUsersByNotificationPreference(rawUsersToNotify, 'status');
        if (usersToNotify.length > 0) {
          await prisma.taskNotification.createMany({
            data: usersToNotify.map((id: any) => ({
              userId: id,
              actorId: actor.id,
              taskId: task.id,
              type: 'STATUS_CHANGE',
              title: `${authorName} changed status from ${existingTask.status} to ${status} on task ${task.title}`,
            })),
          });
          usersToNotify.forEach((id: any) => {
            io.to(`user:${id}`).emit('notification_received');
          });
        }

        await invalidateCache(`task:activities:${task.id}`);
      } catch (activityErr) {
        console.error('[external.updateTask] activity log error:', activityErr);
      }
    }

    if (status && status !== existingTask.status && status.toLowerCase() !== 'closed') {
      try {
        const doc = await prisma.doc.findFirst({ where: { isDailyRollover: true } });
        if (doc) {
          const tz = (doc as any).rolloverTimezone || 'Asia/Singapore';
          const dayFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          });
          const dayTitle = dayFormatter.format(new Date());

          const todayPage = await prisma.page.findFirst({
            where: { 
              docId: doc.id, 
              title: dayTitle 
            },
            orderBy: { createdAt: 'desc' }
          });

          if (todayPage && todayPage.content) {
            const taskMention = `data-id="${task.id}"`;
            const clientName = existingTask.list?.name || 'Unknown Client';
            // Re-opened, not new: no NEW TASK ADDED badge
            const taskBlock = {
              id: `blk-t-${Date.now()}-${task.id}`,
              type: "text",
              content: `<p><span data-type="mention" data-id="${task.id}" data-label="${task.title}" data-mention-type="task" data-task-list-name="${clientName}">@${task.title}</span></p>`
            };

            const written = await updatePageBlocks(todayPage, (blocks) => {
              const isAlreadyInJournal = blocks.some((b: any) => b.type === 'text' && b.content.includes(taskMention));
              if (isAlreadyInJournal) return false;
              appendTaskToJournal(blocks, clientName, taskBlock);
            });

            if (written) io.to(`doc:${doc.id}`).emit('page_updated', { docId: doc.id, pageId: todayPage.id });
          }
        }
      } catch (error) {
        console.error('Failed to inject re-opened task into Priorities Journal:', error);
      }
    }

    return res.json({ message: 'Task updated successfully', task: broadcastPayload, isSubtask: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}


// ---------------------------------------------------------------------------
// POST /api/external/activity
// Logs an audit entry against a task or subtask (shows in the activity feed)
// ---------------------------------------------------------------------------
export async function postActivity(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { taskId, action, details, subtaskId, task_link } = req.body;

    if (!taskId && !subtaskId && !task_link) {
      return res.status(400).json({ error: 'taskId, subtaskId, or task_link is required' });
    }
    if (!action) {
      return res.status(400).json({ error: 'action is required' });
    }

    const target = await resolveTargetTaskAndSubtask(taskId, subtaskId, task_link);
    if (!target) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const auditLog = await prisma.auditLog.create({
      data: {
        action,
        entity: 'TASK',
        entityId: target.taskId,
        userId: apiKey.userId,
        details: {
          ...(details || {}),
          ...(target.isSubtask && target.subtaskId && { subtaskId: target.subtaskId, subtaskTitle: target.subtask?.title }),
        }
      }
    });

    return res.json({ message: 'Activity logged successfully', auditLog });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/external/comment
// Posts a formatted comment to a task or subtask — shows up in the task modal Comments
// section exactly like a regular user comment (with avatar, reactions, reply).
//
// Body:
//   taskId    (string, optional) — ID of the target task or subtask
//   subtaskId (string, optional) — Explicit subtask ID
//   task_link (string, optional) — Nexus task link or ClickUp link
//   content   (string, required) — Markdown-formatted comment body
//
// Tip: format your spreadsheet columns as markdown and pass as `content`.
// The comment will appear under the API key owner's account.
// ---------------------------------------------------------------------------
// Pending/recent external comment inserts keyed by owner+task+content, used to collapse duplicate requests
const inFlightExternalComments = new Map<string, Promise<any>>();

export async function postComment(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { taskId, subtaskId, task_link, content } = req.body;

    if ((!taskId && !subtaskId && !task_link) || !content) {
      return res.status(400).json({ error: 'taskId (or subtaskId / task_link) and content are required' });
    }

    const target = await resolveTargetTaskAndSubtask(taskId, subtaskId, task_link);
    if (!target) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const finalTaskId = target.taskId;
    const finalSubtaskId = target.subtaskId || null;

    // Integrations sometimes fire the same request twice (~10ms apart). Concurrent duplicates share
    // the first request's insert; later ones within 10s are caught by the DB lookup below.
    const dedupeKey = `${apiKey.userId}:${finalTaskId}:${finalSubtaskId || 'main'}:${content}`;
    const inFlight = inFlightExternalComments.get(dedupeKey);
    if (inFlight) {
      const existing = await inFlight;
      return res.json({ message: 'Comment posted successfully', comment: existing, deduplicated: true });
    }

    const createPromise = (async () => {
      const duplicate = await prisma.taskComment.findFirst({
        where: {
          taskId: finalTaskId,
          subtaskId: finalSubtaskId,
          userId: apiKey.userId,
          content,
          createdAt: { gte: new Date(Date.now() - 10_000) },
        },
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } }
        }
      });
      if (duplicate) return { comment: duplicate, created: false };

      // Create the comment as the API key owner
      const created = await prisma.taskComment.create({
        data: {
          content,
          taskId: finalTaskId,
          subtaskId: finalSubtaskId,
          userId: apiKey.userId,
        },
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } }
        }
      });
      return { comment: created, created: true };
    })();
    const sharedComment = createPromise.then(r => r.comment);
    sharedComment.catch(() => {}); // avoid an unhandled rejection when no duplicate is waiting on it
    inFlightExternalComments.set(dedupeKey, sharedComment);
    let result: { comment: any; created: boolean };
    try {
      result = await createPromise;
    } finally {
      setTimeout(() => inFlightExternalComments.delete(dedupeKey), 10_000);
    }

    const comment = result.comment;
    if (!result.created) {
      return res.json({ message: 'Comment posted successfully', comment, deduplicated: true });
    }

    // Invalidate Redis comment caches and task caches
    await invalidateCache(`task:${finalTaskId}`, ...(finalSubtaskId ? [`task:${finalSubtaskId}`] : []));
    await dropCommentCache(finalTaskId, finalSubtaskId);

    // Realtime update for the frontend
    io.emit('task:comment_added', { taskId: finalTaskId, subtaskId: finalSubtaskId, comment });

    return res.json({
      message: 'Comment posted successfully',
      comment
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/external/comment
// Updates an existing comment.
//
// Body:
//   commentId (string, required)
//   content   (string, required)
//   taskId    (string, optional)
//   subtaskId (string, optional)
// ---------------------------------------------------------------------------
export async function updateComment(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { commentId, content, taskId, subtaskId } = req.body;

    if (!commentId || !content) {
      return res.status(400).json({ error: 'commentId and content are required' });
    }

    const existingComment = await prisma.taskComment.findUnique({
      where: { id: commentId }
    });

    if (!existingComment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Self-healing: if the client provided a taskId or subtaskId, allow matching either
    if (taskId && existingComment.taskId !== taskId && existingComment.subtaskId !== taskId) {
      return res.status(400).json({ error: 'Task mismatch - comment belongs to a different task' });
    }
    if (subtaskId && existingComment.subtaskId !== subtaskId) {
      return res.status(400).json({ error: 'Subtask mismatch - comment belongs to a different subtask' });
    }

    // Only allow the API key owner to update their own comments
    if (existingComment.userId !== apiKey.userId) {
      return res.status(403).json({ error: 'You do not have permission to update this comment' });
    }

    const updatedComment = await prisma.taskComment.update({
      where: { id: commentId },
      data: { content },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } }
      }
    });

    await invalidateCache(`task:${existingComment.taskId}`, ...(existingComment.subtaskId ? [`task:${existingComment.subtaskId}`] : []));
    await dropCommentCache(existingComment.taskId, existingComment.subtaskId);

    io.emit('task:comment_updated', {
      taskId: existingComment.taskId,
      subtaskId: existingComment.subtaskId,
      comment: updatedComment
    });

    return res.json({
      message: 'Comment updated successfully',
      comment: updatedComment
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/external/comment/:commentId
// Deletes an existing comment.
// ---------------------------------------------------------------------------
export async function deleteComment(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { commentId } = req.params;

    const existingComment = await prisma.taskComment.findUnique({
      where: { id: commentId }
    });

    if (!existingComment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (existingComment.userId !== apiKey.userId) {
      return res.status(403).json({ error: 'You do not have permission to delete this comment' });
    }

    await prisma.taskComment.delete({
      where: { id: commentId }
    });

    // If this was a reply, decrement parent replyCount
    if (existingComment.parentCommentId) {
      await prisma.taskComment.update({
        where: { id: existingComment.parentCommentId },
        data: { replyCount: { decrement: 1 } },
      }).catch(() => {});
    }

    // Clean up associated TaskNotification and AuditLog records
    try {
      const preview = toNotificationPreview(existingComment.content);
      const matchingNotifs = await prisma.taskNotification.findMany({
        where: {
          taskId: existingComment.taskId,
          actorId: existingComment.userId,
          type: { in: ['MENTION', 'COMMENT'] },
          content: preview,
        },
        select: { id: true, userId: true },
      });

      if (matchingNotifs.length > 0) {
        await prisma.taskNotification.deleteMany({
          where: { id: { in: matchingNotifs.map(n => n.id) } },
        });
        matchingNotifs.forEach(n => {
          io.to(`user:${n.userId}`).emit('notification_received');
        });
      }

      await prisma.auditLog.deleteMany({
        where: {
          entityId: existingComment.taskId,
          action: { in: ['COMMENT', 'REPLY'] },
          details: { path: ['commentId'], equals: commentId },
        },
      }).catch(() => {});
    } catch (cleanErr) {
      console.error('[external:deleteComment] Cleanup error:', cleanErr);
    }

    await invalidateCache(`task:${existingComment.taskId}`, ...(existingComment.subtaskId ? [`task:${existingComment.subtaskId}`] : []));
    await dropCommentCache(existingComment.taskId, existingComment.subtaskId);

    io.emit('task:comment_deleted', {
      taskId: existingComment.taskId,
      subtaskId: existingComment.subtaskId,
      commentId
    });

    return res.json({ message: 'Comment deleted successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/external/tasks/:taskId/subtasks
// Creates a new subtask
// Body: title (required), description, priority, assigneeId
// ---------------------------------------------------------------------------
export async function createSubtask(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { taskId } = req.params;
    const { title, description, priority, assigneeId } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const subtask = await prisma.subtask.create({
      data: {
        title,
        taskId,
        description: description || '',
        priority: priority || 'MEDIUM',
        assigneeId: assigneeId || undefined,
      }
    });

    injectSubtaskIntoJournal(task.id, { id: subtask.id, title: subtask.title }).catch((error) => {
      console.error('Failed to inject subtask into Priorities Journal:', error);
    });

    return res.status(201).json({ message: 'Subtask created successfully', subtask });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/external/tasks/:taskId/subtasks/:subtaskId
// Updates subtask fields (title, description, completed, priority, assigneeId)
// ---------------------------------------------------------------------------
export async function updateSubtask(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { taskId, subtaskId } = req.params;
    const { title, description, completed, priority, assigneeId } = req.body;

    const subtask = await prisma.subtask.findFirst({
      where: { id: subtaskId, taskId }
    });

    if (!subtask) return res.status(404).json({ error: 'Subtask not found' });

    const updated = await prisma.subtask.update({
      where: { id: subtaskId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(completed !== undefined && { completed }),
        ...(priority !== undefined && { priority }),
        ...(assigneeId !== undefined && { assigneeId }),
      }
    });

    return res.json({ message: 'Subtask updated successfully', subtask: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/external/assignable-groups
// Returns all users, roles, teamroles, and teams for VIPScale assignee dropdowns
// ---------------------------------------------------------------------------
export async function getAssignableGroups(req: Request, res: Response) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        roles: true,
        team: { select: { id: true } }
      }
    });

    const teams = await prisma.team.findMany({
      select: {
        id: true,
        name: true,
        teamRoles: { select: { id: true, name: true } }
      }
    });

    // Map generic roles (TECH, PM, AUDITOR...) to their users
    const roleUsersMap = new Map<string, string[]>();
    users.forEach(u => {
      const addRole = (role?: string | null) => {
        if (role) {
          if (!roleUsersMap.has(role)) roleUsersMap.set(role, []);
          roleUsersMap.get(role)!.push(u.id);
        }
      };
      u.roles.forEach(addRole);
    });

    const options = [
      // Generic roles derived from user.roles (TECH, PM, AUDITOR...)
      ...Array.from(roleUsersMap.entries()).map(([role, userIds]) => ({
        id: `role_${role}`,
        name: role,
        type: 'role',
        userIds
      })),
      // Specific TeamRoles (Funnel Auditor, Design Auditor, UI UX Auditor...)
      ...teams.flatMap(t =>
        (t.teamRoles || []).map(tr => ({
          id: `teamrole_${tr.id}`,
          name: tr.name,
          type: 'teamrole',
          teamId: t.id,
          teamName: t.name,
          // Users in this team are the pool for this role
          userIds: users.filter(u => u.team?.id === t.id).map(u => u.id)
        }))
      ),
      // Teams
      ...teams.map(t => {
        const teamUsers = users.filter(u => u.team?.id === t.id).map(u => u.id);
        return {
          id: `team_${t.id}`,
          name: t.name,
          type: 'team',
          userIds: teamUsers
        };
      }),
      // Individual users
      ...users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        type: 'user'
      }))
    ];

    return res.json({ success: true, options });
  } catch (err: any) {
    console.error("Error in getAssignableGroups:", err);
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/external/roles
// Returns all workspace roles
// ---------------------------------------------------------------------------
export async function getRoles(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const [workspaceRoles, teamRoles] = await Promise.all([
      prisma.workspaceRole.findMany({ orderBy: { createdAt: 'asc' } }),
      (prisma as any).teamRole.findMany({
        orderBy: { createdAt: 'asc' },
        include: { team: { select: { id: true, name: true } } },
      }),
    ]);

    // Merge: workspace roles first, then team-specific roles
    const merged = [
      ...workspaceRoles.map((r: any) => ({
        id: r.id,
        name: r.name,
        color: r.color || null,
        type: 'workspace',
      })),
      ...teamRoles.map((r: any) => ({
        id: r.id,
        name: r.name,
        color: null,
        type: 'teamrole',
        teamId: r.teamId,
        teamName: r.team?.name || null,
      })),
    ];

    res.json(merged);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/external/roles
// Creates a new workspace role
// ---------------------------------------------------------------------------
export async function createRole(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { name, color } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Role name is required' });
    }

    const role = await prisma.workspaceRole.create({
      data: {
        name: name.toUpperCase(),
        color,
      },
    });

    res.status(201).json(role);
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'Role already exists' });
    }
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/external/roles/:id
// Updates a workspace role
// ---------------------------------------------------------------------------
export async function updateRole(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { id } = req.params;
    const { name, color } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Role name is required' });
    }

    const updatedRole = await prisma.workspaceRole.update({
      where: { id },
      data: {
        name: name.toUpperCase(),
        color,
      },
    });

    res.json(updatedRole);
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'Role name already exists' });
    }
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/external/roles/:id
// Deletes a workspace role
// ---------------------------------------------------------------------------
export async function deleteRole(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { id } = req.params;
    
    await prisma.workspaceRole.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// External Users Management
// ---------------------------------------------------------------------------
export async function getExternalUsers(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        dailySheetUrl: true,
        starRating: true,
        employmentType: true,
        isActive: true,
        systemRole: true,
        roles: true,
      },
      orderBy: { name: 'asc' },
    });

    return res.json({ users });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteExternalUser(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { id } = req.params;
    
    // Prevent deletion of VIPSCALE API user or own user
    if (apiKey.userId === id) {
      return res.status(400).json({ error: 'Cannot delete your own account via API' });
    }

    await prisma.user.delete({ where: { id } });
    return res.json({ message: 'User deleted successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateExternalUserRoles(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { id } = req.params;
    const { roles, systemRole, employmentType, starRating, isActive } = req.body;

    const dataToUpdate: any = {};
    if (roles && Array.isArray(roles)) dataToUpdate.roles = roles;
    if (systemRole) dataToUpdate.systemRole = systemRole;
    if (employmentType) dataToUpdate.employmentType = employmentType;
    if (starRating !== undefined) dataToUpdate.starRating = starRating;
    if (isActive !== undefined) dataToUpdate.isActive = isActive;

    const updatedUser = await prisma.user.update({
      where: { id },
      data: dataToUpdate,
      select: {
        id: true,
        name: true,
        email: true,
        roles: true,
        systemRole: true,
        employmentType: true,
        starRating: true,
        isActive: true,
      }
    });

    return res.json({ user: updatedUser });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// External Invitations Management
// ---------------------------------------------------------------------------
export async function getExternalInvitations(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const invitations = await prisma.invitation.findMany({
      orderBy: { createdAt: 'desc' }
    });

    return res.json({ invitations });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createExternalInvitation(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { email, role, employmentType, expiresInDays } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (expiresInDays || 7));

    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const invite = await prisma.invitation.create({
      data: {
        email: email.trim().toLowerCase(),
        token,
        role: role || 'MEMBER',
        employmentType: employmentType || 'FULL_TIME',
        status: 'PENDING',
        expiresAt,
        invitedById: apiKey.userId
      }
    });

    return res.status(201).json({ invitation: invite });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function revokeExternalInvitation(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { id } = req.params;
    await prisma.invitation.delete({ where: { id } });
    return res.json({ message: 'Invitation revoked' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function resendExternalInvitation(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { id } = req.params;
    const invite = await prisma.invitation.findUnique({ where: { id } });
    if (!invite) return res.status(404).json({ error: 'Not found' });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const updated = await prisma.invitation.update({
      where: { id },
      data: { status: 'PENDING', expiresAt }
    });

    return res.json({ message: 'Invitation resent', invitation: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// External Teams & Roles Management
// ---------------------------------------------------------------------------
export async function getExternalTeams(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const teams = await prisma.team.findMany({
      include: { teamRoles: true },
      orderBy: { name: 'asc' },
    });

    return res.json({ teams });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createExternalTeam(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name is required' });

    const team = await prisma.team.create({
      data: { name },
      include: { teamRoles: true },
    });

    return res.status(201).json({ team });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createExternalTeamRole(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { teamId } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Role name is required' });

    const role = await (prisma as any).teamRole.create({
      data: { name, teamId },
    });

    return res.status(201).json({ role });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/external/assistants/last-tasks
// Returns last 3 tasks per MA assistant with client, task title, link, status, and clean update
// ---------------------------------------------------------------------------
const NEXUS_STATUS_HEX: Record<string, string> = {
  'KYC': '#3A8F55',
  'PIN BOARD': '#1F8A6E',
  'DAILY': '#2F7BD0',
  'WEEKLY': '#2F7BD0',
  'MONTHLY': '#2F7BD0',
  'PENDING': '#D29A2A',
  'IN PROGRESS': '#D04A7C',
  'REVISION': '#5B6BD6',
  'WAITING': '#D9534F',
  'IN REVIEW': '#D97B3A',
  'CHECKING': '#A35DB8',
  'CRM': '#22A3AE',
  'CLOSED': '#2FA37A',
  'ON-HOLD': '#8A8F98',
};

function parseCommentProgress(html: string) {
  const text = (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();

  let actionDone = '';
  let nextSteps = '';
  let statusText = '';
  let timeStarted: string | null = null;
  let timeEnded: string | null = null;
  let timeRange: string | null = null;
  let startRaw: string | null = null;
  let endRaw: string | null = null;

  // Match sentence format: 👤 Name | 📅 Start Time | ✏️ End Time
  const timeSentenceMatch = text.match(/(?:📅|Date:?)\s*([^|✏️\n]+?)\s*\|\s*(?:✏️|End:?)\s*([^\n\r]+)/i);
  if (timeSentenceMatch) {
    startRaw = timeSentenceMatch[1].trim();
    endRaw = timeSentenceMatch[2].trim();
    const sMatch = startRaw.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    const eMatch = endRaw.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    timeStarted = sMatch ? sMatch[1] : startRaw;
    timeEnded = eMatch ? eMatch[1] : endRaw;
    if (timeStarted && timeEnded) {
      timeRange = `${timeStarted} - ${timeEnded}`;
    } else {
      timeRange = timeStarted || timeEnded || null;
    }
  }

  // Remove header line (👤 ... | 📅 ... | ✏️ ...) from text body if present
  const textWithoutHeader = text.replace(/^[^\n]*?(?:📅|✏️)[^\n]*?(?:\n+|$)/i, '').trim();

  const actionMatch = textWithoutHeader.match(/(?:✅|📍)?\s*(?:Action(?:[\s/]*s)?\s*done(?:\s*and\s*Updates)?|Action\s*Done):\s*([\s\S]*?)(?=(?:🔄|💻|♡₊˚)?\s*Status:|(?:📋|⏭️|🚧|♡₊˚)?\s*(?:To Do|In progress|Next Steps)|\n\n\n|$)/i);
  if (actionMatch) {
    actionDone = actionMatch[1].trim();
  }

  const statusMatch = textWithoutHeader.match(/(?:🔄|💻|♡₊˚)?\s*Status(?:\s*┊➤)?:\s*([\s\S]*?)(?=(?:📋|⏭️|🚧|♡₊˚|📍|✅)?\s*(?:To Do|Action|Next Steps|Resources)|\n\n|$)/i);
  if (statusMatch) {
    statusText = statusMatch[1].trim();
  }

  const nextStepsMatch = textWithoutHeader.match(/(?:📋|⏭️|♡₊˚)?\s*(?:To Do\s*\/?\s*Next Steps|Next Steps|Still To Do)(?:\s*┊➤)?:\s*([\s\S]*?)(?=(?:🎯|📎|♡₊˚)?\s*(?:Assigned|Resources)|\n\n\n|$)/i);
  if (nextStepsMatch) {
    nextSteps = nextStepsMatch[1].trim();
  }

  return {
    rawText: text,
    actionDone: actionDone || textWithoutHeader || text,
    statusText,
    nextSteps,
    timeStarted,
    timeEnded,
    timeRange,
    startRaw,
    endRaw,
  };
}

export async function getAssistantsLastTasks(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        NOT: {
          email: { endsWith: '@system.local' }
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
      },
      orderBy: { name: 'asc' }
    });

    const frontendBaseUrl = (process.env.FRONTEND_URL || 'https://nexus.vipscaleph.com').replace(/\/+$/, '');

    const assistants = await Promise.all(
      users.map(async (u) => {
        const recentComments = await prisma.taskComment.findMany({
          where: { userId: u.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            task: {
              include: {
                list: {
                  include: {
                    space: { select: { name: true } },
                    statuses: true
                  }
                }
              }
            }
          }
        });

        const seenTaskIds = new Set<string>();
        const tasks: any[] = [];

        for (const c of recentComments) {
          if (!c.task || seenTaskIds.has(c.task.id)) continue;
          seenTaskIds.add(c.task.id);

          const clientName = c.task.list?.space?.name || c.task.list?.name || 'Unknown Client';
          const statusName = c.task.status || 'PENDING';
          const listStatus = c.task.list?.statuses?.find((s: any) => s.name.toUpperCase() === statusName.toUpperCase());
          const statusColor = listStatus?.color || NEXUS_STATUS_HEX[statusName.toUpperCase()] || '#8A8F98';

          const parsed = parseCommentProgress(c.content);

          tasks.push({
            taskId: c.task.id,
            taskName: c.task.title,
            clientName,
            status: statusName,
            statusColor,
            nexusLink: `${frontendBaseUrl}/lists/${c.task.listId}?task=${c.task.id}`,
            actionDone: parsed.actionDone,
            nextSteps: parsed.nextSteps || null,
            commentStatus: parsed.statusText || null,
            updatedAt: c.createdAt,
            timeStarted: parsed.timeStarted,
            timeEnded: parsed.timeEnded,
            timeRange: parsed.timeRange,
            startRaw: parsed.startRaw,
            endRaw: parsed.endRaw,
          });

          if (tasks.length >= 3) break;
        }

        if (tasks.length < 3) {
          const assignedTasks = await prisma.task.findMany({
            where: {
              OR: [
                { assigneeId: u.id },
                { assignees: { some: { id: u.id } } }
              ],
              id: { notIn: Array.from(seenTaskIds) }
            },
            orderBy: { updatedAt: 'desc' },
            take: 3 - tasks.length,
            include: {
              list: {
                include: {
                  space: { select: { name: true } },
                  statuses: true
                }
              }
            }
          });

          for (const t of assignedTasks) {
            seenTaskIds.add(t.id);
            const clientName = t.list?.space?.name || t.list?.name || 'Unknown Client';
            const statusName = t.status || 'PENDING';
            const listStatus = t.list?.statuses?.find((s: any) => s.name.toUpperCase() === statusName.toUpperCase());
            const statusColor = listStatus?.color || NEXUS_STATUS_HEX[statusName.toUpperCase()] || '#8A8F98';

            tasks.push({
              taskId: t.id,
              taskName: t.title,
              clientName,
              status: statusName,
              statusColor,
              nexusLink: `${frontendBaseUrl}/lists/${t.listId}?task=${t.id}`,
              actionDone: t.description ? parseCommentProgress(t.description).actionDone : '',
              nextSteps: null,
              commentStatus: null,
              updatedAt: t.updatedAt,
              timeStarted: t.description ? parseCommentProgress(t.description).timeStarted : null,
              timeEnded: t.description ? parseCommentProgress(t.description).timeEnded : null,
              timeRange: t.description ? parseCommentProgress(t.description).timeRange : null,
              startRaw: null,
              endRaw: null,
            });
          }
        }

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          avatarUrl: u.avatarUrl,
          tasks
        };
      })
    );

    const activeAssistants = assistants.filter((a) => a.tasks.length > 0);

    return res.json({
      source: 'NEXUS_DATABASE',
      verified: true,
      timestamp: new Date().toISOString(),
      assistants: activeAssistants
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

