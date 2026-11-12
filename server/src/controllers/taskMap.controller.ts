import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { io } from '../server';
import { logger } from '../config/logger';
import { invalidateCache, getCache, setCache, redis, isRedisReady } from '../services/redisService';
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
  getUpworkClients,
  getUpworkProjectClients,
  addUpworkClient,
  addUpworkProjectClient,
  removeUpworkClient,
  removeUpworkProjectClient,
  setUpworkClients,
  setUpworkProjectClients,
  isProjectBasedUpwork,
  captureTaskMapDailySnapshot,
  getTaskMapDailySnapshot,
  getAvailableHistoryDates,
  executeTaskMapDailyRollover,
  getManilaDateStr,
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

    const todayManila = getManilaDateStr();
    const requestedDate = (dateQuery || todayManila).trim().split('T')[0];
    const isPastDate = requestedDate < todayManila;

    const shiftTokens = shiftQuery
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const isAllShifts =
      shiftTokens.length === 0 ||
      shiftTokens.includes('ALL') ||
      (shiftTokens.includes('DAY') && shiftTokens.includes('NOON') && shiftTokens.includes('NIGHT'));

    const activeShift = await getCurrentActiveShift();
    const currentShift = isAllShifts ? 'ALL' : (shiftQuery || activeShift);

    const cacheKey = `task_map:data:${requestedDate}:${currentShift}:${clientQuery || 'ALL'}:${searchQuery || 'ALL'}`;
    const cachedData = await getCache<any>(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    // If viewing a previous date, check if a preserved historical snapshot exists
    if (requestedDate !== todayManila) {
      const existingSnapshot = await getTaskMapDailySnapshot(requestedDate);
      if (existingSnapshot) {
        let tasks = existingSnapshot.tasks || [];
        let availablePool = existingSnapshot.availablePool || [];

        if (searchQuery) {
          const filterFn = (task: any) => {
            const titleMatch = (task.title || '').toLowerCase().includes(searchQuery);
            const clientMatch = (task.list?.name || '').toLowerCase().includes(searchQuery);
            const assigneeMatch = (task.assignee?.name || '').toLowerCase().includes(searchQuery) ||
              (task.assignees || []).some((a: any) => (a.name || '').toLowerCase().includes(searchQuery)) ||
              (task.progress?.maName || '').toLowerCase().includes(searchQuery) ||
              (task.progress?.userName || '').toLowerCase().includes(searchQuery);
            const statusMatch = (task.taskMap?.statuses || []).some((s: string) => s.toLowerCase().includes(searchQuery));
            return titleMatch || clientMatch || assigneeMatch || statusMatch;
          };
          tasks = tasks.filter(filterFn);
          availablePool = availablePool.filter(filterFn);
        }

        if (clientQuery && clientQuery !== 'ALL') {
          const clientFilterFn = (task: any) => {
            const listId = task.listId || task.list?.id;
            const listName = task.list?.name || '';
            return listId === clientQuery || listName.toLowerCase() === clientQuery.toLowerCase();
          };
          tasks = tasks.filter(clientFilterFn);
          availablePool = availablePool.filter(clientFilterFn);
        }

        const historyPayload = {
          success: true,
          isHistory: true,
          snapshotDate: requestedDate,
          currentDate: requestedDate,
          latestDate: todayManila,
          tasks,
          availablePool,
          allClients: existingSnapshot.allClients || [],
          options: existingSnapshot.options || [],
          shifts: existingSnapshot.shifts || [],
          statusCounts: existingSnapshot.statusCounts || {},
          overdueCount: existingSnapshot.overdueCount || 0,
          unassignedCount: existingSnapshot.unassignedCount || 0,
          activeShift: existingSnapshot.activeShift || 'DAY',
          currentShift,
          pmUsers: existingSnapshot.pmUsers || [],
          allUsers: existingSnapshot.allUsers || [],
          shiftUsers: existingSnapshot.shiftUsers || [],
          activeUpworkSessions: existingSnapshot.activeUpworkSessions || [],
          upworkClients: existingSnapshot.upworkClients || [],
          maActiveSessions: existingSnapshot.maActiveSessions || {},
        };
        await setCache(cacheKey, historyPayload, 3600);
        return res.json(historyPayload);
      }
    }

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
            checklists: {
              where: { name: { equals: 'Audit', mode: 'insensitive' } },
              include: { items: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        checklists: {
          where: { name: { equals: 'Audit', mode: 'insensitive' } },
          include: { items: true },
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

    // Options and Shift configs: filter out obsolete static Upwork options & internal client tags
    const rawOptions = await getStatusOptions();
    const options = rawOptions.filter((opt) => {
      const up = opt.label.toUpperCase().trim();
      return (
        up !== 'UPWORK ACTIVE' &&
        !up.startsWith('UPWORK |') &&
        !up.startsWith('UPWORK|') &&
        !up.startsWith('UPWORK_CLIENT:') &&
        !up.startsWith('UPWORK_PROJECT_CLIENT:')
      );
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
        team: { select: { id: true, name: true } },
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
      const auditShiftKeys = Array.from(new Set(shiftTokens.map(fromTaskMapShiftKey)));
      const activeShiftConfigs = await (prisma as any).auditShiftConfig.findMany({
        where: { shiftKey: { in: auditShiftKeys }, isActive: true },
      });
      for (const cfg of activeShiftConfigs) {
        (cfg.auditorIds || []).forEach((id: string) => shiftAuditorIdSet.add(id.trim()));
        (cfg.memberIds || []).forEach((id: string) => shiftMemberIdSet.add(id.trim()));
        (cfg.memberNames || []).forEach((n: string) => shiftMemberNameSet.add(n.trim().toLowerCase()));
        (cfg.auditorNames || []).forEach((n: string) => shiftAuditorNameSet.add(n.trim().toLowerCase()));
      }
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

      // Check active Upwork status, session and sheet progress
      let upworkStartedAt: string | null = null;
      let upworkSession: any = null;
      let reviewsList = mapRecord.pmReviews;
      if (typeof reviewsList === 'string') {
        try { reviewsList = JSON.parse(reviewsList); } catch { reviewsList = []; }
      }
      if (!Array.isArray(reviewsList)) reviewsList = [];

      const upworkStatus = (mapRecord.statuses || []).find(s => s.toUpperCase().startsWith('UPWORK'));
      if (upworkStatus) {
        upworkSession = reviewsList.find((r: any) => r.type === 'UPWORK_SESSION' && r.active);
        upworkStartedAt = upworkSession?.startedAt || (mapRecord.updatedAt ? new Date(mapRecord.updatedAt).toISOString() : new Date().toISOString());
      }

      // Check sheet progress
      let progress: any = reviewsList.find((r: any) => r.type === 'SHEET_PROGRESS') || null;

      const clientOrListName = `${task.list?.name || ''} ${progress?.client || ''}`.toLowerCase();
      const isLauren = clientOrListName.includes('lauren');

      // Restriction for Lauren (project-based): strictly only Upwork if manually marked as Upwork on TaskMap!
      if (isLauren && !upworkStatus) {
        upworkSession = null;
        if (progress) {
          progress = { ...progress, isUpwork: false };
        }
      }

      // If Upwork session is recorded in reviewsList even without explicit UPWORK substatus
      if (!upworkSession && (!isLauren || upworkStatus)) {
        upworkSession = reviewsList.find((r: any) => r.type === 'UPWORK_SESSION' && r.active) || null;
        if (upworkSession) {
          upworkStartedAt = upworkSession.startedAt || (mapRecord.updatedAt ? new Date(mapRecord.updatedAt).toISOString() : new Date().toISOString());
        }
      }

      // If sheet progress indicates Upwork and task is currently in progress (no timeOut)
      if (progress?.isUpwork && !progress?.timeOut && !upworkSession && (!isLauren || upworkStatus)) {
        upworkStartedAt = progress.updatedAt || new Date().toISOString();
        upworkSession = {
          taskId: task.id,
          taskTitle: task.title,
          userId: task.assigneeId || '',
          userName: progress.maName || 'Team Member',
          pmName: 'UPWORK',
          clientName: progress.client,
          startedAt: upworkStartedAt,
        };
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
        progress,
      };
    });

    // Filter by search query if present
    const searchedTasks = enrichedTasks.filter((task: any) => {
      if (!searchQuery) return true;
      const titleMatch = task.title.toLowerCase().includes(searchQuery);
      const clientMatch = (task.list?.name || '').toLowerCase().includes(searchQuery);
      const assigneeMatch = (task.assignee?.name || '').toLowerCase().includes(searchQuery) ||
        (task.assignees || []).some((a: any) => (a.name || '').toLowerCase().includes(searchQuery)) ||
        (task.progress?.maName || '').toLowerCase().includes(searchQuery) ||
        (task.progress?.userName || '').toLowerCase().includes(searchQuery);
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
    // Holds Pending, Revision, Waiting, and On-hold tasks.
    // Excludes recurring, daily, weekly, and monthly tasks.
    const isAvailableTaskStatus = (t: any) => {
      const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      const mapStatuses = (t.taskMap?.statuses || []).map((x: string) =>
        x.trim().toUpperCase().replace(/[\s_-]+/g, '')
      );

      // Exclude recurring, daily, weekly, monthly, and CRM/Waiting tasks
      const isExcluded =
        s === 'WAITING' ||
        s.includes('WAITING') ||
        s === 'CRM' ||
        s.includes('CRM') ||
        s === 'DAILY' ||
        s.includes('DAILY') ||
        s === 'WEEKLY' ||
        s.includes('WEEKLY') ||
        s === 'MONTHLY' ||
        s.includes('MONTHLY') ||
        s === 'RECURRING' ||
        s.includes('RECURRING') ||
        !!t.recurringConfig ||
        mapStatuses.some((st: string) =>
          ['WAITING', 'CRM', 'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING'].includes(st) ||
          st.includes('WAITING') ||
          st.includes('CRM') ||
          st.includes('DAILY') ||
          st.includes('WEEKLY') ||
          st.includes('MONTHLY') ||
          st.includes('RECURRING')
        );

      if (isExcluded) return false;

      // Available tasks pool holds all non-closed, non-cadence workflow tasks
      // that are NOT currently claimed by an active live worker or queued to a user column by a PM.
      // Direct Assignment is removed so user columns start clean and empty.
      let reviewsList = t.taskMap?.pmReviews;
      if (typeof reviewsList === 'string') {
        try { reviewsList = JSON.parse(reviewsList); } catch { reviewsList = []; }
      }
      if (!Array.isArray(reviewsList)) reviewsList = [];

      const isLiveWorking = Boolean(
        t.progress?.maName &&
        !t.progress?.timeOut &&
        t.progress?.timeIn
      );
      const hasPmAssignment = reviewsList.some(
        (r: any) => r?.type === 'PM_ASSIGNMENT' && r?.assignedTo
      );

      if (isLiveWorking || hasPmAssignment) {
        return false;
      }

      return true;
    };

    const isTaskUrgent = (t: any) => {
      const p = (t.priority || '').toUpperCase();
      if (p === 'URGENT') return true;
      const customStatuses = t.taskMap?.statuses || [];
      if (customStatuses.some((cs: string) => cs.toUpperCase().includes('URGENT'))) return true;
      if ((t.tags || []).some((tag: any) => (tag?.name || tag || '').toUpperCase().includes('URGENT'))) return true;
      if ((t.title || '').toUpperCase().includes('[URGENT]')) return true;
      return false;
    };

    const isTaskHigh = (t: any) => (t.priority || '').toUpperCase() === 'HIGH';

    const isTaskOnHold = (t: any) => {
      const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      if (s === 'ONHOLD' || s.includes('HOLD')) return true;
      const customStatuses = t.taskMap?.statuses || [];
      return customStatuses.some((cs: string) => cs.toUpperCase().includes('HOLD'));
    };

    const availablePool = filteredTasks
      .filter((t: any) => {
        if (isClosedTask(t)) return false;
        return isAvailableTaskStatus(t);
      })
      .sort((a: any, b: any) => {
        // 0. On-hold tasks go to the MOST BOTTOM per user requirement
        const holdA = isTaskOnHold(a) ? 1 : 0;
        const holdB = isTaskOnHold(b) ? 1 : 0;
        if (holdA !== holdB) return holdA - holdB;

        const urgentA = isTaskUrgent(a) ? 1 : 0;
        const urgentB = isTaskUrgent(b) ? 1 : 0;
        if (urgentA !== urgentB) return urgentB - urgentA;

        const highA = isTaskHigh(a) ? 1 : 0;
        const highB = isTaskHigh(b) ? 1 : 0;
        if (highA !== highB) return highB - highA;

        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });

    // Don't show closed tasks on Task Map, but retain closed CRM tasks for the CRM board
    const openTasks = filteredTasks.filter((t: any) => {
      if (!isClosedTask(t)) return true;
      const s = (t.status || '').toUpperCase().trim();
      const mapStatuses = (t.taskMap?.statuses || []).map((x: string) => x.toUpperCase().trim());
      if (
        (s === 'CLOSED' || s === 'DONE') &&
        (mapStatuses.includes('CRM') ||
          mapStatuses.includes('SENT') ||
          mapStatuses.includes('OUTREACH SENT') ||
          mapStatuses.includes('CLIENT SENT') ||
          mapStatuses.includes('TOSEND') ||
          mapStatuses.includes('FOLLOWUP') ||
          mapStatuses.includes('OUTREACH'))
      ) {
        return true;
      }
      return false;
    });

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
    // Max continuous duration for an active Upwork session before auto-expiring stale/abandoned timers
    const MAX_UPWORK_SESSION_MS = 14 * 60 * 60 * 1000; // 14 hours
    const nowMs = Date.now();

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
      const hasTimeOut = Boolean(t.progress?.timeOut);
      const isSheetUpworkActive = Boolean(t.progress?.isUpwork && t.progress?.timeIn && !hasTimeOut);
      const isSessionActive = Boolean(
        !hasTimeOut && (t.upworkSession?.active === true || isSheetUpworkActive)
      );

      // ONLY count as live when NOT timed out and there is an actively running session or sheet clock-in
      if (!hasTimeOut && (isSheetUpworkActive || (isSessionActive && (upworkTag || t.upworkSession?.active)))) {
        const startedAt = t.upworkStartedAt || (t.taskMap?.updatedAt ? new Date(t.taskMap.updatedAt).toISOString() : new Date().toISOString());
        const startedMs = new Date(startedAt).getTime();

        // Stale check: If timer has run past max shift window (14h), auto-expire from Redis and skip
        if (!isNaN(startedMs) && (nowMs - startedMs > MAX_UPWORK_SESSION_MS)) {
          if (isRedisReady()) {
            redis.hdel('task_map:upwork_active', t.id).catch(() => { });
          }
          continue;
        }

        let pmName = 'UPWORK';
        if (upworkTag) {
          const m = upworkTag.match(/^UPWORK\s*\|\s*(.+)$/i);
          if (m && m[1]) {
            pmName = m[1].trim().toUpperCase();
          } else if (upworkTag.toUpperCase().includes('ACTIVE')) {
            pmName = 'Active';
          }
        } else if (t.progress?.client) {
          pmName = String(t.progress.client).toUpperCase();
        }

        const rawName = t.progress?.maName || t.upworkSession?.userName || t.assignee?.name || (t.assignees && t.assignees[0]?.name) || t.creator?.name || '';
        const cleanName = rawName.includes('@') ? rawName.split('@')[0] : rawName;
        const userName = (pmName && pmName !== 'General' && pmName !== 'Active' && pmName !== 'UPWORK') ? pmName : (cleanName || 'Team Member');
        const userId = t.upworkSession?.userId || t.assigneeId || (t.assignees && t.assignees[0]?.id) || '';

        const sessionItem = {
          taskId: t.id,
          taskTitle: t.title,
          userId,
          userName: t.progress?.maName || userName,
          pmName,
          startedAt,
        };
        activeUpworkSessions.push(sessionItem);

        if (isRedisReady()) {
          redis.hset('task_map:upwork_active', t.id, JSON.stringify(sessionItem)).catch(() => { });
        }
      } else if (hasTimeOut) {
        // If task has a recorded Time Out, ensure it is completely purged from Redis
        if (isRedisReady()) {
          redis.hdel('task_map:upwork_active', t.id).catch(() => { });
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

    const upworkClients = await getUpworkClients();
    const upworkProjectClients = await getUpworkProjectClients();

    let maActiveSessions: Record<string, any> = {};
    if (isRedisReady()) {
      try {
        const rawMaMap = await redis.hgetall('task_map:ma_active_sessions');
        if (rawMaMap) {
          for (const [k, v] of Object.entries(rawMaMap)) {
            try { maActiveSessions[k] = JSON.parse(v); } catch { }
          }
        }
      } catch { }
    }

    // Ensure any open live session from task progress is present in maActiveSessions
    // (This guarantees that when an MA is working on an Admin task that is hidden by default,
    // their active session is available to render the General Task block with their admin client/task details)
    for (const t of tasks as any[]) {
      const rec = recordsMap.get(t.id);
      let reviewsList = rec?.pmReviews;
      if (typeof reviewsList === 'string') {
        try { reviewsList = JSON.parse(reviewsList); } catch { reviewsList = []; }
      }
      const sheetProg = Array.isArray(reviewsList)
        ? reviewsList.find((r: any) => r.type === 'SHEET_PROGRESS')
        : null;
      if (sheetProg?.maName && sheetProg.timeIn && !sheetProg.timeOut && !sheetProg.isMissingTime) {
        const maKey = sheetProg.maName.toLowerCase().trim();
        if (!maActiveSessions[maKey]) {
          maActiveSessions[maKey] = {
            maName: sheetProg.maName,
            taskId: t.id,
            timeIn: sheetProg.timeIn,
            timeOut: null,
            client: sheetProg.client || t.list?.name || 'General',
            taskName: sheetProg.taskDeliverables || t.title || 'No task inputted',
            date: sheetProg.date || todayManila,
            status: sheetProg.status || 'In progress',
            isUpwork: Boolean(sheetProg.isUpwork),
            rowNumber: sheetProg.sheetRow,
            active: true,
          };
        }
      }
    }

    const snapshotPayload = {
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
      pmUsers,
      allUsers,
      shiftUsers,
      activeUpworkSessions,
      upworkClients,
      upworkProjectClients,
      maActiveSessions,
    };

    if (isPastDate) {
      await captureTaskMapDailySnapshot(requestedDate, snapshotPayload, (req as any).user?.id || 'system');
    }

    const responsePayload = {
      success: true,
      isHistory: isPastDate,
      snapshotDate: isPastDate ? requestedDate : undefined,
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
      currentDate: requestedDate,
      latestDate: todayManila,
      pmUsers,
      allUsers,
      shiftUsers,
      activeUpworkSessions,
      upworkClients,
      upworkProjectClients,
      maActiveSessions,
    };

    // Cache in Redis: 15 seconds for today (protects against thundering herd socket storms), 3600 seconds for historical dates
    await setCache(cacheKey, responsePayload, isPastDate ? 3600 : 15);

    res.json(responsePayload);
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
      return (
        up !== 'UPWORK ACTIVE' &&
        !up.startsWith('UPWORK |') &&
        !up.startsWith('UPWORK|') &&
        !up.startsWith('UPWORK_CLIENT:') &&
        !up.startsWith('UPWORK_PROJECT_CLIENT:')
      );
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

    // Substatus history on comment section of task
    const oldNorm = (oldStatuses || []).slice().sort().join(', ');
    const newNorm = (statuses || []).slice().sort().join(', ');
    if (oldNorm !== newNorm) {
      try {
        const actorName = user?.name || user?.email || 'User';
        let commentText = '';
        if (statuses.length === 0 && oldStatuses.length > 0) {
          commentText = `**Sub-status cleared** (was "${oldStatuses.join(', ')}") by ${actorName}`;
        } else if (statuses.length > 0) {
          const oldPart = oldStatuses.length > 0 ? ` (was "${oldStatuses.join(', ')}")` : '';
          commentText = `**Sub-status updated**: "${statuses.join(', ')}"${oldPart} by ${actorName}`;
        }

        if (commentText) {
          const authorId = user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id;
          if (authorId) {
            const comment = await prisma.taskComment.create({
              data: {
                taskId: id,
                userId: authorId,
                content: `<p>${commentText}</p>`,
              },
              include: {
                user: { select: { id: true, name: true, email: true, avatarUrl: true } },
              },
            });

            const redisCommentKey = `comments:list:${id}`;
            if (isRedisReady()) {
              redis.del(redisCommentKey).catch(() => { });
            }
            invalidateCache(`task:activities:${id}`).catch(() => { });

            const activity = {
              id: `act-${Date.now()}`,
              commentId: comment.id,
              type: 'comment',
              author: user?.name || 'Someone',
              text: commentText,
              date: new Date().toISOString(),
              user: comment.user,
              parentCommentId: null,
              subtaskId: null,
            };

            io.emit('task:comment_added', { taskId: id, comment, activity, subtaskId: null });
            io.emit('task_activity', { taskId: id, activity });
          }
        }
      } catch (commentErr) {
        logger.warn({ commentErr }, 'Failed to record substatus change in task comments');
      }
    }

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
    const { assigneeId, mode = 'QUEUE' } = req.body;
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

    const record = await getOrCreateTaskMapRecord(id);
    let reviewsList = record.pmReviews;
    if (typeof reviewsList === 'string') {
      try { reviewsList = JSON.parse(reviewsList); } catch { reviewsList = []; }
    }
    if (!Array.isArray(reviewsList)) reviewsList = [];
    const existingPmAssignment = reviewsList.find((r: any) => r?.type === 'PM_ASSIGNMENT' && r?.assignedTo === assigneeId);

    // Guard: If task is already assigned to this user and has matching PM assignment mode, return early
    const isAlreadyAssigned =
      assigneeId &&
      (currentTask.assigneeId === assigneeId ||
        (currentTask.assignees || []).some((a) => a.id === assigneeId)) &&
      existingPmAssignment &&
      existingPmAssignment.mode === mode;
    if (isAlreadyAssigned) {
      return res.json({
        success: true,
        task: currentTask,
        taskMap: record,
      });
    }

    // Guard: If task is already unassigned and request is to unassign, return early only if already properly in available pool
    const isAlreadyUnassigned = !assigneeId && !currentTask.assigneeId && (currentTask.assignees || []).length === 0;
    if (isAlreadyUnassigned) {
      const hasAvailableStatus = (record.statuses || []).some((s: string) => s.toUpperCase() === 'AVAILABLE TASK');
      if (hasAvailableStatus && record.handedOver) {
        return res.json({
          success: true,
          task: currentTask,
          taskMap: record,
        });
      }
    }

    // Prepare update data
    const updateData: any = {};
    const currentStatusUpper = (currentTask.status || '').toUpperCase().trim();
    const isCadenceTask = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(currentStatusUpper);

    if (assigneeId) {
      const targetUser = await prisma.user.findUnique({
        where: { id: assigneeId },
        select: { id: true, name: true, roles: true, systemRole: true },
      });

      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found' });
      }

      updateData.assigneeId = assigneeId;
      updateData.assignees = { set: [{ id: assigneeId }] };
      if (mode === 'IN_PROGRESS' && !isCadenceTask) {
        updateData.status = 'IN PROGRESS';
      } else if (!currentTask.status) {
        updateData.status = 'Pending';
      }
    } else {
      updateData.assigneeId = null;
      updateData.assignees = { set: [] };
      // Cadence tasks (DAILY, WEEKLY, MONTHLY) strictly preserve their status.
      // Active tasks returned to the pool also preserve their status without being forced to PENDING.
      if (!isCadenceTask) {
        updateData.status = currentTask.status || 'Pending';
      }
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
    let newStatuses = record.statuses || [];
    let reviewsModified = false;
    let handedOver = record.handedOver;

    if (assigneeId) {
      newStatuses = newStatuses.filter((s) => {
        const up = s.toUpperCase().replace(/[\s_-]+/g, '');
        return up !== 'AVAILABLETASK' && up !== 'PENDING' && up !== 'REVISION' && up !== 'INREVIEW' && up !== 'TOREVIEW' && up !== 'HANDOVER';
      });
      handedOver = false;

      // Record explicit PM assignment so task appears in that user's column
      reviewsList = reviewsList.filter((r: any) => r?.type !== 'PM_ASSIGNMENT');
      reviewsList.push({
        type: 'PM_ASSIGNMENT',
        assignedTo: assigneeId,
        assignedBy: user.id,
        assignedByName: user.name || user.email,
        mode: mode || 'QUEUE',
        assignedAt: new Date().toISOString(),
      });
      reviewsModified = true;

      // If assigning to a different user, close any active Upwork session for the previous assignee
      if (currentTask.assigneeId && currentTask.assigneeId !== assigneeId) {
        for (const r of reviewsList) {
          if (r.type === 'UPWORK_SESSION' && r.active) {
            r.active = false;
            r.stoppedAt = new Date().toISOString();
            reviewsModified = true;
          }
        }
        if (isRedisReady()) {
          redis.hdel('task_map:upwork_active', id).catch(() => {});
        }
      }
    } else {
      // Unassigned back to available pool
      handedOver = true;
      if (!newStatuses.some((s) => s.toUpperCase() === 'AVAILABLE TASK')) {
        newStatuses.push('Available Task');
      }
      newStatuses = newStatuses.filter((s) => {
        const up = s.toUpperCase().replace(/[\s_-]+/g, '');
        return !up.startsWith('UPWORK');
      });

      // Clear PM assignment when returning to pool
      reviewsList = reviewsList.filter((r: any) => r?.type !== 'PM_ASSIGNMENT');
      reviewsModified = true;

      // Close any active Upwork session and complete any unclosed sheet session
      for (const r of reviewsList) {
        if (r.type === 'UPWORK_SESSION' && r.active) {
          r.active = false;
          r.stoppedAt = new Date().toISOString();
          reviewsModified = true;
        }
        if (r.type === 'SHEET_PROGRESS' && r.timeIn && !r.timeOut) {
          try {
            r.timeOut = new Intl.DateTimeFormat('en-US', {
              timeZone: 'Asia/Manila',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            }).format(new Date());
            reviewsModified = true;
          } catch {}
        }
      }
      if (isRedisReady()) {
        redis.hdel('task_map:upwork_active', id).catch(() => {});
      }
    }

    const updateMapRecordPayload: any = { statuses: newStatuses, handedOver };
    if (reviewsModified) {
      updateMapRecordPayload.pmReviews = reviewsList;
    }
    const updatedRecord = await updateTaskMapRecord(id, updateMapRecordPayload);

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

      await invalidateCache('task_map:all', `task:${id}`).catch(() => { });
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

      await invalidateCache('task_map:all', `task:${id}`).catch(() => { });
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
    const { taskId, shift, isDaily, fromDate, toDate } = req.body;
    const user = (req as any).user;

    if (isDaily) {
      const result = await executeTaskMapDailyRollover({
        fromDate,
        toDate,
        actorId: user?.id || 'system',
      });
      return res.json(result);
    }

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

    await invalidateCache('task_map:all').catch(() => { });
    io.emit('task_map:updated');
    res.json({ success: true, rolledCount, nextShift });
  } catch (error: any) {
    logger.error({ error }, 'Error executing rollover');
    res.status(500).json({ error: 'Failed to execute rollover' });
  }
};

/**
 * Daily Rollover (History Making & Shift Date Advancement)
 */
export const runDailyRollover = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate, retainCurrent } = req.body || {};
    const user = (req as any).user;

    const fromDateClean = (fromDate || getManilaDateStr()).trim().split('T')[0];

    // If retainCurrent is true or undefined, snapshot from existing snapshot or capture
    let snapshotPayload: any = null;
    if (retainCurrent !== false) {
      const existing = await getTaskMapDailySnapshot(fromDateClean);
      if (existing) {
        snapshotPayload = existing;
      }
    }

    const result = await executeTaskMapDailyRollover({
      fromDate: fromDateClean,
      toDate,
      actorId: user?.id || 'system',
      snapshotPayload,
    });

    res.json(result);
  } catch (error: any) {
    logger.error({ error }, 'Error executing daily rollover');
    res.status(500).json({ error: 'Failed to execute daily rollover' });
  }
};

/**
 * Get all dates that have historical snapshots in the journal
 */
export const getHistoryDates = async (req: Request, res: Response) => {
  try {
    const dates = await getAvailableHistoryDates();
    const todayManila = getManilaDateStr();
    const latestDate = dates[0] || todayManila;
    res.json({
      success: true,
      dates,
      currentDate: todayManila,
      latestDate,
    });
  } catch (error: any) {
    logger.error({ error }, 'Error fetching history dates');
    res.status(500).json({ error: 'Failed to fetch history dates' });
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
    await invalidateCache('task_map:all', `task:${id}`).catch(() => { });
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

/**
 * Get configured Upwork clients
 */
export const getUpworkClientsHandler = async (req: Request, res: Response) => {
  try {
    const clients = await getUpworkClients();
    const projectClients = await getUpworkProjectClients();
    res.json({ success: true, clients, projectClients });
  } catch (error: any) {
    logger.error({ error }, 'Error getting upwork clients');
    res.status(500).json({ error: 'Failed to get upwork clients' });
  }
};

/**
 * Update Upwork clients configuration (add, remove, toggle, or set full list)
 */
export const updateUpworkClientsHandler = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const isPmOrAdmin = await canUserSetAssignees(user?.id);
    if (!isPmOrAdmin) {
      return res.status(403).json({
        error: 'Only Project Managers and Admins can configure Upwork clients',
      });
    }

    const { clientName, isUpwork, isProjectBased, action, clients, projectClients } = req.body || {};
    let updatedClients: string[] = [];
    let updatedProjectClients: string[] = [];

    // Helper to check if user is Aaron or system Admin
    const email = (user?.email || '').toLowerCase().trim();
    const isAaron = email.includes('aaron') || user?.id === 'bc74d7a0-e1e0-4a18-bf59-4e733fa25c92' || user?.systemRole === 'ADMIN';

    // Marking / adding / removing Upwork clients is strictly limited to Aaron!
    const isModifyingUpworkList = Array.isArray(clients) || action === 'add' || action === 'remove' || (isUpwork !== undefined && isProjectBased === undefined);
    if (isModifyingUpworkList && !isAaron) {
      return res.status(403).json({
        error: 'Only Aaron can add or remove Upwork clients',
      });
    }

    if (Array.isArray(clients)) {
      updatedClients = await setUpworkClients(clients);
    }
    if (Array.isArray(projectClients)) {
      updatedProjectClients = await setUpworkProjectClients(projectClients);
    }

    if (clientName) {
      const cleanName = String(clientName).trim();
      const current = await getUpworkClients();
      const exists = current.some((c) => c.toLowerCase() === cleanName.toLowerCase());

      if (isProjectBased !== undefined) {
        // Enforce: Project-Based or Hourly Rate mode can ONLY be toggled if the client is an Upwork client!
        const willBeUpwork = isUpwork !== undefined ? Boolean(isUpwork) : exists;
        if (!willBeUpwork) {
          return res.status(400).json({
            error: 'Project-Based or Hourly Rate mode can only be configured for Upwork clients. Only Aaron can designate new Upwork clients.',
          });
        }

        if (!exists) {
          if (!isAaron) {
            return res.status(403).json({
              error: 'Only Aaron can designate new Upwork clients',
            });
          }
          updatedClients = await addUpworkClient(cleanName);
        } else {
          updatedClients = current;
        }

        if (isProjectBased) {
          updatedProjectClients = await addUpworkProjectClient(cleanName);
        } else {
          updatedProjectClients = await removeUpworkProjectClient(cleanName);
        }
      } else {
        // Modifying Upwork membership (add/remove) - strictly Aaron
        if (!isAaron) {
          return res.status(403).json({
            error: 'Only Aaron can add or remove Upwork clients',
          });
        }

        const shouldBeUpwork = isUpwork !== undefined ? Boolean(isUpwork) : (action === 'add' ? true : action === 'remove' ? false : !exists);

        if (shouldBeUpwork) {
          updatedClients = await addUpworkClient(cleanName);
          if (isProjectBasedUpwork(cleanName)) {
            updatedProjectClients = await addUpworkProjectClient(cleanName);
          } else {
            updatedProjectClients = await getUpworkProjectClients();
          }
        } else {
          updatedClients = await removeUpworkClient(cleanName);
          updatedProjectClients = await removeUpworkProjectClient(cleanName);
        }
      }
    } else {
      if (!Array.isArray(clients) && !Array.isArray(projectClients)) {
        return res.status(400).json({ error: 'clientName, clients, or projectClients required' });
      }
      if (!Array.isArray(clients)) updatedClients = await getUpworkClients();
      if (!Array.isArray(projectClients)) updatedProjectClients = await getUpworkProjectClients();
    }

    io.emit('upwork:clients_updated', { clients: updatedClients, projectClients: updatedProjectClients });
    res.json({ success: true, clients: updatedClients, projectClients: updatedProjectClients });
  } catch (error: any) {
    logger.error({ error }, 'Error updating upwork clients');
    res.status(500).json({ error: 'Failed to update upwork clients' });
  }
};

/**
 * Get active Upwork sessions across the workspace
 */
export const getActiveUpworkSessionsHandler = async (req: Request, res: Response) => {
  try {
    const MAX_UPWORK_SESSION_MS = 14 * 60 * 60 * 1000; // 14 hours
    const nowMs = Date.now();
    let activeUpworkSessions: any[] = [];

    // Fetch active MA sessions to cross-verify if an MA clocked out or is non-Upwork
    let maSessionsByName: Record<string, any> = {};
    if (isRedisReady()) {
      try {
        const rawMaMap = await redis.hgetall('task_map:ma_active_sessions').catch(() => ({}));
        for (const [k, v] of Object.entries(rawMaMap || {})) {
          try { maSessionsByName[k.toLowerCase().trim()] = JSON.parse(v as string); } catch {}
        }
      } catch {}
    }

    const upworkClientsList = await getUpworkClients();
    const upworkProjectClientsList = await getUpworkProjectClients();

    if (isRedisReady()) {
      try {
        const rawMap = await redis.hgetall('task_map:upwork_active');
        if (rawMap && Object.keys(rawMap).length > 0) {
          const parsed = Object.values(rawMap).map((val) => JSON.parse(val));
          for (const s of parsed) {
            const startedMs = s.startedAt ? new Date(s.startedAt).getTime() : NaN;
            // Stale check: prune sessions running for > 14 hours
            if (!isNaN(startedMs) && (nowMs - startedMs > MAX_UPWORK_SESSION_MS)) {
              logger.warn({ taskId: s.taskId, userName: s.userName, startedAt: s.startedAt }, '[Upwork] Pruning stale Redis session (> 14h)');
              if (isRedisReady()) {
                await redis.hdel('task_map:upwork_active', s.taskId).catch(() => { });
              }
              continue;
            }
            const name = `${s.clientName || ''} ${s.pmName || ''} ${s.taskTitle || ''}`.toLowerCase();
            // Lauren is project-based: only allowed if explicitly confirmed with manual UPWORK tag or in configured upwork clients
            const isConfiguredUpwork = upworkClientsList.some((c) => c.toLowerCase() === (s.clientName || '').toLowerCase() || c.toLowerCase() === (s.pmName || '').toLowerCase());
            if (name.includes('lauren') && !s.isManuallyMarkedUpwork && !isConfiguredUpwork) {
              continue;
            }

            const isProject = Boolean(
              s.isProjectBased ||
              isProjectBasedUpwork(name) ||
              upworkProjectClientsList.some((c) => c.toLowerCase() === (s.clientName || '').toLowerCase() || c.toLowerCase() === (s.pmName || '').toLowerCase())
            );
            s.isProjectBased = isProject;

            // Cross-verify with MA's current active session in sheet:
            // If MA's latest schedule says they are clocked out, active === false, or isUpwork === false,
            // then this Redis session is stale and MUST be pruned!
            const maClean = (s.userName || '').toLowerCase().trim();
            if (maClean && maSessionsByName[maClean]) {
              const currentMa = maSessionsByName[maClean];
              if (currentMa.timeOut || currentMa.active === false || currentMa.isUpwork === false) {
                if (isRedisReady()) {
                  await redis.hdel('task_map:upwork_active', s.taskId).catch(() => {});
                }
                continue;
              }
            }

            activeUpworkSessions.push(s);
          }
        }
      } catch (err) {
        logger.warn({ err }, '[Upwork] Failed reading Redis active sessions');
      }
    }

    // Also verify open tasks in PostgreSQL with active sessions
    try {
      const openUpworkRecords = await prisma.taskMapRecord.findMany({
        where: {
          task: {
            status: { notIn: ['CLOSED', 'DONE', 'Complete', 'Completed', 'Closed', 'Done', 'KYC', 'PIN BOARD', 'PINBOARD'] },
          },
        },
        select: {
          taskId: true,
          statuses: true,
          pmReviews: true,
          updatedAt: true,
          task: {
            select: {
              title: true,
              assignee: { select: { name: true } },
              list: { select: { name: true } },
            },
          },
        },
      });

      for (const rec of openUpworkRecords) {
        const upworkTag = (rec.statuses || []).find((s) => s.toUpperCase().startsWith('UPWORK'));
        let pmReviewsList = rec.pmReviews || [];
        if (typeof pmReviewsList === 'string') {
          try { pmReviewsList = JSON.parse(pmReviewsList); } catch { pmReviewsList = []; }
        }
        const activeReview: any = Array.isArray(pmReviewsList)
          ? pmReviewsList.find((r: any) => r.type === 'UPWORK_SESSION' && r.active)
          : null;
        const sheetProgress: any = Array.isArray(pmReviewsList)
          ? pmReviewsList.find((r: any) => r.type === 'SHEET_PROGRESS')
          : null;

        // Only evaluate tasks that are actually related to Upwork (has UPWORK tag, active UPWORK_SESSION, or sheetProgress isUpwork)
        // Normal sheet progress tasks (Clockify, etc.) must NEVER be closed or have a timeout forced by the Upwork cleaner!
        if (!upworkTag && !activeReview && !sheetProgress?.isUpwork) {
          continue;
        }

        // Restriction for Lauren: Lauren is project-based; only mark as Upwork if explicitly tagged on TaskMap or in configured upwork clients!
        const clientOrListName = `${rec.task?.list?.name || ''} ${activeReview?.clientName || ''} ${activeReview?.pmName || ''}`.toLowerCase();
        const isLauren = clientOrListName.includes('lauren');
        const isConfiguredUpwork = upworkClientsList.some((c) => c.toLowerCase() === (rec.task?.list?.name || '').toLowerCase() || c.toLowerCase() === (activeReview?.clientName || '').toLowerCase());
        if (isLauren && !upworkTag && !isConfiguredUpwork) {
          if (isRedisReady()) {
            redis.hdel('task_map:upwork_active', rec.taskId).catch(() => { });
          }
          continue;
        }

        let shouldCloseSheetProgress = false;
        const todayManila = getManilaDateStr();

        // 2. Date check: if sheet progress is Upwork, has a date, and it's not today's operational date, it's historical
        if (sheetProgress?.isUpwork && sheetProgress?.date && sheetProgress.date !== todayManila) {
          shouldCloseSheetProgress = true;
        }

        // 3. Check stale session in DB review or sheetProgress (> 14h)
        if (activeReview?.startedAt) {
          const startedMs = new Date(activeReview.startedAt).getTime();
          if (!isNaN(startedMs) && (nowMs - startedMs > MAX_UPWORK_SESSION_MS)) {
            logger.warn({ taskId: rec.taskId, startedAt: activeReview.startedAt }, '[Upwork] Pruning stale DB review session (> 14h)');
            activeReview.active = false;
            activeReview.stoppedAt = activeReview.stoppedAt || new Date().toISOString();
            await updateTaskMapRecord(rec.taskId, { pmReviews: pmReviewsList }).catch(() => { });
            if (isRedisReady()) {
              await redis.hdel('task_map:upwork_active', rec.taskId).catch(() => { });
            }
            activeUpworkSessions = activeUpworkSessions.filter((s) => s.taskId !== rec.taskId);
            continue;
          }
        }

        if (sheetProgress?.isUpwork && sheetProgress?.updatedAt) {
          const startedMs = new Date(sheetProgress.updatedAt).getTime();
          if (!isNaN(startedMs) && (nowMs - startedMs > MAX_UPWORK_SESSION_MS)) {
            shouldCloseSheetProgress = true;
          }
        }

        const isLiveActive = activeReview?.active || (sheetProgress?.isUpwork && !sheetProgress?.timeOut);
        if (isLiveActive) {
          const alreadyInList = activeUpworkSessions.some((s) => s.taskId === rec.taskId);
          if (!alreadyInList) {
            let pmName = activeReview?.pmName || activeReview?.clientName || sheetProgress?.client || rec.task?.list?.name || 'UPWORK';
            if (upworkTag) {
              const m = upworkTag.match(/^UPWORK\s*\|\s*(.+)$/i);
              if (m && m[1]) pmName = m[1].trim().toUpperCase();
            }
            const userName = activeReview?.userName || sheetProgress?.maName || rec.task?.assignee?.name || pmName || 'Team Member';
            const startedAt = activeReview?.startedAt || sheetProgress?.updatedAt || rec.updatedAt.toISOString();

            // Strictly only close and set timeOut if sheetProgress is actually Upwork
            if (shouldCloseSheetProgress && sheetProgress?.isUpwork && !sheetProgress.timeOut) {
              sheetProgress.timeOut = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Manila',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              }).format(new Date());
              sheetProgress.isUpwork = false;
              if (activeReview) {
                activeReview.active = false;
                activeReview.stoppedAt = activeReview.stoppedAt || new Date().toISOString();
              }
              await updateTaskMapRecord(rec.taskId, { pmReviews: pmReviewsList }).catch(() => { });
              if (isRedisReady()) {
                await redis.hdel('task_map:upwork_active', rec.taskId).catch(() => { });
              }
              activeUpworkSessions = activeUpworkSessions.filter((s) => s.taskId !== rec.taskId);
              continue;
            }

            const isProject = Boolean(
              isProjectBasedUpwork(`${rec.task?.list?.name || pmName} ${rec.task?.title || ''}`) ||
              upworkProjectClientsList.some((c) => c.toLowerCase() === (rec.task?.list?.name || pmName).toLowerCase())
            );

            const sessionItem = {
              taskId: rec.taskId,
              taskTitle: rec.task?.title || 'Upwork Task',
              userId: rec.task?.assignee ? (rec.task as any).assigneeId : 'unassigned',
              userName,
              pmName,
              clientName: rec.task?.list?.name || pmName,
              timeIn: sheetProgress?.timeIn || null,
              date: sheetProgress?.date || null,
              startedAt,
              active: true,
              isManuallyMarkedUpwork: Boolean(upworkTag),
              isProjectBased: isProject,
            };
            activeUpworkSessions.push(sessionItem);

            if (isRedisReady()) {
              redis.hset('task_map:upwork_active', rec.taskId, JSON.stringify(sessionItem)).catch(() => { });
            }
          }
        } else {
          // Inactive session with no clock-in: ensure not in Redis
          if (isRedisReady()) {
            redis.hdel('task_map:upwork_active', rec.taskId).catch(() => { });
          }
        }
      }
    } catch (dbErr) {
      logger.warn({ dbErr }, 'Non-blocking error checking database open Upwork tasks');
    }

    res.json({ success: true, activeUpworkSessions });
  } catch (error: any) {
    logger.error({ error }, 'Error fetching active upwork sessions');
    res.status(500).json({ error: 'Failed to fetch active upwork sessions' });
  }
};

/**
 * Reset tasks in a column back to Available Tasks (or review queue for auditors)
 * POST /api/task-map/columns/:columnId/reset
 */
export const resetColumnTasksHandler = async (req: Request, res: Response) => {
  try {
    const { columnId } = req.params;
    const { type = 'BOARD' } = req.body || {};
    const user = (req as any).user;

    if (!user) return res.status(401).json({ error: 'Authentication required' });

    // Clean column ID (strip 'user-' prefix if present)
    const targetUserId = (columnId || '').replace(/^user-/, '').trim();
    if (!targetUserId) {
      return res.status(400).json({ error: 'Invalid column ID' });
    }

    if (type === 'AUDIT') {
      // Find tasks assigned to this auditor in review status
      const reviewTasks = await prisma.task.findMany({
        where: {
          assigneeId: targetUserId,
          status: { in: ['In Review', 'IN REVIEW', 'To review', 'TO REVIEW', 'Review', 'Checking', 'CHECKING', 'In Checking', 'IN CHECKING'] },
        },
        select: { id: true, title: true, listId: true, checklists: { include: { items: true } } },
      });

      for (const t of reviewTasks) {
        await prisma.task.update({
          where: { id: t.id },
          data: {
            assigneeId: null,
            status: 'To review',
            assignees: { set: [] },
          },
        });
        await updateTaskMapRecord(t.id, { statuses: [] });
        await invalidateCache(`task:${t.id}`, 'task_map:all', 'tasks:all');
      }

      await invalidateCache('task_map:all').catch(() => { });
    io.emit('task_map:updated');
      return res.json({
        success: true,
        count: reviewTasks.length,
        resetTaskIds: reviewTasks.map((t) => t.id),
      });
    }

    // Default: BOARD (MA shift column)
    const assignedTasks = await prisma.task.findMany({
      where: {
        assigneeId: targetUserId,
        status: { notIn: ['CLOSED', 'Closed', 'DONE', 'Done', 'COMPLETE', 'Completed'] },
      },
      select: { id: true, title: true, status: true, listId: true },
    });

    const resetTaskIds: string[] = [];
    for (const t of assignedTasks) {
      await prisma.task.update({
        where: { id: t.id },
        data: {
          assigneeId: null,
          assignees: { set: [] },
        },
      });
      const rec = await getOrCreateTaskMapRecord(t.id);
      const cleanedStatuses = (rec.statuses || []).filter(
        (s) => !['IN PROGRESS', 'In progress', 'In Progress'].includes(s)
      );
      if (!cleanedStatuses.includes('Available Task')) {
        cleanedStatuses.push('Available Task');
      }
      let revs = rec.pmReviews;
      if (typeof revs === 'string') {
        try { revs = JSON.parse(revs); } catch { revs = []; }
      }
      if (Array.isArray(revs)) {
        revs = revs.filter((r: any) => r?.type !== 'PM_ASSIGNMENT');
      } else {
        revs = [];
      }
      await updateTaskMapRecord(t.id, { statuses: cleanedStatuses, pmReviews: revs, handedOver: true });
      await invalidateCache(`task:${t.id}`, 'task_map:all', 'tasks:all');
      resetTaskIds.push(t.id);
    }

    await invalidateCache('task_map:all').catch(() => { });
    io.emit('task_map:updated');
    return res.json({
      success: true,
      count: resetTaskIds.length,
      resetTaskIds,
    });
  } catch (error: any) {
    logger.error({ error }, 'Error resetting column tasks');
    return res.status(500).json({ error: 'Failed to reset column tasks' });
  }
};

