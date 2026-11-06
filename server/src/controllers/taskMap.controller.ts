import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { io } from '../server';
import { logger } from '../config/logger';
import { invalidateCache, redis, isRedisReady } from '../services/redisService';
import { canUserSetAssignees } from '../utils/assignPermission';
import { isAuditorRole } from './auditShift.controller';
import {
  getStatusOptions,
  upsertStatusOption,
  deleteStatusOption,
  getShiftConfigs,
  updateShiftConfig,
  getCurrentActiveShift,
  getTaskMapRecord,
  getOrCreateTaskMapRecord,
  updateTaskMapRecord,
  getNextShift,
  toTaskMapShiftKey,
  fromTaskMapShiftKey,
  TaskMapRecordData,
} from '../services/taskMapService';

// Closed status check matching Nexus conventions
const isClosedStatus = (status?: string | null) => {
  const s = (status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  return s === 'CLOSED' || s === 'DONE' || s === 'COMPLETE' || s === 'COMPLETED' || s === 'RESOLVED' || s === 'CANCELLED';
};

/**
 * Fetch all tasks mapped to Task Map with their status options, shifts, and pool
 */
export const getTaskMapData = async (req: Request, res: Response) => {
  try {
    const shiftQuery = (req.query.shift as string || '').toUpperCase();
    const dateQuery = req.query.date as string || '';
    const searchQuery = (req.query.search as string || '').toLowerCase().trim();
    const clientQuery = (req.query.client as string || '').trim();

    const isAllShifts = shiftQuery === 'ALL';
    const activeShift = await getCurrentActiveShift();
    const currentShift = isAllShifts ? 'ALL' : (shiftQuery || activeShift);

    // Fetch active tasks from PostgreSQL
    const tasks = await prisma.task.findMany({
      where: {
        AND: [
          { status: { notIn: ['KYC', 'PIN BOARD', 'PINBOARD'] } },
        ],
      },
      include: {
        list: {
          select: {
            id: true,
            name: true,
            folder: { select: { id: true, name: true } },
          },
        },
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
        assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
        creator: { select: { id: true, name: true, email: true, avatarUrl: true } },
        subtasks: {
          include: {
            User: { select: { id: true, name: true, avatarUrl: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    });

    // Fetch TaskMap records
    const records = await prisma.$queryRawUnsafe<TaskMapRecordData[]>(
      `SELECT * FROM "TaskMapRecord"`
    );
    const recordsMap = new Map<string, TaskMapRecordData>();
    for (const r of records) {
      recordsMap.set(r.taskId, r);
    }

    // Options and Shift configs: filter out obsolete static Upwork options
    const rawOptions = await getStatusOptions();
    const options = rawOptions.filter((opt) => {
      const up = opt.label.toUpperCase().trim();
      return up !== 'UPWORK ACTIVE' && !up.startsWith('UPWORK |') && !up.startsWith('UPWORK|');
    });
    const shifts = await getShiftConfigs();

    // PM Users for Review queue and tag matching
    const allUsers = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        roles: true,
        systemRole: true,
      },
      orderBy: { name: 'asc' },
    });

    // Determine shift members (normal users + auditors) for the selected shift from AuditShiftConfig
    const shiftAuditorIdSet = new Set<string>();
    const shiftMemberIdSet = new Set<string>();
    const shiftMemberNameSet = new Set<string>();
    const shiftAuditorNameSet = new Set<string>();

    if (isAllShifts) {
      const allShiftConfigs = await (prisma as any).auditShiftConfig.findMany({
        where: { isActive: true },
      });
      for (const cfg of allShiftConfigs) {
        (cfg.auditorIds || []).forEach((id: string) => shiftAuditorIdSet.add(id.trim()));
        (cfg.memberIds || []).forEach((id: string) => shiftMemberIdSet.add(id.trim()));
        (cfg.memberNames || []).forEach((n: string) => shiftMemberNameSet.add(n.trim().toLowerCase()));
        (cfg.auditorNames || []).forEach((n: string) => shiftAuditorNameSet.add(n.trim().toLowerCase()));
      }
    } else {
      const auditShiftKey = fromTaskMapShiftKey(currentShift);
      const activeShiftConfig = await (prisma as any).auditShiftConfig.findFirst({
        where: { shiftKey: auditShiftKey, isActive: true },
      });
      (activeShiftConfig?.auditorIds || []).forEach((id: string) => shiftAuditorIdSet.add(id.trim()));
      (activeShiftConfig?.memberIds || []).forEach((id: string) => shiftMemberIdSet.add(id.trim()));
      (activeShiftConfig?.memberNames || []).forEach((n: string) => shiftMemberNameSet.add(n.trim().toLowerCase()));
      (activeShiftConfig?.auditorNames || []).forEach((n: string) => shiftAuditorNameSet.add(n.trim().toLowerCase()));
    }

    const shiftUsers = allUsers
      .filter((u) => {
        if (isAllShifts && (shiftMemberIdSet.size === 0 && shiftAuditorIdSet.size === 0)) return true;
        if (shiftMemberIdSet.has(u.id) || shiftAuditorIdSet.has(u.id)) return true;
        if (u.name && (shiftMemberNameSet.has(u.name.toLowerCase()) || shiftAuditorNameSet.has(u.name.toLowerCase()))) {
          return true;
        }
        return false;
      })
      .map((u) => ({
        ...u,
        isAudit: isAuditorRole(u.roles) || shiftAuditorIdSet.has(u.id),
      }));

    const isPmUser = (u: any) => {
      if (u.systemRole === 'ADMIN') return true;
      const rolesStr = (u.roles || []).join(' ').toLowerCase();
      if (rolesStr.includes('pm') || rolesStr.includes('project manager') || rolesStr.includes('team lead') || rolesStr.includes('senior')) {
        return true;
      }
      const nameUp = (u.name || '').toUpperCase();
      return nameUp.includes('CHE') || nameUp.includes('PAU') || nameUp.includes('HAN');
    };

    const pmUsers = allUsers.filter(isPmUser);

    // Build enriched task items
    const enrichedTasks = (tasks as any[]).map((task) => {
      let mapRecord = recordsMap.get(task.id);
      if (!mapRecord) {
        mapRecord = {
          id: '',
          taskId: task.id,
          subtaskId: null,
          statuses: [],
          shift: currentShift,
          shiftDate: new Date(),
          rolloverCount: 0,
          originShift: null,
          originDate: null,
          dontRollover: false,
          handedOver: false,
          stepOrder: 0,
          pmReviews: null,
          waitingReviewSince: null,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        };
      }

      // Check if task has PM pending reviews
      const pmTags = (mapRecord.statuses || []).filter(s => {
        const up = s.toUpperCase();
        return up === 'CHE' || up === 'PAU' || up === 'HAN' || up.includes('PM');
      });

      // Check active Upwork status and session
      let upworkStartedAt: string | null = null;
      let upworkSession: any = null;
      const upworkStatus = (mapRecord.statuses || []).find(s => s.toUpperCase().startsWith('UPWORK'));
      if (upworkStatus) {
        let reviewsList = mapRecord.pmReviews;
        if (typeof reviewsList === 'string') {
          try { reviewsList = JSON.parse(reviewsList); } catch { reviewsList = []; }
        }
        if (Array.isArray(reviewsList)) {
          upworkSession = reviewsList.find((r: any) => r.type === 'UPWORK_SESSION' && r.active);
        }
        upworkStartedAt = upworkSession?.startedAt || (mapRecord.updatedAt ? new Date(mapRecord.updatedAt).toISOString() : new Date().toISOString());
      }

      const folderName = (task.list?.folder?.name || '').toLowerCase();
      const listName = (task.list?.name || '').toLowerCase();
      const isAdminTask = folderName === 'admin' || folderName.includes('admin') || listName === 'admin';

      return {
        ...task,
        taskMap: mapRecord,
        pmTags,
        isWaitingPmReview: pmTags.length > 0,
        isClosed: isClosedStatus(task.status),
        isAdminTask,
        upworkStartedAt,
        upworkSession,
      };
    });

    // Filter by search query if present
    const searchedTasks = enrichedTasks.filter((task: any) => {
      if (!searchQuery) return true;
      const titleMatch = task.title.toLowerCase().includes(searchQuery);
      const clientMatch = (task.list?.name || '').toLowerCase().includes(searchQuery);
      const assigneeMatch = (task.assignee?.name || '').toLowerCase().includes(searchQuery) ||
        (task.assignees || []).some((a: any) => (a.name || '').toLowerCase().includes(searchQuery));
      const statusMatch = (task.taskMap.statuses || []).some((s: string) => s.toLowerCase().includes(searchQuery));
      return titleMatch || clientMatch || assigneeMatch || statusMatch;
    });

    // Filter by client query if present
    const filteredTasks = searchedTasks.filter((task: any) => {
      if (!clientQuery || clientQuery === 'ALL') return true;
      const listId = task.listId || task.list?.id;
      const listName = task.list?.name || '';
      return listId === clientQuery || listName.toLowerCase() === clientQuery.toLowerCase();
    });

    // Helper to check if task is closed (by Nexus status or spreadsheet status)
    const isClosedTask = (t: any) => {
      if (t.isClosed) return true;
      const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      if (isClosedStatus(s)) return true;
      const mapStatuses = t.taskMap?.statuses || [];
      if (mapStatuses.some((st: string) => st.toUpperCase() === 'DONE' || st.toUpperCase() === 'CLOSED')) {
        return true;
      }
      return false;
    };

    // Segregate Available tasks pool:
    // Strictly holds Pending and Revision tasks ONLY.
    // Explicitly exclude Waiting, Recurring, Daily, Weekly, and Monthly tasks.
    const isAvailableTaskStatus = (t: any) => {
      const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      const mapStatuses = (t.taskMap?.statuses || []).map((x: string) =>
        x.trim().toUpperCase().replace(/[\s_-]+/g, '')
      );

      // Exclude waiting, recurring, daily, weekly, monthly, and on-hold tasks
      const isExcluded =
        s === 'WAITING' ||
        s.includes('WAITING') ||
        s === 'DAILY' ||
        s.includes('DAILY') ||
        s === 'WEEKLY' ||
        s.includes('WEEKLY') ||
        s === 'MONTHLY' ||
        s.includes('MONTHLY') ||
        s === 'RECURRING' ||
        s.includes('RECURRING') ||
        s === 'ONHOLD' ||
        s.includes('ONHOLD') ||
        s.includes('HOLD') ||
        !!t.recurringConfig ||
        mapStatuses.some((st: string) =>
          ['WAITING', 'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING', 'ONHOLD'].includes(st) ||
          st.includes('WAITING') ||
          st.includes('DAILY') ||
          st.includes('WEEKLY') ||
          st.includes('MONTHLY') ||
          st.includes('RECURRING') ||
          st.includes('ONHOLD') ||
          st.includes('HOLD')
        );

      if (isExcluded) return false;

      // Strictly only Pending and Revision statuses
      const isPending = s === 'PENDING' || mapStatuses.includes('PENDING');
      const isRevision = s === 'REVISION' || mapStatuses.includes('REVISION');

      return isPending || isRevision;
    };

    const availablePool = filteredTasks.filter((t: any) => {
      if (isClosedTask(t)) return false;
      return isAvailableTaskStatus(t);
    });

    // Don't show closed tasks to users on Task Map
    const openTasks = filteredTasks.filter((t: any) => !isClosedTask(t));

    // Compute status counts across non-closed tasks
    const statusCounts: Record<string, number> = {};
    let overdueCount = 0;
    let unassignedCount = 0;

    for (const opt of options) {
      statusCounts[opt.label] = 0;
    }

    for (const t of openTasks as any[]) {
      for (const st of t.taskMap.statuses || []) {
        statusCounts[st] = (statusCounts[st] || 0) + 1;
      }
      if (t.dueDate && new Date(t.dueDate) < new Date()) {
        overdueCount++;
      }
      if (!t.assigneeId && (!t.assignees || t.assignees.length === 0)) {
        unassignedCount++;
      }
    }

    // Collect all active Upwork sessions across non-closed tasks
    const activeUpworkSessions: Array<{
      taskId: string;
      taskTitle: string;
      userId: string;
      userName: string;
      pmName: string;
      startedAt: string;
    }> = [];

    for (const t of openTasks as any[]) {
      const upworkTag = (t.taskMap?.statuses || []).find((s: string) => s.toUpperCase().startsWith('UPWORK'));
      if (upworkTag) {
        let pmName = 'General';
        const m = upworkTag.match(/^UPWORK\s*\|\s*(.+)$/i);
        if (m && m[1]) {
          pmName = m[1].trim().toUpperCase();
        } else if (upworkTag.toUpperCase().includes('ACTIVE')) {
          pmName = 'Active';
        }

        const startedAt = t.upworkStartedAt || (t.taskMap?.updatedAt ? new Date(t.taskMap.updatedAt).toISOString() : new Date().toISOString());
        const rawName = t.upworkSession?.userName || t.assignee?.name || (t.assignees && t.assignees[0]?.name) || t.creator?.name || '';
        const cleanName = rawName.includes('@') ? rawName.split('@')[0] : rawName;
        const userName = (pmName && pmName !== 'General' && pmName !== 'Active') ? pmName : (cleanName || 'Team Member');
        const userId = t.upworkSession?.userId || t.assigneeId || (t.assignees && t.assignees[0]?.id) || '';

        const sessionItem = {
          taskId: t.id,
          taskTitle: t.title,
          userId,
          userName,
          pmName,
          startedAt,
        };
        activeUpworkSessions.push(sessionItem);

        if (isRedisReady()) {
          redis.hset('task_map:upwork_active', t.id, JSON.stringify(sessionItem)).catch(() => { });
        }
      }
    }

    // Fetch all client lists under "Client Dashboard" in PostgreSQL
    let allClients: Array<{ id: string; name: string }> = [];
    try {
      const [clientDashboardFolders, clientDashboardSpaces, directClientLists] = await Promise.all([
        prisma.folder.findMany({
          where: {
            name: { contains: 'client dashboard', mode: 'insensitive' },
          },
          select: {
            id: true,
            name: true,
            lists: {
              select: { id: true, name: true },
              orderBy: { name: 'asc' },
            },
            subfolders: {
              select: {
                id: true,
                name: true,
                lists: {
                  select: { id: true, name: true },
                  orderBy: { name: 'asc' },
                },
              },
            },
          },
        }),
        prisma.space.findMany({
          where: {
            name: { contains: 'client dashboard', mode: 'insensitive' },
          },
          select: {
            id: true,
            name: true,
            lists: {
              select: { id: true, name: true },
              orderBy: { name: 'asc' },
            },
            folders: {
              select: {
                id: true,
                name: true,
                lists: {
                  select: { id: true, name: true },
                  orderBy: { name: 'asc' },
                },
              },
            },
          },
        }),
        prisma.list.findMany({
          where: {
            OR: [
              { folder: { name: { contains: 'client dashboard', mode: 'insensitive' } } },
              { folder: { parentFolder: { name: { contains: 'client dashboard', mode: 'insensitive' } } } },
              { space: { name: { contains: 'client dashboard', mode: 'insensitive' } } },
              { folder: { space: { name: { contains: 'client dashboard', mode: 'insensitive' } } } },
            ],
          },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      const allClientsMap = new Map<string, { id: string; name: string }>();

      for (const f of clientDashboardFolders) {
        (f.lists || []).forEach((l) => allClientsMap.set(l.id, { id: l.id, name: l.name }));
        for (const sub of f.subfolders || []) {
          (sub.lists || []).forEach((l) => allClientsMap.set(l.id, { id: l.id, name: l.name }));
        }
      }

      for (const s of clientDashboardSpaces) {
        (s.lists || []).forEach((l) => allClientsMap.set(l.id, { id: l.id, name: l.name }));
        for (const f of s.folders || []) {
          (f.lists || []).forEach((l) => allClientsMap.set(l.id, { id: l.id, name: l.name }));
        }
      }

      for (const l of directClientLists) {
        allClientsMap.set(l.id, { id: l.id, name: l.name });
      }

      // Also include any list from non-admin active tasks
      for (const t of openTasks as any[]) {
        if (t.isAdminTask) continue;
        const listId = t.list?.id;
        const listName = t.list?.name;
        if (listId && listName && !allClientsMap.has(listId)) {
          allClientsMap.set(listId, { id: listId, name: listName });
        }
      }

      allClients = Array.from(allClientsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    } catch (err: any) {
      logger.warn({ err }, 'Failed to query client dashboard folders');
    }

    res.json({
      success: true,
      tasks: openTasks,
      availablePool,
      allClients,
      options,
      shifts,
      statusCounts,
      overdueCount,
      unassignedCount,
      activeShift,
      currentShift,
      currentDate: dateQuery || new Date().toISOString().split('T')[0],
      pmUsers,
      allUsers,
      shiftUsers,
      activeUpworkSessions,
    });
  } catch (error: any) {
    logger.error({ error }, 'Error fetching task map data');
    res.status(500).json({ error: 'Failed to fetch task map data' });
  }
};

/**
 * Get all status options
 */
export const getOptions = async (req: Request, res: Response) => {
  try {
    const rawOptions = await getStatusOptions();
    const options = rawOptions.filter((opt) => {
      const up = opt.label.toUpperCase().trim();
      return up !== 'UPWORK ACTIVE' && !up.startsWith('UPWORK |') && !up.startsWith('UPWORK|');
    });
    res.json({ success: true, options });
  } catch (error: any) {
    logger.error({ error }, 'Error fetching status options');
    res.status(500).json({ error: 'Failed to fetch status options' });
  }
};

/**
 * Upsert a status option (Admin only)
 */
export const upsertOption = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user?.systemRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required to modify status options' });
    }

    const { id, label, color, textColor, order } = req.body;
    if (!label || !color) {
      return res.status(400).json({ error: 'Label and color are required' });
    }

    const option = await upsertStatusOption({ id, label, color, textColor, order });
    io.emit('task_map:options_updated', { option });
    res.json({ success: true, option });
  } catch (error: any) {
    logger.error({ error }, 'Error upserting status option');
    res.status(500).json({ error: 'Failed to upsert status option' });
  }
};

/**
 * Delete a status option (Admin only)
 */
export const deleteOption = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user?.systemRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required to delete status options' });
    }

    const { id } = req.params;
    const force = req.query.force === 'true';

    const result = await deleteStatusOption(id, force);
    if (!result.success && result.inUseCount) {
      return res.status(400).json({
        error: `This option is currently used by ${result.inUseCount} task(s). Confirm to remove it from all tasks.`,
        inUseCount: result.inUseCount,
      });
    }

    io.emit('task_map:options_updated', { deletedId: id });
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ error }, 'Error deleting status option');
    res.status(500).json({ error: 'Failed to delete status option' });
  }
};

/**
 * Get shift configs
 */
export const getShifts = async (req: Request, res: Response) => {
  try {
    const shifts = await getShiftConfigs();
    const activeShiftKey = await getCurrentActiveShift();
    res.json({ success: true, shifts, activeShiftKey });
  } catch (error: any) {
    logger.error({ error }, 'Error fetching shifts');
    res.status(500).json({ error: 'Failed to fetch shifts' });
  }
};

/**
 * Update shift configs (Admin only)
 */
export const updateShifts = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user?.systemRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required to modify shift configurations' });
    }

    const { shifts } = req.body;
    if (Array.isArray(shifts)) {
      for (const s of shifts) {
        if (s.shiftKey) {
          await updateShiftConfig(s.shiftKey, s);
        }
      }
    }

    const updatedShifts = await getShiftConfigs();
    const activeShiftKey = await getCurrentActiveShift();
    io.emit('task_map:shifts_updated', { shifts: updatedShifts, activeShiftKey });
    res.json({ success: true, shifts: updatedShifts, activeShiftKey });
  } catch (error: any) {
    logger.error({ error }, 'Error updating shifts');
    res.status(500).json({ error: 'Failed to update shifts' });
  }
};

/**
 * Update multi-select status chips for a task
 */
export const updateTaskStatuses = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { statuses } = req.body;
    const user = (req as any).user;

    if (!Array.isArray(statuses)) {
      return res.status(400).json({ error: 'Statuses must be an array of strings' });
    }

    const currentRecord = await getOrCreateTaskMapRecord(id);
    const oldStatuses = currentRecord.statuses || [];

    // Check permissions on Available Tasks (unassigned in pool): strictly Project Managers and Admins only
    const currentTask = await prisma.task.findUnique({
      where: { id },
      select: {
        title: true,
        assigneeId: true,
        assignees: { select: { id: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    });

    const isPm = user?.systemRole === 'ADMIN' || (user?.roles || []).some((r: string) => {
      const rl = r.toLowerCase();
      return rl.includes('pm') || rl.includes('project manager') || rl.includes('team lead') || rl.includes('senior');
    });

    const isUnassigned = !currentTask?.assigneeId && (!currentTask?.assignees || currentTask.assignees.length === 0);
    if (isUnassigned && !isPm) {
      return res.status(403).json({ error: 'Only Project Managers can modify statuses on Available Tasks' });
    }

    // Detect PM review tags
    const pmReviewTags = ['CHE', 'PAU', 'HAN'];
    const addedPmTags = statuses.filter(s => pmReviewTags.includes(s.toUpperCase()) && !oldStatuses.includes(s));

    let waitingReviewSince = currentRecord.waitingReviewSince;
    let pmReviews = currentRecord.pmReviews || [];
    if (typeof pmReviews === 'string') {
      try { pmReviews = JSON.parse(pmReviews); } catch { pmReviews = []; }
    }

    if (addedPmTags.length > 0) {
      waitingReviewSince = new Date();
      for (const tag of addedPmTags) {
        pmReviews.push({
          pmTag: tag,
          status: 'PENDING',
          requestedBy: user?.name || user?.email || 'User',
          requestedAt: new Date().toISOString(),
        });
      }
    }

    // Upwork tracking detection & session persistence (Reverse-engineered from Teammap.js)
    const oldUpworkTag = oldStatuses.find((s: string) => s.toUpperCase().startsWith('UPWORK'));
    const newUpworkTag = statuses.find((s: string) => s.toUpperCase().startsWith('UPWORK'));

    let taskRecordForUpwork: any = null;
    if (newUpworkTag || oldUpworkTag) {
      taskRecordForUpwork = await prisma.task.findUnique({
        where: { id },
        select: { title: true, assignee: { select: { id: true, name: true, email: true } } },
      });
    }

    const taskTitle = taskRecordForUpwork?.title || 'Task';
    const rawUserName = user?.name || taskRecordForUpwork?.assignee?.name || (user?.email ? user.email.split('@')[0] : '') || 'Team Member';
    const cleanUserName = rawUserName.includes('@') ? rawUserName.split('@')[0] : rawUserName;
    const effectiveUserId = user?.id || taskRecordForUpwork?.assignee?.id || '';

    let upworkStartedAt: string | null = null;
    let upworkSession: any = null;

    // 1. Newly activated or updated Upwork status
    if (newUpworkTag) {
      let pmName = 'General';
      const m = newUpworkTag.match(/^UPWORK\s*\|\s*(.+)$/i);
      if (m && m[1]) {
        pmName = m[1].trim().toUpperCase();
      } else if (newUpworkTag.toUpperCase().includes('ACTIVE')) {
        pmName = 'Active';
      }

      const sessionUserName = (pmName && pmName !== 'General' && pmName !== 'Active') ? pmName : cleanUserName;

      // Check if there is an existing active session
      let activeSession = pmReviews.find((r: any) => r.type === 'UPWORK_SESSION' && r.active);
      if (!activeSession) {
        upworkStartedAt = new Date().toISOString();
        activeSession = {
          type: 'UPWORK_SESSION',
          active: true,
          pmName,
          userId: effectiveUserId,
          userName: sessionUserName,
          startedAt: upworkStartedAt,
        };
        pmReviews.push(activeSession);
      } else {
        activeSession.pmName = pmName;
        activeSession.userName = sessionUserName;
        upworkStartedAt = activeSession.startedAt;
      }
      upworkSession = activeSession;

      // Save to Redis active sessions hash
      if (isRedisReady()) {
        try {
          await redis.hset(
            'task_map:upwork_active',
            id,
            JSON.stringify({
              taskId: id,
              taskTitle,
              userId: effectiveUserId,
              userName: sessionUserName,
              pmName,
              startedAt: upworkStartedAt,
            })
          );
        } catch (err) {
          logger.warn({ err }, 'Failed to set Upwork active session in Redis');
        }
      }

      // Broadcast real-time Upwork active alert to all connected users
      io.emit('upwork:status_changed', {
        taskId: id,
        taskTitle,
        active: true,
        userId: effectiveUserId,
        userName: sessionUserName,
        pmName,
        startedAt: upworkStartedAt,
      });
    } else if (oldUpworkTag && !newUpworkTag) {
      // 2. Stopped Upwork (deselected or changed away from Upwork)
      const activeIdx = pmReviews.findIndex((r: any) => r.type === 'UPWORK_SESSION' && r.active);
      let durationS = 0;
      let pmName = 'General';
      if (activeIdx !== -1) {
        const s = pmReviews[activeIdx];
        pmName = s.pmName || 'General';
        const startMs = new Date(s.startedAt).getTime();
        durationS = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
        pmReviews[activeIdx].active = false;
        pmReviews[activeIdx].stoppedAt = new Date().toISOString();
        pmReviews[activeIdx].durationS = durationS;
      }

      // Remove from Redis active sessions hash
      if (isRedisReady()) {
        try {
          await redis.hdel('task_map:upwork_active', id);
        } catch (err) {
          logger.warn({ err }, 'Failed to remove Upwork session from Redis');
        }
      }

      // Broadcast real-time Upwork stopped alert to all connected users
      io.emit('upwork:status_changed', {
        taskId: id,
        taskTitle,
        active: false,
        userId: effectiveUserId,
        userName: cleanUserName,
        pmName,
        durationS,
      });
    }

    const updated = await updateTaskMapRecord(id, {
      statuses,
      waitingReviewSince,
      pmReviews,
    });

    // Invalidate Redis task and task_map caches
    await invalidateCache('task:*', 'tasks:all', `task:${id}`, 'task_map:*');

    // Collect latest active Upwork sessions from Redis or current session
    let activeUpworkSessions: any[] = [];
    if (isRedisReady()) {
      try {
        const rawMap = await redis.hgetall('task_map:upwork_active');
        if (rawMap && Object.keys(rawMap).length > 0) {
          activeUpworkSessions = Object.values(rawMap).map((val) => JSON.parse(val));
        }
      } catch (err) { }
    }
    if (activeUpworkSessions.length === 0 && upworkSession?.active) {
      activeUpworkSessions = [{
        taskId: id,
        taskTitle,
        userId: effectiveUserId,
        userName: upworkSession.userName || cleanUserName,
        pmName: upworkSession.pmName,
        startedAt: upworkStartedAt,
      }];
    }

    // Create AuditLog
    await prisma.auditLog.create({
      data: {
        action: 'TASK_MAP_STATUS_CHANGE',
        entity: 'TASK',
        entityId: id,
        userId: user?.id || 'system',
        details: {
          oldStatuses,
          newStatuses: statuses,
          actor: user?.name || user?.email,
        },
      },
    });

    io.emit('task_map:updated', {
      taskId: id,
      statuses,
      taskMap: updated,
      upworkStartedAt,
      upworkSession,
      activeUpworkSessions,
    });

    res.json({
      success: true,
      taskMap: updated,
      upworkStartedAt,
      upworkSession,
      activeUpworkSessions,
    });
  } catch (error: any) {
    logger.error({ error }, 'Error updating task statuses');
    res.status(500).json({ error: 'Failed to update task statuses' });
  }
};

/**
 * Assign or reassign a task on the Task Map board (drag-and-drop).
 * Strictly restricted: Only Project Managers, Seniors, and Admins can assign tasks.
 */
export const assignTaskMapTask = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { assigneeId } = req.body;
    const user = (req as any).user;

    if (!user) return res.status(401).json({ error: 'Authentication required' });

    // Validate PM or Admin permission via assignPermission
    const allowed = await canUserSetAssignees(user.id);
    if (!allowed) {
      return res.status(403).json({
        error: 'Only Project Managers and Admins can assign tasks from Available tasks',
      });
    }

    const currentTask = await prisma.task.findUnique({
      where: { id },
      include: {
        list: true,
        assignees: true,
      },
    });

    if (!currentTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Prepare update data
    const updateData: any = {};
    if (assigneeId) {
      const targetUser = await prisma.user.findUnique({
        where: { id: assigneeId },
        select: { id: true, name: true, roles: true, systemRole: true },
      });

      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found' });
      }

      // Check role restrictions on the task
      const roleRestrictions = currentTask.assigneeRoleRestrictions || [];
      if (roleRestrictions.length > 0 && targetUser.systemRole !== 'ADMIN') {
        const userRoles = (targetUser.roles || []).map((r: string) => r.toLowerCase().trim());
        const hasMatchingRole = roleRestrictions.some((reqRole: string) => {
          const reqLower = reqRole.toLowerCase().trim();
          return userRoles.some((ur: string) => ur === reqLower || ur.includes(reqLower) || reqLower.includes(ur));
        });

        if (!hasMatchingRole) {
          return res.status(400).json({
            error: `${targetUser.name || 'User'} is not fit for the task (requires role: ${roleRestrictions.join(', ')})`,
          });
        }
      }

      updateData.assigneeId = assigneeId;
      updateData.assignees = { set: [{ id: assigneeId }] };
      updateData.status = 'IN PROGRESS';
    } else {
      updateData.assigneeId = null;
      updateData.assignees = { set: [] };
      updateData.status = 'PENDING';
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: updateData,
      include: {
        list: {
          select: {
            id: true,
            name: true,
            folder: { select: { id: true, name: true } },
          },
        },
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
        assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
        creator: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    // Remove Available / Pending / Revision statuses if assigned to a user column; add Available Task if unassigned back to pool
    const record = await getOrCreateTaskMapRecord(id);
    let newStatuses = record.statuses || [];
    if (assigneeId) {
      newStatuses = newStatuses.filter((s) => {
        const up = s.toUpperCase().replace(/[\s_-]+/g, '');
        return up !== 'AVAILABLETASK' && up !== 'PENDING' && up !== 'REVISION' && up !== 'INREVIEW' && up !== 'TOREVIEW';
      });
    } else {
      if (!newStatuses.some((s) => s.toUpperCase() === 'AVAILABLE TASK')) {
        newStatuses.push('Available Task');
      }
    }
    const updatedRecord = await updateTaskMapRecord(id, { statuses: newStatuses });

    // Invalidate Redis cache immediately
    await invalidateCache(
      `task:${id}`,
      `task:activities:${id}`,
      'tasks:all',
      'dashboard:all',
      'lists:all',
      'task_map:all'
    ).catch(() => { });

    // AuditLog
    await prisma.auditLog.create({
      data: {
        action: 'ASSIGNMENT',
        entity: 'TASK',
        entityId: id,
        userId: user.id,
        details: {
          assigneeId: assigneeId || null,
          assigneeName: updatedTask.assignee?.name || 'Unassigned',
          assignedBy: user.name || user.email,
          assignedAt: new Date().toISOString(),
        },
      },
    }).catch(console.error);

    // Broadcast realtime Socket.io events
    io.emit('task:updated', updatedTask);
    io.emit('task_map:updated', { taskId: id, task: updatedTask, taskMap: updatedRecord, assigneeId });
    io.emit('task_activity', {
      listId: updatedTask.listId,
      taskId: id,
      activity: {
        type: 'assignment',
        author: user.name || 'Project Manager',
        assigneeName: updatedTask.assignee?.name || 'Unassigned',
        date: new Date(),
      },
    });

    return res.json({ success: true, task: updatedTask, taskMap: updatedRecord });
  } catch (error: any) {
    logger.error({ error }, 'Error assigning task in Task Map');
    return res.status(500).json({ error: 'Failed to assign task' });
  }
};

/**
 * Claim an available task from the pool (Restricted: PMs/Admins only)
 */
export const claimTask = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    // Enforce that only PMs and Admins can assign/claim from Available tasks
    const allowed = await canUserSetAssignees(user.id);
    if (!allowed) {
      return res.status(403).json({ error: 'Only Project Managers and Admins can assign tasks from Available tasks' });
    }

    // Update Task assignee
    const task = await prisma.task.update({
      where: { id },
      data: {
        assigneeId: user.id,
        assignees: {
          connect: { id: user.id },
        },
      },
      include: {
        assignee: true,
        assignees: true,
      },
    });

    // Remove 'Available Task' status if present
    const record = await getOrCreateTaskMapRecord(id);
    const newStatuses = (record.statuses || []).filter(s => s.toUpperCase() !== 'AVAILABLE TASK');
    const updated = await updateTaskMapRecord(id, { statuses: newStatuses });

    // Invalidate Redis cache
    await invalidateCache(
      `task:${id}`,
      `task:activities:${id}`,
      'tasks:all',
      'dashboard:all',
      'lists:all',
      'task_map:all'
    ).catch(() => { });

    // AuditLog
    await prisma.auditLog.create({
      data: {
        action: 'TASK_MAP_CLAIM',
        entity: 'TASK',
        entityId: id,
        userId: user.id,
        details: {
          claimedBy: user.name || user.email,
          claimedAt: new Date().toISOString(),
        },
      },
    });

    io.emit('task_map:updated', { taskId: id, task, taskMap: updated });
    io.emit('task:updated', { id, task });

    res.json({ success: true, task, taskMap: updated });
  } catch (error: any) {
    logger.error({ error }, 'Error claiming task');
    res.status(500).json({ error: 'Failed to claim task' });
  }
};

/**
 * PM Review Action (Approve or Request Revision)
 */
export const handlePmReviewAction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { action, pmTag, comment } = req.body;
    const user = (req as any).user;

    if (!action || !['APPROVE', 'REQUEST_REVISION'].includes(action)) {
      return res.status(400).json({ error: 'Action must be APPROVE or REQUEST_REVISION' });
    }

    const record = await getOrCreateTaskMapRecord(id);
    let statuses = [...(record.statuses || [])];
    let pmReviews = record.pmReviews || [];
    if (typeof pmReviews === 'string') {
      try { pmReviews = JSON.parse(pmReviews); } catch { pmReviews = []; }
    }

    if (action === 'APPROVE') {
      // Remove this PM's tag from statuses
      if (pmTag) {
        statuses = statuses.filter(s => s.toUpperCase() !== pmTag.toUpperCase());
      }

      pmReviews.push({
        pmTag: pmTag || 'PM',
        status: 'APPROVED',
        approvedBy: user?.name || user?.email || 'PM',
        approvedById: user?.id,
        approvedAt: new Date().toISOString(),
      });

      // Check if all PM tags are now resolved
      const remainingPmTags = statuses.filter(s => ['CHE', 'PAU', 'HAN'].includes(s.toUpperCase()));
      if (remainingPmTags.length === 0) {
        // Tag "To send"
        if (!statuses.includes('To send')) {
          statuses.push('To send');
        }
      }

      const updated = await updateTaskMapRecord(id, {
        statuses,
        pmReviews,
        waitingReviewSince: remainingPmTags.length > 0 ? record.waitingReviewSince : null,
      });

      await prisma.auditLog.create({
        data: {
          action: 'PM_REVIEW_APPROVE',
          entity: 'TASK',
          entityId: id,
          userId: user?.id || 'system',
          details: {
            pmTag,
            approvedBy: user?.name || user?.email,
            allApproved: remainingPmTags.length === 0,
          },
        },
      });

      io.emit('task_map:updated', { taskId: id, taskMap: updated });
      io.emit('task:updated', { id });
      return res.json({ success: true, taskMap: updated });
    }

    if (action === 'REQUEST_REVISION') {
      if (!comment || !comment.trim()) {
        return res.status(400).json({ error: 'A short comment is required when requesting revision' });
      }

      // Add 'Revision' status and remove PM review tag
      if (!statuses.includes('Revision')) {
        statuses.push('Revision');
      }
      if (pmTag) {
        statuses = statuses.filter(s => s.toUpperCase() !== pmTag.toUpperCase());
      }

      pmReviews.push({
        pmTag: pmTag || 'PM',
        status: 'REVISION',
        requestedBy: user?.name || user?.email || 'PM',
        requestedById: user?.id,
        comment: comment.trim(),
        requestedAt: new Date().toISOString(),
      });

      // Post comment on task so MA sees feedback
      await prisma.taskComment.create({
        data: {
          taskId: id,
          userId: user?.id || 'system',
          content: `<p><strong>Revision requested by ${user?.name || 'PM'}:</strong> ${comment.trim()}</p>`,
        },
      });

      const updated = await updateTaskMapRecord(id, {
        statuses,
        pmReviews,
        waitingReviewSince: null,
      });

      await prisma.auditLog.create({
        data: {
          action: 'PM_REVIEW_REVISION',
          entity: 'TASK',
          entityId: id,
          userId: user?.id || 'system',
          details: {
            pmTag,
            comment: comment.trim(),
            requestedBy: user?.name || user?.email,
          },
        },
      });

      io.emit('task_map:updated', { taskId: id, taskMap: updated });
      io.emit('task:updated', { id });
      return res.json({ success: true, taskMap: updated });
    }
  } catch (error: any) {
    logger.error({ error }, 'Error processing PM review action');
    res.status(500).json({ error: 'Failed to process PM review action' });
  }
};

/**
 * Manual or Shift Rollover
 */
export const runRollover = async (req: Request, res: Response) => {
  try {
    const { taskId, shift } = req.body;
    const user = (req as any).user;

    const targetShift = shift || (await getCurrentActiveShift());
    const { nextShift, nextDay } = getNextShift(targetShift);

    // If specific taskId passed, roll over that task
    if (taskId) {
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) return res.status(404).json({ error: 'Task not found' });
      if (isClosedStatus(task.status)) {
        return res.status(400).json({ error: 'Closed tasks cannot be rolled over' });
      }

      const record = await getOrCreateTaskMapRecord(taskId);
      if (record.dontRollover) {
        return res.status(400).json({ error: 'Task is marked "Don\'t roll over"' });
      }

      const nextDate = nextDay
        ? new Date(Date.now() + 24 * 60 * 60 * 1000)
        : record.shiftDate;

      const updated = await updateTaskMapRecord(taskId, {
        shift: nextShift,
        shiftDate: nextDate,
        rolloverCount: (record.rolloverCount || 0) + 1,
        originShift: record.originShift || record.shift,
        originDate: record.originDate || record.shiftDate,
      });

      await prisma.auditLog.create({
        data: {
          action: 'TASK_MAP_ROLLOVER',
          entity: 'TASK',
          entityId: taskId,
          userId: user?.id || 'system',
          details: {
            fromShift: targetShift,
            toShift: nextShift,
            rolloverCount: updated.rolloverCount,
            actor: user?.name || 'Manual Rollover',
          },
        },
      });

      io.emit('task_map:updated', { taskId, taskMap: updated });
      return res.json({ success: true, taskMap: updated });
    }

    // Otherwise, batch roll over all eligible tasks for the current shift
    const records = await prisma.$queryRawUnsafe<TaskMapRecordData[]>(
      `SELECT * FROM "TaskMapRecord" WHERE "shift" = $1 AND "dontRollover" = false`,
      targetShift
    );

    let rolledCount = 0;
    for (const rec of records) {
      const task = await prisma.task.findUnique({ where: { id: rec.taskId }, select: { status: true } });
      if (!task || isClosedStatus(task.status)) continue;

      // Tasks waiting for PM review do NOT roll over for MA (their part is done)
      const hasPmReview = (rec.statuses || []).some(s => ['CHE', 'PAU', 'HAN'].includes(s.toUpperCase()));
      if (hasPmReview) continue;

      // Exclude Sent, Done, Handed-over
      if (rec.handedOver || (rec.statuses || []).includes('Sent') || (rec.statuses || []).includes('Done Review')) {
        continue;
      }

      const nextDate = nextDay ? new Date(Date.now() + 24 * 60 * 60 * 1000) : rec.shiftDate;
      await updateTaskMapRecord(rec.taskId, {
        shift: nextShift,
        shiftDate: nextDate,
        rolloverCount: (rec.rolloverCount || 0) + 1,
        originShift: rec.originShift || rec.shift,
        originDate: rec.originDate || rec.shiftDate,
      });

      rolledCount++;
    }

    io.emit('task_map:updated');
    res.json({ success: true, rolledCount, nextShift });
  } catch (error: any) {
    logger.error({ error }, 'Error executing rollover');
    res.status(500).json({ error: 'Failed to execute rollover' });
  }
};

/**
 * Update task metadata (e.g. dontRollover, stepOrder, handedOver)
 */
export const updateTaskMeta = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { dontRollover, handedOver, stepOrder, shift } = req.body;

    const data: Partial<TaskMapRecordData> = {};
    if (dontRollover !== undefined) data.dontRollover = Boolean(dontRollover);
    if (handedOver !== undefined) data.handedOver = Boolean(handedOver);
    if (stepOrder !== undefined) data.stepOrder = parseInt(stepOrder, 10);
    if (shift !== undefined) data.shift = String(shift).toUpperCase();

    const updated = await updateTaskMapRecord(id, data);
    io.emit('task_map:updated', { taskId: id, taskMap: updated });
    res.json({ success: true, taskMap: updated });
  } catch (error: any) {
    logger.error({ error }, 'Error updating task meta');
    res.status(500).json({ error: 'Failed to update task meta' });
  }
};

/**
 * Get task timeline
 */
export const getTaskTimeline = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const logs = await prisma.auditLog.findMany({
      where: {
        entity: 'TASK',
        entityId: id,
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const record = await getTaskMapRecord(id);

    res.json({ success: true, logs, taskMap: record });
  } catch (error: any) {
    logger.error({ error }, 'Error fetching timeline');
    res.status(500).json({ error: 'Failed to fetch timeline' });
  }
};
