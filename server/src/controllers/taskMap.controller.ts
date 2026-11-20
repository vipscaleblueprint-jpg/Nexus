import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { io } from '../server';
import { logger } from '../config/logger';
import { invalidateCache, getCache, setCache, getCacheGeneration, redis, isRedisReady, getMaActiveSessionsMap } from '../services/redisService';
import { isReviewStatus } from '../utils/auditChecklist';
import { canUserSetAssignees } from '../utils/assignPermission';
import { filterUsersByNotificationPreference } from '../utils/notificationPreferences';
import {
  evaluateTaskMapMovePermission,
  resolveEffectiveTaskMapOwnerId,
  TaskMapMoveAction,
  TaskMapMoveMode,
} from '../utils/taskMapPermissions';
import { isAuditorRole } from './auditShift.controller';
import {
  extractLaunchMeta,
  hasLaunchDateMarker,
  upsertTaskLaunchMeta,
  triggerLaunchReviewAlertIfNeeded,
} from '../services/launchMapService';
import {
  isWaitingMainStatus,
  getEffectiveWaitingSince,
  resolveWaitingSinceMap,
  getManilaCalendarDaysPassed,
  getCrmFollowUpRule,
  listPendingCrmFollowUps,
  respondToCrmFollowUp,
  acknowledgeCrmFollowUps,
  parseReviewsListSafe,
} from '../services/crmFollowUpService';
import {
  applyRevisionReturnToOriginalMa,
  isNonMaReviewerOnlyRole,
  upsertOriginalMaEntry,
} from '../services/auditWorkflowAutomation';
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
  resolveNextShiftDate,
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
  ADMIN_LIST_NAMES,
  isHiddenAdminOrInternalTask,
  isOnHoldStatus,
  cascadeParentOnHoldToSubtasks,
} from '../services/taskMapService';

// Closed status check matching Nexus conventions
const isClosedStatus = (status?: string | null) => {
  const s = (status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  return s === 'CLOSED' || s === 'DONE' || s === 'COMPLETE' || s === 'COMPLETED' || s === 'RESOLVED' || s === 'CANCELLED';
};

const CRM_TAG_SET = new Set([
  'CRM',
  'SENT',
  'SENT BUT WAITING',
  'SENTBUTWAITING',
  'WAITING',
  'OUTREACH SENT',
  'CLIENT SENT',
  'TO SEND',
  'TOSEND',
  'READY TO SEND',
  'READYTOSEND',
  'ASK CLIENT',
  'ASKCLIENT',
  'FOLLOW UP',
  'FOLLOWUP',
  'OUTREACH',
]);

const CLOSED_OR_EXCLUDED_STATUS_VARIANTS = [
  'KYC',
  'PIN BOARD',
  'PINBOARD',
  'CLOSED',
  'DONE',
  'COMPLETE',
  'COMPLETED',
  'RESOLVED',
  'CANCELLED',
];

const inFlightTaskMapQueries = new Map<string, Promise<any>>();

/**
 * Fetch all client lists residing under any "Client Dashboard" folder/space in PostgreSQL (cached briefly).
 */
async function fetchClientDashboardLists(): Promise<Array<{ id: string; name: string }>> {
  const clientListCacheKey = 'task_map:client_lists';
  const cached = await getCache<Array<{ id: string; name: string }>>(clientListCacheKey);
  if (cached) return cached;

  const gen = getCacheGeneration(clientListCacheKey);
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

  const map = new Map<string, { id: string; name: string }>();

  for (const f of clientDashboardFolders) {
    (f.lists || []).forEach((l) => map.set(l.id, { id: l.id, name: l.name }));
    for (const sub of f.subfolders || []) {
      (sub.lists || []).forEach((l) => map.set(l.id, { id: l.id, name: l.name }));
    }
  }

  for (const s of clientDashboardSpaces) {
    (s.lists || []).forEach((l) => map.set(l.id, { id: l.id, name: l.name }));
    for (const f of s.folders || []) {
      (f.lists || []).forEach((l) => map.set(l.id, { id: l.id, name: l.name }));
    }
  }

  for (const l of directClientLists) {
    map.set(l.id, { id: l.id, name: l.name });
  }

  const sorted = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  await setCache(clientListCacheKey, sorted, 60, gen);
  return sorted;
}

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

    const activeShift = await getCurrentActiveShift();
    const effectiveShiftStr = (shiftQuery || activeShift || 'ALL').toUpperCase();
    const shiftTokens = effectiveShiftStr
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const isAllShifts =
      shiftTokens.length === 0 ||
      shiftTokens.includes('ALL');

    const currentShift = isAllShifts ? 'ALL' : shiftTokens.join(',');

    const cacheKey = `task_map:data:${requestedDate}:${currentShift}:${clientQuery || 'ALL'}:${searchQuery || 'ALL'}`;
    const cacheGen = getCacheGeneration(cacheKey);
    const cachedData = await getCache<any>(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    const singleFlightKey = `${cacheKey}:${cacheGen}`;
    const existingInFlight = inFlightTaskMapQueries.get(singleFlightKey);
    if (existingInFlight) {
      const coalescedPayload = await existingInFlight;
      return res.json(coalescedPayload);
    }

    const computePromise = (async () => {
    // If viewing a previous date, check if a preserved historical snapshot exists
    if (requestedDate !== todayManila) {
      const existingSnapshot = await getTaskMapDailySnapshot(requestedDate);
      if (existingSnapshot) {
        let tasks = existingSnapshot.tasks || [];
        let availablePool = existingSnapshot.availablePool || [];

        // Hydrate metadata if snapshot was captured without full user/option/shift context
        let snapshotAllUsers = existingSnapshot.allUsers || [];
        let snapshotShiftUsers = existingSnapshot.shiftUsers || [];
        let snapshotPmUsers = existingSnapshot.pmUsers || [];
        let snapshotOptions = existingSnapshot.options || [];
        let snapshotShifts = existingSnapshot.shifts || [];

        const isLegacyBareSnapshot = snapshotAllUsers.length === 0;
        if (isLegacyBareSnapshot) {
          const [dbUsers, dbRawOptions, dbShifts] = await Promise.all([
            prisma.user.findMany({
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
            }),
            getStatusOptions(),
            getShiftConfigs(),
          ]);

          snapshotAllUsers = dbUsers;
          snapshotShiftUsers = dbUsers.map((u) => ({
            ...u,
            isAudit: isAuditorRole(u.roles),
          }));
          snapshotPmUsers = dbUsers.filter((u) => {
            if (u.systemRole === 'ADMIN') return true;
            const rolesStr = (u.roles || []).join(' ').toLowerCase();
            return rolesStr.includes('pm') || rolesStr.includes('project manager') || rolesStr.includes('team lead') || rolesStr.includes('senior');
          });
          snapshotOptions = dbRawOptions.filter((opt) => {
            const up = opt.label.toUpperCase().trim();
            return (
              up !== 'UPWORK ACTIVE' &&
              !up.startsWith('UPWORK |') &&
              !up.startsWith('UPWORK|') &&
              !up.startsWith('UPWORK_CLIENT:') &&
              !up.startsWith('UPWORK_PROJECT_CLIENT:')
            );
          });
          snapshotShifts = dbShifts;

          // Filter out non-Available-pool statuses from legacy snapshots that stored unfiltered unassigned tasks
          availablePool = availablePool.filter((t: any) => {
            const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
            const mapStatuses = (t.taskMap?.statuses || []).map((x: string) =>
              x.trim().toUpperCase().replace(/[\s_-]+/g, '')
            );
            if (isClosedStatus(s)) return false;
            return !(
              s === 'WAITING' || s.includes('WAITING') ||
              s === 'CRM' || s.includes('CRM') ||
              s === 'INREVIEW' || s === 'TOREVIEW' || s === 'REVIEW' ||
              s === 'CHECKING' || s === 'INCHECKING' ||
              s === 'DAILY' || s.includes('DAILY') ||
              s === 'WEEKLY' || s.includes('WEEKLY') ||
              s === 'MONTHLY' || s.includes('MONTHLY') ||
              s === 'RECURRING' || s.includes('RECURRING') ||
              Boolean(t.recurringConfig) ||
              mapStatuses.some((st: string) =>
                ['WAITING', 'CRM', 'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING', 'INREVIEW', 'TOREVIEW', 'CHECKING', 'INCHECKING'].includes(st)
              )
            );
          });
        }

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
          options: snapshotOptions,
          shifts: snapshotShifts,
          statusCounts: existingSnapshot.statusCounts || {},
          overdueCount: existingSnapshot.overdueCount || 0,
          unassignedCount: existingSnapshot.unassignedCount || 0,
          activeShift: existingSnapshot.activeShift || 'DAY',
          currentShift,
          pmUsers: snapshotPmUsers,
          allUsers: snapshotAllUsers,
          shiftUsers: snapshotShiftUsers,
          activeUpworkSessions: existingSnapshot.activeUpworkSessions || [],
          upworkClients: existingSnapshot.upworkClients || [],
          upworkProjectClients: existingSnapshot.upworkProjectClients || [],
          maActiveSessions: existingSnapshot.maActiveSessions || {},
        };
        await setCache(cacheKey, historyPayload, 3600, cacheGen);
        return historyPayload;
      }
    }

    // Fetch TaskMap records first so we know which (rare) closed tasks have active CRM workflow tags
    const records = await prisma.$queryRawUnsafe<TaskMapRecordData[]>(
      `SELECT * FROM "TaskMapRecord"`
    );
    const recordsMap = new Map<string, TaskMapRecordData>();
    const closedCrmCandidateTaskIds: string[] = [];
    for (const r of records) {
      recordsMap.set(r.taskId, r);
      const hasCrmTag = Array.isArray(r.statuses) && r.statuses.some((st) => CRM_TAG_SET.has((st || '').toUpperCase().trim()));
      if (hasCrmTag) {
        closedCrmCandidateTaskIds.push(r.taskId);
      }
    }

    const kycPinboardExclusion = ['KYC', 'PIN BOARD', 'PINBOARD'].map((s) => ({
      status: { equals: s, mode: 'insensitive' as const },
    }));
    const closedOrExcludedFilters = CLOSED_OR_EXCLUDED_STATUS_VARIANTS.map((s) => ({
      status: { equals: s, mode: 'insensitive' as const },
    }));

    // Fetch open tasks (plus the small set of closed CRM-tagged tasks) from PostgreSQL, omitting historical closed archive bloat
    const tasks = await prisma.task.findMany({
      where: {
        AND: [
          { NOT: { OR: kycPinboardExclusion } },
          closedCrmCandidateTaskIds.length > 0
            ? {
                OR: [
                  { NOT: { OR: closedOrExcludedFilters } },
                  { id: { in: closedCrmCandidateTaskIds } },
                ],
              }
            : { NOT: { OR: closedOrExcludedFilters } },
        ],
      },
      include: {
        list: {
          select: {
            id: true,
            name: true,
            folder: { select: { id: true, name: true } },
            statuses: {
              select: { name: true, color: true, groupName: true, order: true },
              orderBy: { order: 'asc' },
            },
          },
        },
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
        assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
        creator: { select: { id: true, name: true, email: true, avatarUrl: true } },
        subtasks: {
          where: { completed: false },
          include: {
            User: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
            assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
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

    // PM Users for Review queue and tag matching + DB teams & workspace roles
    const [allUsers, workspaceRoles, workspaceTeams] = await Promise.all([
      prisma.user.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          roles: true,
          teamId: true,
          team: {
            select: {
              id: true,
              name: true,
              color: true,
              teamRoles: { select: { id: true, name: true } },
            },
          },
          systemRole: true,
        },
        orderBy: { name: 'asc' },
      }),
      prisma.workspaceRole.findMany({
        select: { id: true, name: true, color: true },
        orderBy: { name: 'asc' },
      }),
      prisma.team.findMany({
        include: {
          teamRoles: { select: { id: true, name: true }, orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

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
      const auditShiftKeys = Array.from(
        new Set(
          shiftTokens.flatMap((token) => {
            const norm = token.trim().toUpperCase();
            if (norm === 'DAY' || norm === 'AM' || norm === 'MORNING') return ['AM', 'DAY', 'MORNING'];
            if (norm === 'NOON' || norm === 'PM_AFTERNOON' || norm === 'AFTERNOON') return ['PM_AFTERNOON', 'NOON', 'AFTERNOON'];
            if (norm === 'NIGHT' || norm === 'PM_NIGHT') return ['PM_NIGHT', 'NIGHT'];
            return [norm, fromTaskMapShiftKey(norm), toTaskMapShiftKey(norm)];
          })
        )
      );
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
        const uName = (u.name || '').trim().toLowerCase();
        if (!uName) return false;
        if (shiftMemberNameSet.has(uName) || shiftAuditorNameSet.has(uName)) {
          return true;
        }
        for (const token of [...shiftMemberNameSet, ...shiftAuditorNameSet]) {
          if (token && (uName.startsWith(`${token} `) || (token.length >= 3 && uName.includes(token)))) {
            return true;
          }
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

    const deriveDefaultMapStatuses = (rawStatus?: string | null, isAssignedToMember = false): string[] => {
      const statusKey = (rawStatus || '').toUpperCase().replace(/[\s_-]+/g, '');
      if (statusKey === 'CRM') return ['To send'];
      if (statusKey === 'WAITING') return ['Waiting'];
      if (statusKey === 'ONHOLD') return ['On-hold'];
      if (
        statusKey === 'INREVIEW' ||
        statusKey === 'TOREVIEW' ||
        statusKey === 'REVIEW' ||
        statusKey === 'CHECKING' ||
        statusKey === 'INCHECKING' ||
        statusKey === 'CLOSED' ||
        statusKey === 'DONE' ||
        statusKey === 'COMPLETE' ||
        statusKey === 'COMPLETED' ||
        statusKey === 'RESOLVED' ||
        statusKey === 'CANCELLED'
      ) {
        return [];
      }
      return isAssignedToMember ? [] : ['Available Task'];
    };

    const isSubtaskExcludedFromBoard = (st: any) => {
      const titleLower = (st.title || '').toLowerCase();
      if (titleLower.includes('--audit')) return true;
      const s = (st.status || (st.completed ? 'CLOSED' : 'PENDING')).toUpperCase().replace(/[\s_-]+/g, '');
      return st.completed || isClosedStatus(s);
    };

    // Build enriched task items + surface open subtasks as independent board items
    const enrichedTasks: any[] = [];
    for (const task of tasks as any[]) {
      let mapRecord = recordsMap.get(task.id);
      const taskHasAssignee = Boolean(
        task.assigneeId || (Array.isArray(task.assignees) && task.assignees.length > 0)
      );
      if (!mapRecord) {
        mapRecord = {
          id: '',
          taskId: task.id,
          subtaskId: null,
          statuses: deriveDefaultMapStatuses(task.status, taskHasAssignee),
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
      } else if (
        taskHasAssignee &&
        !mapRecord.handedOver &&
        (!Array.isArray(mapRecord.statuses) || mapRecord.statuses.length === 0)
      ) {
        mapRecord = {
          ...mapRecord,
          statuses: deriveDefaultMapStatuses(task.status, true),
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

      const isAdminTask = isHiddenAdminOrInternalTask(task.list);

      const { launchMeta, effectiveLaunchDate, isLaunchDate } = extractLaunchMeta(reviewsList, task.dueDate);
      const parentClosed = isClosedStatus(task.status);
      enrichedTasks.push({
        ...task,
        taskMap: mapRecord,
        pmTags,
        isWaitingPmReview: pmTags.length > 0,
        isClosed: parentClosed,
        isAdminTask,
        launchMeta,
        effectiveLaunchDate,
        isLaunchDate,
        upworkStartedAt,
        upworkSession,
        progress,
      });

      // Surface open non-audit subtasks as first-class TaskMapItems when parent task is open
      if (!parentClosed && Array.isArray(task.subtasks) && task.subtasks.length > 0) {
        const parentIsOnHold =
          isOnHoldStatus(task.status) ||
          (Array.isArray(mapRecord.statuses) && mapRecord.statuses.some((s: string) => isOnHoldStatus(s)));
        const listOnHoldStatus =
          (Array.isArray(task.list?.statuses)
            ? task.list.statuses.find((s: any) => isOnHoldStatus(s?.name))?.name
            : null) || 'ON-HOLD';

        for (const st of task.subtasks) {
          if (isSubtaskExcludedFromBoard(st)) continue;

          const rawSubStatus = st.status || (st.completed ? 'CLOSED' : 'PENDING');
          const subStatus = parentIsOnHold ? listOnHoldStatus : rawSubStatus;
          const subState = reviewsList.find((r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === st.id);
          const subPmAssignments = reviewsList.filter(
            (r: any) => r?.type === 'PM_ASSIGNMENT' && r?.subtaskId === st.id && r?.assignedTo
          );
          const subAssignees = Array.isArray(st.assignees) && st.assignees.length > 0
            ? st.assignees
            : (st.User ? [st.User] : []);
          const subAssigneeId = st.assigneeId || null;
          const subHasAssignee = Boolean(subAssigneeId || subAssignees.length > 0 || subPmAssignments.length > 0);
          const subStatuses: string[] = parentIsOnHold
            ? ['On-hold']
            : Array.isArray(subState?.statuses)
              ? subState.statuses
              : deriveDefaultMapStatuses(subStatus, subHasAssignee && !subState?.handedOver);
          const subAssignee =
            (subAssigneeId && st.User?.id === subAssigneeId ? st.User : null) ||
            (subAssigneeId ? subAssignees.find((u: any) => u.id === subAssigneeId) : null) ||
            null;

          const subPmTags = subStatuses.filter((s: string) => {
            const up = s.toUpperCase();
            return up === 'CHE' || up === 'PAU' || up === 'HAN' || up.includes('PM');
          });

          const syntheticId = `subtask:${st.id}`;
          enrichedTasks.push({
            id: syntheticId,
            isSubtask: true,
            subtaskId: st.id,
            parentTaskId: task.id,
            parentTaskTitle: task.title,
            title: st.title,
            description: st.description || null,
            priority: st.priority || task.priority || 'NORMAL',
            listId: task.listId,
            status: subStatus,
            dueDate: st.dueDate || task.dueDate || null,
            startDate: st.startDate || null,
            position: task.position ?? null,
            assigneeId: subAssigneeId,
            assigneeRoleRestrictions: st.assigneeRoleRestrictions || [],
            teamAssignAccessRole: st.teamAssignAccessRole || null,
            list: task.list,
            assignee: subAssignee,
            assignees: subAssignees,
            creator: task.creator,
            subtasks: [],
            checklists: Array.isArray(st.checklists) && st.checklists.length > 0 ? st.checklists : task.checklists,
            taskMap: {
              id: mapRecord.id ? `${mapRecord.id}:sub:${st.id}` : '',
              taskId: syntheticId,
              subtaskId: st.id,
              statuses: subStatuses,
              shift: mapRecord.shift || currentShift,
              shiftDate: mapRecord.shiftDate || new Date(),
              rolloverCount: mapRecord.rolloverCount || 0,
              originShift: mapRecord.originShift || null,
              originDate: mapRecord.originDate || null,
              dontRollover: mapRecord.dontRollover || false,
              handedOver: Boolean(subState?.handedOver),
              stepOrder: mapRecord.stepOrder || 0,
              pmReviews: subPmAssignments,
              waitingReviewSince: mapRecord.waitingReviewSince || null,
              createdAt: st.createdAt,
              updatedAt: st.updatedAt,
            },
            pmTags: subPmTags,
            isWaitingPmReview: subPmTags.length > 0,
            isClosed: false,
            isAdminTask,
            upworkStartedAt: null,
            upworkSession: null,
            progress: null,
            createdAt: st.createdAt,
            updatedAt: st.updatedAt,
          });
        }
      }
    }

    // Enrich WAITING / Sent but Waiting tasks with CRM follow-up timing and tier metadata
    const waitingItemsForMeta = enrichedTasks.filter(
      (item: any) => !item.isSubtask && !item.isClosed && isWaitingMainStatus(item.status)
    );
    if (waitingItemsForMeta.length > 0) {
      const waitingMetaMap = await resolveWaitingSinceMap(
        waitingItemsForMeta.map((item: any) => ({
          id: item.id,
          status: item.status,
          updatedAt: item.updatedAt,
          createdAt: item.createdAt,
          pmReviews: item.taskMap?.pmReviews,
          recordUpdatedAt: item.taskMap?.updatedAt,
        }))
      );
      for (const item of waitingItemsForMeta) {
        const meta = waitingMetaMap.get(item.id);
        if (meta) {
          const effectiveSince = getEffectiveWaitingSince(meta) || meta.waitingSince;
          const daysPassed = getManilaCalendarDaysPassed(effectiveSince);
          item.crmWaitingMeta = {
            waitingSince: meta.waitingSince,
            daysPassed,
            rule: getCrmFollowUpRule(daysPassed),
            lastResponseAt: meta.lastResponseAt || null,
            lastResponseByName: meta.lastResponseByName || null,
            lastResponseNote: meta.lastResponseNote || null,
            lastResponseAction: meta.lastResponseAction || null,
          };
        }
      }
    }

    // Batched AuditLog fallback for pre-existing multi-assignee tasks/subtasks (so the most recently assigned user owns the card)
    const multiAssigneeItems = enrichedTasks.filter((item: any) => {
      if (!item.assigneeId || !Array.isArray(item.assignees) || item.assignees.length <= 1) return false;
      if (item.taskMap?.handedOver) return false;
      const isLive = Boolean(item.progress?.maName && !item.progress?.timeOut && item.progress?.timeIn);
      if (isLive) return false;
      const revs = Array.isArray(item.taskMap?.pmReviews) ? item.taskMap.pmReviews : [];
      const hasPm = revs.some(
        (r: any) => r?.type === 'PM_ASSIGNMENT' && r?.assignedTo && (item.isSubtask ? r?.subtaskId === item.subtaskId : !r?.subtaskId)
      );
      return !hasPm;
    });

    if (multiAssigneeItems.length > 0) {
      const entityIds = Array.from(
        new Set(
          multiAssigneeItems.flatMap((i: any) => (i.isSubtask ? [i.parentTaskId, i.subtaskId] : [i.id])).filter(Boolean)
        )
      );
      const logs = await prisma.auditLog.findMany({
        where: {
          action: 'ASSIGNMENT',
          entity: { in: ['TASK', 'SUBTASK'] },
          entityId: { in: entityIds },
        },
        select: { entityId: true, details: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });

      const logsByEntity = new Map<string, any[]>();
      for (const l of logs) {
        const arr = logsByEntity.get(l.entityId) || [];
        arr.push(l);
        logsByEntity.set(l.entityId, arr);
      }

      for (const item of multiAssigneeItems) {
        const candidateLogs = item.isSubtask
          ? [...(logsByEntity.get(item.subtaskId) || []), ...(logsByEntity.get(item.parentTaskId) || [])].filter(
              (l: any) => l.details?.subtaskId === item.subtaskId
            )
          : (logsByEntity.get(item.id) || []).filter((l: any) => !l.details?.subtaskId);

        let resolvedUser: any = null;
        for (const l of candidateLogs) {
          const d: any = l.details || {};
          const addedNames: string[] = Array.isArray(d.added) ? d.added : [];
          for (let k = addedNames.length - 1; k >= 0; k--) {
            const targetName = String(addedNames[k] || '').trim().toLowerCase();
            if (!targetName) continue;
            const match = item.assignees.find((u: any) => (u.name || '').trim().toLowerCase() === targetName);
            if (match) {
              resolvedUser = match;
              break;
            }
          }
          if (resolvedUser) break;
          if (typeof d.assigneeName === 'string' && !d.assigneeName.includes(',')) {
            const singleName = d.assigneeName.trim().toLowerCase();
            const match = item.assignees.find((u: any) => (u.name || '').trim().toLowerCase() === singleName);
            if (match) {
              resolvedUser = match;
              break;
            }
          }
        }
        if (resolvedUser && resolvedUser.id !== item.assigneeId) {
          item.assigneeId = resolvedUser.id;
          item.assignee = resolvedUser;
        }
      }
    }

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

      // Exclude review/audit, recurring, daily, weekly, monthly, and CRM/Waiting tasks from Available Tasks pool
      const isExcluded =
        s === 'WAITING' ||
        s.includes('WAITING') ||
        s === 'CRM' ||
        s.includes('CRM') ||
        s === 'INREVIEW' ||
        s === 'TOREVIEW' ||
        s === 'REVIEW' ||
        s === 'CHECKING' ||
        s === 'INCHECKING' ||
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
          ['WAITING', 'CRM', 'ASKCLIENT', 'READYTOSEND', 'TOSEND', 'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING', 'INREVIEW', 'TOREVIEW', 'CHECKING', 'INCHECKING'].includes(st) ||
          st.includes('WAITING') ||
          st.includes('CRM') ||
          st.includes('DAILY') ||
          st.includes('WEEKLY') ||
          st.includes('MONTHLY') ||
          st.includes('RECURRING')
        );

      if (isExcluded) return false;

      // Available tasks pool holds non-closed, non-cadence workflow tasks
      // that are unassigned OR explicitly handed over (and not actively worked or PM-queued).
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
      if (isLiveWorking) {
        return false;
      }

      const isExplicitlyHandedOver = Boolean(t.taskMap?.handedOver) || mapStatuses.includes('HANDOVER');
      if (isExplicitlyHandedOver) {
        return true;
      }

      const hasPmAssignment = reviewsList.some(
        (r: any) =>
          r?.type === 'PM_ASSIGNMENT' &&
          r?.assignedTo &&
          (t.isSubtask ? r?.subtaskId === t.subtaskId : !r?.subtaskId)
      );

      if (hasPmAssignment) {
        return false;
      }

      if (t.assigneeId) {
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
        // 0. Always push ALL On-hold tasks (even urgent) to the very bottom
        const holdA = isTaskOnHold(a) ? 1 : 0;
        const holdB = isTaskOnHold(b) ? 1 : 0;
        if (holdA !== holdB) return holdA - holdB;

        // 1. Prioritize urgent tasks at the top among active (non-on-hold) tasks
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
          mapStatuses.includes('SENT BUT WAITING') ||
          mapStatuses.includes('SENTBUTWAITING') ||
          mapStatuses.includes('WAITING') ||
          mapStatuses.includes('OUTREACH SENT') ||
          mapStatuses.includes('CLIENT SENT') ||
          mapStatuses.includes('TO SEND') ||
          mapStatuses.includes('TOSEND') ||
          mapStatuses.includes('READY TO SEND') ||
          mapStatuses.includes('READYTOSEND') ||
          mapStatuses.includes('ASK CLIENT') ||
          mapStatuses.includes('ASKCLIENT') ||
          mapStatuses.includes('FOLLOW UP') ||
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
      const clientDashboardLists = await fetchClientDashboardLists();
      const allClientsMap = new Map<string, { id: string; name: string }>();
      for (const c of clientDashboardLists) {
        allClientsMap.set(c.id, c);
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

    const maActiveSessions: Record<string, any> = await getMaActiveSessionsMap();

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
        const existing = maActiveSessions[maKey];
        const existingIsLive = Boolean(existing && existing.active && existing.timeIn && !existing.timeOut && !existing.isMissingTime);
        const incomingUpdatedMs = sheetProg.updatedAt ? new Date(sheetProg.updatedAt).getTime() : 0;
        const existingUpdatedMs = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        if (!existing || !existingIsLive || incomingUpdatedMs > existingUpdatedMs) {
          maActiveSessions[maKey] = {
            maName: sheetProg.maName,
            taskId: t.id,
            listId: t.listId || t.list?.id || null,
            listName: t.list?.name || null,
            listStatuses: Array.isArray(t.list?.statuses) ? t.list.statuses : undefined,
            taskStatus: t.status || null,
            priority: t.priority || null,
            subStatuses: Array.isArray(rec?.statuses) ? rec.statuses : deriveDefaultMapStatuses(t.status),
            timeIn: sheetProg.timeIn,
            timeOut: null,
            client: sheetProg.client || t.list?.name || 'General',
            taskName: t.title || 'No task inputted',
            date: sheetProg.date || todayManila,
            status: sheetProg.status || 'IN PROGRESS',
            isUpwork: Boolean(sheetProg.isUpwork),
            rowNumber: sheetProg.sheetRow,
            updatedAt: sheetProg.updatedAt,
            active: true,
          };
        }
      }
    }

    // Enrich all maActiveSessions with lightweight task metadata (excluding description so it only loads on click)
    const enrichedTaskById = new Map<string, any>();
    const listByNameLower = new Map<string, { id: string; name: string }>();
    for (const c of allClients) {
      listByNameLower.set(c.name.trim().toLowerCase(), c);
    }
    for (const et of enrichedTasks) {
      enrichedTaskById.set(et.id, et);
      if (et.isSubtask && et.subtaskId) {
        enrichedTaskById.set(et.subtaskId, et);
      }
      if (et.list?.id && et.list?.name) {
        const lKey = et.list.name.trim().toLowerCase();
        if (!listByNameLower.has(lKey)) {
          listByNameLower.set(lKey, { id: et.list.id, name: et.list.name });
        }
      }
    }

    const resolveSessionList = (clientRaw?: string | null) => {
      const clean = (clientRaw || '').trim().toLowerCase();
      if (!clean || clean === 'general' || clean === 'no client inputted' || clean === 'upwork') return null;
      const exact = listByNameLower.get(clean);
      if (exact) return exact;
      const prefixMatches = Array.from(listByNameLower.values()).filter(
        (l) => l.name.trim().toLowerCase().startsWith(clean) || clean.startsWith(l.name.trim().toLowerCase())
      );
      return prefixMatches.length === 1 ? prefixMatches[0] : null;
    };

    for (const [maKey, sess] of Object.entries(maActiveSessions)) {
      if (!sess || typeof sess !== 'object') continue;
      let matched = sess.taskId ? enrichedTaskById.get(sess.taskId) : null;
      const resolvedList = !matched ? resolveSessionList(sess.client) : null;

      if (!matched) {
        const rawTitle = (sess.taskName || '').trim().replace(/\.{3}$/, '').trim().toLowerCase();
        if (rawTitle && rawTitle !== 'general task' && rawTitle !== 'no task inputted') {
          const pool = resolvedList
            ? enrichedTasks.filter((et) => (et.listId || et.list?.id) === resolvedList.id)
            : enrichedTasks;
          matched =
            pool.find((et) => (et.title || '').trim().toLowerCase() === rawTitle) || null;
          if (!matched && rawTitle.length >= 4) {
            const containsMatches = pool.filter((et) =>
              (et.title || '').trim().toLowerCase().includes(rawTitle)
            );
            if (containsMatches.length === 1) {
              matched = containsMatches[0];
            }
          }
        }
      }

      if (matched) {
        maActiveSessions[maKey] = {
          ...sess,
          taskId: matched.id,
          listId: matched.listId || matched.list?.id || sess.listId || null,
          listName: matched.list?.name || sess.listName || null,
          listStatuses: Array.isArray(matched.list?.statuses)
            ? matched.list.statuses
            : sess.listStatuses,
          taskStatus: matched.status || sess.taskStatus || null,
          priority: matched.priority || sess.priority || null,
          subStatuses: Array.isArray(matched.taskMap?.statuses)
            ? matched.taskMap.statuses
            : sess.subStatuses,
        };
      } else if (resolvedList && !sess.listId) {
        maActiveSessions[maKey] = {
          ...sess,
          listId: resolvedList.id,
          listName: resolvedList.name,
        };
      }
    }

    // Launch Map uses dedicated GET /api/task-map/launch; omit closed launch scans here
    const launchTasks: any[] = [];

    const snapshotPayload = {
      tasks: openTasks,
      launchTasks,
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
      workspaceRoles,
      workspaceTeams,
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
      launchTasks,
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
      workspaceRoles,
      workspaceTeams,
      activeUpworkSessions,
      upworkClients,
      upworkProjectClients,
      maActiveSessions,
    };

    // Cache in Redis: 30 seconds for today (protects against thundering herd; writes invalidate via task_map:all), 3600 seconds for historical dates
    await setCache(cacheKey, responsePayload, isPastDate ? 3600 : 30, cacheGen);

    return responsePayload;
    })();

    inFlightTaskMapQueries.set(singleFlightKey, computePromise);
    try {
      const responsePayload = await computePromise;
      return res.json(responsePayload);
    } finally {
      if (inFlightTaskMapQueries.get(singleFlightKey) === computePromise) {
        inFlightTaskMapQueries.delete(singleFlightKey);
      }
    }
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
 * Parse a Task Map target ID (`subtask:<subtaskId>` or `<taskId>`)
 */
const parseTaskMapTargetId = (rawId: string) => {
  if (rawId && rawId.startsWith('subtask:')) {
    return { isSubtask: true, rawId, entityId: rawId.slice('subtask:'.length) };
  }
  return { isSubtask: false, rawId, entityId: rawId };
};

const parsePmReviewsArray = (raw: any): any[] => {
  if (Array.isArray(raw)) return [...raw];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const deriveDefaultTaskMapStatuses = (rawStatus?: string | null): string[] => {
  const statusKey = (rawStatus || '').toUpperCase().replace(/[\s_-]+/g, '');
  if (statusKey === 'CRM') return ['To send'];
  if (statusKey === 'WAITING') return ['Waiting'];
  if (statusKey === 'ONHOLD') return ['On-hold'];
  if (
    statusKey === 'INREVIEW' ||
    statusKey === 'TOREVIEW' ||
    statusKey === 'REVIEW' ||
    statusKey === 'CHECKING' ||
    statusKey === 'INCHECKING' ||
    statusKey === 'CLOSED' ||
    statusKey === 'DONE' ||
    statusKey === 'COMPLETE' ||
    statusKey === 'COMPLETED' ||
    statusKey === 'RESOLVED' ||
    statusKey === 'CANCELLED'
  ) {
    return [];
  }
  return ['Available Task'];
};

/**
 * Update multi-select status chips for a task or subtask (`subtask:<id>`)
 */
export const updateTaskStatuses = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { statuses } = req.body;
    const user = (req as any).user;

    if (!Array.isArray(statuses)) {
      return res.status(400).json({ error: 'Statuses must be an array of strings' });
    }

    const isPm = await canUserSetAssignees(user?.id);

    const actorUser = user?.id
      ? await prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, name: true, email: true },
        })
      : null;
    const actorDisplayName = actorUser?.name || user?.name || user?.email || 'User';

    const normSubStatuses = statuses.map((s: string) => s.trim().toUpperCase().replace(/[\s_-]+/g, ''));
    const isAvailableTaskStatus = normSubStatuses.includes('AVAILABLETASK');
    const isRevisionTransferOut = normSubStatuses.some((norm) => norm === 'REVISION' || norm === 'REVISIONS');
    const isHandoverSubStatus = normSubStatuses.includes('HANDOVER') || isAvailableTaskStatus;
    const isWorkflowTransferOut = normSubStatuses.some((norm) =>
      ['TOREVIEW', 'INREVIEW', 'CHECKING', 'INCHECKING', 'WAITING', 'CRM', 'ASKCLIENT', 'READYTOSEND', 'TOSEND'].includes(norm)
    );
    const shouldClearAssignee = isHandoverSubStatus || isWorkflowTransferOut;

    const target = parseTaskMapTargetId(id);

    // Server-enforced Revision return: return from Audit/CRM back to original assigned MA's Task Map column
    if (isRevisionTransferOut) {
      const revResult = await applyRevisionReturnToOriginalMa({
        targetId: id,
        actorUser: user,
        io,
        requestedStatuses: statuses,
      });

      await prisma.auditLog.create({
        data: {
          action: 'TASK_MAP_STATUS_CHANGE',
          entity: 'TASK',
          entityId: revResult.taskId,
          userId: user?.id || 'system',
          details: {
            newStatuses: revResult.statuses,
            restoredOriginalMaId: revResult.originalMaId,
            ...(revResult.subtaskId ? { subtaskId: revResult.subtaskId } : {}),
            actor: actorDisplayName,
          },
        },
      }).catch(() => {});

      const freshRecord = await getOrCreateTaskMapRecord(revResult.taskId);
      const responseTaskMap = revResult.subtaskId
        ? {
            ...freshRecord,
            taskId: target.rawId,
            subtaskId: revResult.subtaskId,
            statuses: revResult.statuses,
            handedOver: revResult.handedOver,
            pmReviews: revResult.pmReviews,
          }
        : {
            ...freshRecord,
            statuses: revResult.statuses,
            handedOver: revResult.handedOver,
            pmReviews: revResult.pmReviews,
          };

      return res.json({
        success: true,
        taskMap: responseTaskMap,
        originalMaId: revResult.originalMaId,
        assigneeId: revResult.originalMaId,
        assignee: revResult.assignee,
        upworkStartedAt: null,
        upworkSession: null,
        activeUpworkSessions: [],
      });
    }

    if (target.isSubtask) {
      const subtask = await prisma.subtask.findUnique({
        where: { id: target.entityId },
        include: {
          assignees: { select: { id: true, name: true, roles: true } },
          User: { select: { id: true, name: true, roles: true } },
          task: { select: { id: true, title: true } },
        },
      });
      if (!subtask) {
        return res.status(404).json({ error: 'Subtask not found' });
      }

      const isUnassigned = !subtask.assigneeId && (!subtask.assignees || subtask.assignees.length === 0);
      if (isUnassigned && !isPm) {
        return res.status(403).json({ error: 'Only Project Managers can modify statuses on Available Tasks' });
      }
      if (isAvailableTaskStatus && !isUnassigned && !isPm) {
        return res.status(403).json({ error: 'Only Project Managers can move tasks to the Available column' });
      }

      const parentRecord = await getOrCreateTaskMapRecord(subtask.taskId);
      let pmReviews = parsePmReviewsArray(parentRecord.pmReviews);
      const subStateIdx = pmReviews.findIndex((r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === subtask.id);
      const oldStatuses =
        subStateIdx !== -1 && Array.isArray(pmReviews[subStateIdx].statuses)
          ? pmReviews[subStateIdx].statuses
          : deriveDefaultTaskMapStatuses(subtask.status || (subtask.completed ? 'CLOSED' : 'PENDING'));

      if (shouldClearAssignee) {
        if (isWorkflowTransferOut) {
          const activePmAssign = pmReviews.find(
            (r: any) => r?.type === 'PM_ASSIGNMENT' && r?.subtaskId === subtask.id && r?.assignedTo
          );
          const candidateMaId = activePmAssign?.assignedTo || subtask.assigneeId || null;
          if (candidateMaId) {
            const candidateUser =
              (subtask.User?.id === candidateMaId ? subtask.User : null) ||
              (subtask.assignees || []).find((u: any) => u.id === candidateMaId) ||
              (await prisma.user.findUnique({
                where: { id: candidateMaId },
                select: { id: true, name: true, roles: true },
              }));
            if (candidateUser && !isNonMaReviewerOnlyRole(candidateUser)) {
              pmReviews = upsertOriginalMaEntry(pmReviews, {
                userId: candidateUser.id,
                userName: candidateUser.name,
                subtaskId: subtask.id,
              });
            }
          }
        }

        pmReviews = pmReviews.filter((r: any) => !(r?.type === 'PM_ASSIGNMENT' && r?.subtaskId === subtask.id));
        if (subtask.assigneeId || (subtask.assignees && subtask.assignees.length > 0)) {
          await prisma.subtask.update({
            where: { id: subtask.id },
            data: { assigneeId: null, assignees: { set: [] } },
          });
        }
      }

      const nextHandedOver = isHandoverSubStatus
        ? true
        : isWorkflowTransferOut
          ? false
          : (subStateIdx !== -1 ? Boolean(pmReviews[subStateIdx].handedOver) : false);

      const nextEntry = {
        type: 'SUBTASK_STATE',
        subtaskId: subtask.id,
        statuses,
        handedOver: nextHandedOver,
        updatedAt: new Date().toISOString(),
      };
      const nextSubStateIdx = pmReviews.findIndex((r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === subtask.id);
      if (nextSubStateIdx !== -1) {
        pmReviews[nextSubStateIdx] = nextEntry;
      } else {
        pmReviews.push(nextEntry);
      }

      const updatedParent = await updateTaskMapRecord(subtask.taskId, { pmReviews });
      await invalidateCache('task:*', 'tasks:all', `task:${subtask.taskId}`, `task:${subtask.id}`, 'task_map:*');

      await prisma.auditLog.create({
        data: {
          action: 'TASK_MAP_STATUS_CHANGE',
          entity: 'TASK',
          entityId: subtask.taskId,
          userId: user?.id || 'system',
          details: {
            oldStatuses,
            newStatuses: statuses,
            subtaskId: subtask.id,
            subtaskTitle: subtask.title,
            actor: actorDisplayName,
          },
        },
      });

      const subTaskMap = {
        ...updatedParent,
        taskId: target.rawId,
        subtaskId: subtask.id,
        statuses,
        handedOver: nextHandedOver,
      };
      io.emit('task_map:updated', {
        taskId: target.rawId,
        subtaskId: subtask.id,
        parentTaskId: subtask.taskId,
        statuses,
        handedOver: nextHandedOver,
        ...(shouldClearAssignee ? { assigneeId: null, assignee: null } : {}),
        taskMap: subTaskMap,
      });

      return res.json({
        success: true,
        taskMap: subTaskMap,
        upworkStartedAt: null,
        upworkSession: null,
        activeUpworkSessions: [],
      });
    }

    const currentRecord = await getOrCreateTaskMapRecord(id);
    const oldStatuses = currentRecord.statuses || [];

    // Check permissions on Available Tasks (unassigned in pool): strictly Project Managers and Admins only
    const currentTask = await prisma.task.findUnique({
      where: { id },
      select: {
        title: true,
        assigneeId: true,
        assignees: { select: { id: true, name: true, roles: true } },
        assignee: { select: { id: true, name: true, email: true, roles: true } },
      },
    });

    const isUnassigned = !currentTask?.assigneeId && (!currentTask?.assignees || currentTask.assignees.length === 0);
    if (isUnassigned && !isPm) {
      return res.status(403).json({ error: 'Only Project Managers can modify statuses on Available Tasks' });
    }
    if (isAvailableTaskStatus && !isUnassigned && !isPm) {
      return res.status(403).json({ error: 'Only Project Managers can move tasks to the Available column' });
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
          requestedBy: actorDisplayName,
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

    if (shouldClearAssignee) {
      if (isWorkflowTransferOut && Array.isArray(pmReviews)) {
        const activePmAssign = pmReviews.find(
          (r: any) => r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId && r?.assignedTo
        );
        const candidateMaId = activePmAssign?.assignedTo || currentTask?.assigneeId || null;
        if (candidateMaId) {
          const candidateUser =
            (currentTask?.assignee && currentTask.assignee.id === candidateMaId ? currentTask.assignee : null) ||
            (currentTask?.assignees || []).find((u: any) => u.id === candidateMaId) ||
            (await prisma.user.findUnique({
              where: { id: candidateMaId },
              select: { id: true, name: true, roles: true },
            }));
          if (candidateUser && !isNonMaReviewerOnlyRole(candidateUser)) {
            pmReviews = upsertOriginalMaEntry(pmReviews, {
              userId: candidateUser.id,
              userName: candidateUser.name,
            });
          }
        }
      }
      if (Array.isArray(pmReviews)) {
        pmReviews = pmReviews.filter((r: any) => !(r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId));
      }
      if (currentTask?.assigneeId || (currentTask?.assignees && currentTask.assignees.length > 0)) {
        await prisma.task.update({
          where: { id },
          data: { assigneeId: null, assignees: { set: [] } },
        });
      }
    }

    const isSentWaitingSubStatus = normSubStatuses.some(
      (n) => n === 'SENTBUTWAITING' || n === 'SENT' || n === 'WAITING'
    );
    const isLeavingWaitingSubStatus = normSubStatuses.some((n) =>
      ['TOSEND', 'REVISION', 'REVISIONS', 'CLOSED', 'DONE', 'AVAILABLETASK', 'HANDOVER'].includes(n)
    );
    if (isSentWaitingSubStatus) {
      const existingWaiting = Array.isArray(pmReviews)
        ? pmReviews.find((r: any) => r && r.type === 'CRM_WAITING_META')
        : null;
      if (!existingWaiting?.waitingSince) {
        const nowIso = new Date().toISOString();
        pmReviews = [
          ...(Array.isArray(pmReviews) ? pmReviews.filter((r: any) => !(r && r.type === 'CRM_WAITING_META')) : []),
          {
            type: 'CRM_WAITING_META',
            waitingSince: nowIso,
            lastResponseAt: null,
            lastResponseById: null,
            lastResponseByName: null,
            lastResponseNote: null,
            lastResponseAction: null,
            updatedAt: nowIso,
          },
        ];
      }
    } else if (isLeavingWaitingSubStatus && Array.isArray(pmReviews)) {
      pmReviews = pmReviews.filter((r: any) => !(r && r.type === 'CRM_WAITING_META'));
    }

    const updated = await updateTaskMapRecord(id, {
      statuses,
      waitingReviewSince,
      pmReviews,
      ...(isHandoverSubStatus ? { handedOver: true } : isWorkflowTransferOut ? { handedOver: false } : {}),
    });

    const isParentOnHoldSubStatus = statuses.some((s: string) => isOnHoldStatus(s));
    if (isParentOnHoldSubStatus) {
      await cascadeParentOnHoldToSubtasks({
        parentTaskId: id,
        actorId: user?.id || null,
        actorName: actorDisplayName,
      }).catch(() => {});
    }

    // Invalidate Redis task and task_map caches
    await invalidateCache('task:*', 'tasks:all', `task:${id}`, 'task_map:*', 'launch_map:all');

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
          actor: actorDisplayName,
        },
      },
    });

    io.emit('task_map:updated', {
      taskId: id,
      statuses,
      taskMap: updated,
      ...(isHandoverSubStatus ? { handedOver: true } : isWorkflowTransferOut ? { handedOver: false } : {}),
      ...(shouldClearAssignee ? { assigneeId: null, assignee: null } : {}),
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
/**
 * Shared Task Map assignment & transfer executor with strict role enforcement:
 * - MA (!isPm): can move tasks only within their own column (QUEUE <-> IN_PROGRESS).
 * - PM (isPm): can assign/queue/transfer/unassign in QUEUE mode; cannot move into IN_PROGRESS.
 * - Transfer: PM-only, always lands in target MA's To Do (QUEUE), never In Progress.
 */
async function executeTaskMapAssignment(
  req: Request,
  res: Response,
  params: {
    action: TaskMapMoveAction;
    assigneeId: string | null;
    mode: TaskMapMoveMode;
  }
) {
  try {
    const { id } = req.params;
    const { action, assigneeId } = params;
    const mode: TaskMapMoveMode = action === 'TRANSFER' ? 'QUEUE' : params.mode;
    const user = (req as any).user;

    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const isPm = await canUserSetAssignees(user.id);

    // Fast-fail obvious role violations before querying task details
    if (action === 'TRANSFER' && !isPm) {
      return res.status(403).json({
        error: 'Only Project Managers and Admins can transfer tasks',
      });
    }
    if (action === 'TRANSFER' && !assigneeId) {
      return res.status(400).json({
        error: 'Target MA is required to transfer a task',
      });
    }
    if (action === 'ASSIGN' && mode === 'IN_PROGRESS' && isPm) {
      return res.status(403).json({
        error: 'Project Managers cannot move tasks into In Progress. Moving a task to In Progress is the MA\'s action only.',
      });
    }

    const actorUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, email: true, avatarUrl: true },
    });
    const actorName = actorUser?.name || user.name || user.email || 'Team Member';

    const target = parseTaskMapTargetId(id);

    if (target.isSubtask) {
      const currentSubtask = await prisma.subtask.findUnique({
        where: { id: target.entityId },
        include: {
          assignees: true,
          User: true,
          task: {
            include: {
              list: { select: { id: true, name: true, folder: { select: { id: true, name: true } } } },
            },
          },
        },
      });
      if (!currentSubtask) {
        return res.status(404).json({ error: 'Subtask not found' });
      }

      const parentRecord = await getOrCreateTaskMapRecord(currentSubtask.taskId);
      let reviewsList = parsePmReviewsArray(parentRecord.pmReviews);
      const subStateIdx = reviewsList.findIndex(
        (r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === currentSubtask.id
      );
      const existingSubStatuses: string[] =
        subStateIdx !== -1 && Array.isArray(reviewsList[subStateIdx].statuses)
          ? [...reviewsList[subStateIdx].statuses]
          : [];
      const currentOwnerId = resolveEffectiveTaskMapOwnerId({
        pmReviews: reviewsList,
        handedOver: subStateIdx !== -1 ? Boolean(reviewsList[subStateIdx].handedOver) : false,
        statuses: existingSubStatuses,
        assigneeId: currentSubtask.assigneeId,
        assignees: currentSubtask.assignees,
        subtaskId: currentSubtask.id,
      });

      const perm = evaluateTaskMapMovePermission({
        actorId: user.id,
        isPm,
        currentOwnerId,
        targetAssigneeId: assigneeId,
        mode,
        action,
      });
      if (!perm.allowed) {
        return res.status(perm.statusCode).json({ error: perm.error });
      }

      const existingSubPmAssignment = reviewsList.find(
        (r: any) => r?.type === 'PM_ASSIGNMENT' && r?.subtaskId === currentSubtask.id && r?.assignedTo === assigneeId
      );

      const currentSubStatusNorm = (currentSubtask.status || '').toUpperCase().replace(/[\s_-]+/g, '');
      const isCurrentlyInProgressOrHold = currentSubStatusNorm === 'INPROGRESS' || currentSubStatusNorm === 'ONHOLD';
      const isAlreadyAssigned =
        assigneeId &&
        (currentSubtask.assigneeId === assigneeId ||
          (currentSubtask.assignees || []).some((a) => a.id === assigneeId)) &&
        existingSubPmAssignment &&
        existingSubPmAssignment.mode === mode &&
        !(mode === 'QUEUE' && isCurrentlyInProgressOrHold);
      if (isAlreadyAssigned) {
        return res.json({ success: true, task: currentSubtask, taskMap: parentRecord });
      }

      const updateSubData: any = {};
      const currentSubStatusUpper = (currentSubtask.status || '').toUpperCase().trim();
      const isCadenceSubtask = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(currentSubStatusUpper);

      if (assigneeId) {
        const targetUser = await prisma.user.findUnique({
          where: { id: assigneeId },
          select: { id: true, name: true, roles: true, systemRole: true },
        });
        if (!targetUser) {
          return res.status(404).json({ error: 'Target user not found' });
        }
        updateSubData.assigneeId = assigneeId;
        updateSubData.assignees = { set: [{ id: assigneeId }] };
        if (mode === 'IN_PROGRESS' && !isCadenceSubtask) {
          updateSubData.status = 'IN PROGRESS';
        } else if (mode === 'QUEUE' && !isCadenceSubtask && (isCurrentlyInProgressOrHold || !currentSubtask.status)) {
          updateSubData.status = 'PENDING';
        }
      } else {
        updateSubData.assigneeId = null;
        updateSubData.assignees = { set: [] };
        if (!isCadenceSubtask) {
          updateSubData.status = currentSubtask.status || 'PENDING';
        }
      }

      const updatedSubtask = await prisma.subtask.update({
        where: { id: currentSubtask.id },
        data: updateSubData,
        include: {
          User: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
          assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
        },
      });

      let subStatuses: string[] =
        subStateIdx !== -1 && Array.isArray(reviewsList[subStateIdx].statuses)
          ? [...reviewsList[subStateIdx].statuses]
          : [];
      let subHandedOver = subStateIdx !== -1 ? Boolean(reviewsList[subStateIdx].handedOver) : false;

      if (assigneeId) {
        subStatuses = subStatuses.filter((s) => {
          const up = s.toUpperCase().replace(/[\s_-]+/g, '');
          if (mode === 'QUEUE' && up === 'INPROGRESS') return false;
          return up !== 'AVAILABLETASK' && up !== 'PENDING' && up !== 'REVISION' && up !== 'REVISIONS' && up !== 'INREVIEW' && up !== 'TOREVIEW' && up !== 'HANDOVER';
        });
        if (mode === 'IN_PROGRESS' && !subStatuses.some((s) => s.toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS')) {
          subStatuses.push('In progress');
        }
        subHandedOver = false;
        reviewsList = reviewsList.filter((r: any) => !(r?.type === 'PM_ASSIGNMENT' && r?.subtaskId === currentSubtask.id));
        reviewsList.push({
          type: 'PM_ASSIGNMENT',
          subtaskId: currentSubtask.id,
          assignedTo: assigneeId,
          assignedBy: user.id,
          assignedByName: actorName,
          mode: mode || 'QUEUE',
          assignedAt: new Date().toISOString(),
        });
        const subStatusNorm = (updatedSubtask.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
        const isReviewOrCrmSub = [
          'TOREVIEW',
          'INREVIEW',
          'REVIEW',
          'CHECKING',
          'INCHECKING',
          'CRM',
          'WAITING',
          'SENT',
          'CLOSED',
          'DONE',
        ].includes(subStatusNorm);
        const targetSubUser =
          updatedSubtask.User?.id === assigneeId
            ? updatedSubtask.User
            : (updatedSubtask.assignees || []).find((u: any) => u.id === assigneeId);
        if (!isReviewOrCrmSub && targetSubUser && !isNonMaReviewerOnlyRole(targetSubUser as any)) {
          reviewsList = upsertOriginalMaEntry(reviewsList, {
            userId: targetSubUser.id,
            userName: targetSubUser.name,
            subtaskId: currentSubtask.id,
          });
        }
      } else {
        subHandedOver = true;
        if (!subStatuses.some((s) => s.toUpperCase() === 'AVAILABLE TASK')) {
          subStatuses.push('Available Task');
        }
        subStatuses = subStatuses.filter((s) => !s.toUpperCase().replace(/[\s_-]+/g, '').startsWith('UPWORK'));
        reviewsList = reviewsList.filter((r: any) => !(r?.type === 'PM_ASSIGNMENT' && r?.subtaskId === currentSubtask.id));
      }

      const nextSubState = {
        type: 'SUBTASK_STATE',
        subtaskId: currentSubtask.id,
        statuses: subStatuses,
        handedOver: subHandedOver,
        updatedAt: new Date().toISOString(),
      };
      const existingIdxAfter = reviewsList.findIndex(
        (r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === currentSubtask.id
      );
      if (existingIdxAfter !== -1) {
        reviewsList[existingIdxAfter] = nextSubState;
      } else {
        reviewsList.push(nextSubState);
      }

      const updatedRecord = await updateTaskMapRecord(currentSubtask.taskId, { pmReviews: reviewsList });
      await invalidateCache(
        `task:${currentSubtask.taskId}`,
        `task:${currentSubtask.id}`,
        `task:activities:${currentSubtask.taskId}`,
        'tasks:all',
        'dashboard:all',
        'lists:all',
        'task_map:all'
      ).catch(() => {});

      const prevSubAssignees =
        currentSubtask.assignees && currentSubtask.assignees.length > 0
          ? currentSubtask.assignees
          : currentSubtask.User
            ? [currentSubtask.User]
            : [];
      const newSubAssignees =
        updatedSubtask.assignees && updatedSubtask.assignees.length > 0
          ? updatedSubtask.assignees
          : updatedSubtask.User
            ? [updatedSubtask.User]
            : [];
      const subAdded = newSubAssignees
        .filter((u) => !prevSubAssignees.some((p) => p.id === u.id))
        .map((u) => u.name);
      const subRemoved = prevSubAssignees
        .filter((p) => !newSubAssignees.some((u) => u.id === p.id))
        .map((p) => p.name);
      const subAssigneeName = updatedSubtask.User?.name || (newSubAssignees[0]?.name ?? 'Unassigned');

      const subAssignLog = await prisma.auditLog.create({
        data: {
          action: 'ASSIGNMENT',
          entity: 'TASK',
          entityId: currentSubtask.taskId,
          userId: user.id,
          details: {
            assigneeId: assigneeId || null,
            assigneeName: subAssigneeName,
            added: subAdded,
            removed: subRemoved,
            subtaskId: currentSubtask.id,
            subtaskTitle: currentSubtask.title,
            assignedBy: actorName,
            assignedAt: new Date().toISOString(),
          },
        },
      }).catch(() => null);

      const subStatusChanged =
        updateSubData.status &&
        (currentSubtask.status || '').trim().toUpperCase() !== String(updateSubData.status).trim().toUpperCase();
      const subStatusLog = subStatusChanged
        ? await prisma.auditLog.create({
            data: {
              action: 'STATUS_CHANGE',
              entity: 'TASK',
              entityId: currentSubtask.taskId,
              userId: user.id,
              details: {
                oldStatus: currentSubtask.status,
                newStatus: updatedSubtask.status,
                subtaskId: currentSubtask.id,
                subtaskTitle: currentSubtask.title,
              },
            },
          }).catch(() => null)
        : null;

      io.emit('subtask_updated', { taskId: currentSubtask.taskId, subtask: updatedSubtask });
      io.emit('task_map:updated', {
        taskId: target.rawId,
        subtaskId: currentSubtask.id,
        parentTaskId: currentSubtask.taskId,
        assigneeId,
        statuses: subStatuses,
        handedOver: subHandedOver,
      });
      io.emit('task_activity', {
        listId: currentSubtask.task?.listId,
        taskId: currentSubtask.taskId,
        activity: {
          id: subAssignLog?.id || `assign-sub-${Date.now()}`,
          type: 'assignment',
          author: actorName,
          assigneeName: subAssigneeName,
          added: subAdded,
          removed: subRemoved,
          subtaskId: currentSubtask.id,
          subtaskTitle: currentSubtask.title,
          date: subAssignLog?.createdAt || new Date(),
          user: actorUser,
        },
      });
      if (subStatusLog) {
        io.emit('task_activity', {
          listId: currentSubtask.task?.listId,
          taskId: currentSubtask.taskId,
          activity: {
            id: subStatusLog.id,
            type: 'status_change',
            author: actorName,
            oldStatus: currentSubtask.status,
            newStatus: updatedSubtask.status,
            subtaskId: currentSubtask.id,
            subtaskTitle: currentSubtask.title,
            date: subStatusLog.createdAt,
            user: actorUser,
          },
        });
      }

      // Notify assigned / unassigned user on Task Map
      if (currentSubtask.assigneeId && currentSubtask.assigneeId !== user.id && currentSubtask.assigneeId !== assigneeId) {
        const oldSubToNotify = await filterUsersByNotificationPreference([currentSubtask.assigneeId], 'assigned').catch(() => []);
        if (oldSubToNotify.length > 0) {
          await prisma.taskNotification.create({
            data: {
              userId: currentSubtask.assigneeId,
              actorId: user.id,
              taskId: currentSubtask.taskId,
              type: 'UNASSIGNMENT',
              title: `${actorName} unassigned you from subtask ${currentSubtask.title} on Task Map`,
            },
          }).catch(() => {});
          io.to(`user:${currentSubtask.assigneeId}`).emit('notification_received', {
            type: 'UNASSIGNMENT',
            taskId: currentSubtask.taskId,
            subtaskId: currentSubtask.id,
          });
        }
      }
      if (assigneeId && assigneeId !== user.id && currentSubtask.assigneeId !== assigneeId) {
        const newSubToNotify = await filterUsersByNotificationPreference([assigneeId], 'assigned').catch(() => []);
        if (newSubToNotify.length > 0) {
          await prisma.taskNotification.create({
            data: {
              userId: assigneeId,
              actorId: user.id,
              taskId: currentSubtask.taskId,
              type: 'ASSIGNMENT',
              title: `${actorName} assigned you to subtask ${currentSubtask.title} on Task Map`,
            },
          }).catch(() => {});
          io.to(`user:${assigneeId}`).emit('notification_received', {
            type: 'ASSIGNMENT',
            taskId: currentSubtask.taskId,
            subtaskId: currentSubtask.id,
          });
        }
      }

      return res.json({ success: true, task: updatedSubtask, taskMap: updatedRecord });
    }

    const currentTask = await prisma.task.findUnique({
      where: { id },
      include: {
        list: true,
        assignee: { select: { id: true, name: true } },
        assignees: true,
      },
    });

    if (!currentTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const record = await getOrCreateTaskMapRecord(id);
    let reviewsList = parsePmReviewsArray(record.pmReviews);
    const currentOwnerId = resolveEffectiveTaskMapOwnerId({
      pmReviews: reviewsList,
      handedOver: record.handedOver,
      statuses: record.statuses,
      assigneeId: currentTask.assigneeId,
      assignees: currentTask.assignees,
    });

    const perm = evaluateTaskMapMovePermission({
      actorId: user.id,
      isPm,
      currentOwnerId,
      targetAssigneeId: assigneeId,
      mode,
      action,
    });
    if (!perm.allowed) {
      return res.status(perm.statusCode).json({ error: perm.error });
    }

    const existingPmAssignment = reviewsList.find(
      (r: any) => r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId && r?.assignedTo === assigneeId
    );

    const currentStatusNorm = (currentTask.status || '').toUpperCase().replace(/[\s_-]+/g, '');
    const isCurrentlyInProgressOrHold = currentStatusNorm === 'INPROGRESS' || currentStatusNorm === 'ONHOLD';

    // Guard: If task is already assigned to this user and has matching PM assignment mode, return early
    const isAlreadyAssigned =
      assigneeId &&
      (currentTask.assigneeId === assigneeId ||
        (currentTask.assignees || []).some((a) => a.id === assigneeId)) &&
      existingPmAssignment &&
      existingPmAssignment.mode === mode &&
      !(mode === 'QUEUE' && isCurrentlyInProgressOrHold);
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
        const listStatus = currentTask.listId
          ? await prisma.listStatus.findFirst({
              where: { listId: currentTask.listId, name: { equals: 'IN PROGRESS', mode: 'insensitive' } },
              select: { name: true },
            })
          : null;
        updateData.status = listStatus?.name ?? 'IN PROGRESS';
      } else if (mode === 'QUEUE' && !isCadenceTask && (isCurrentlyInProgressOrHold || !currentTask.status)) {
        const pendingStatus = currentTask.listId
          ? await prisma.listStatus.findFirst({
              where: { listId: currentTask.listId, name: { equals: 'PENDING', mode: 'insensitive' } },
              select: { name: true },
            })
          : null;
        updateData.status = pendingStatus?.name ?? 'PENDING';
      }
    } else {
      updateData.assigneeId = null;
      updateData.assignees = { set: [] };
      // Cadence tasks (DAILY, WEEKLY, MONTHLY) strictly preserve their status.
      // Active tasks returned to the pool also preserve their status without being forced to PENDING.
      if (!isCadenceTask) {
        updateData.status = currentTask.status || 'PENDING';
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
            statuses: {
              select: { name: true, color: true, groupName: true, order: true },
              orderBy: { order: 'asc' },
            },
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
        if (mode === 'QUEUE' && up === 'INPROGRESS') return false;
        return up !== 'AVAILABLETASK' && up !== 'PENDING' && up !== 'REVISION' && up !== 'REVISIONS' && up !== 'INREVIEW' && up !== 'TOREVIEW' && up !== 'HANDOVER';
      });
      if (mode === 'IN_PROGRESS' && !newStatuses.some((s) => s.toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS')) {
        newStatuses.push('In progress');
      }
      handedOver = false;

      // Record explicit PM assignment so task appears in that user's column (preserve subtask assignments!)
      reviewsList = reviewsList.filter((r: any) => !(r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId));
      reviewsList.push({
        type: 'PM_ASSIGNMENT',
        assignedTo: assigneeId,
        assignedBy: user.id,
        assignedByName: actorName,
        mode: mode || 'QUEUE',
        assignedAt: new Date().toISOString(),
      });

      const taskStatusNorm = (updatedTask.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      const isReviewOrCrmTask = [
        'TOREVIEW',
        'INREVIEW',
        'REVIEW',
        'CHECKING',
        'INCHECKING',
        'CRM',
        'WAITING',
        'SENT',
        'CLOSED',
        'DONE',
      ].includes(taskStatusNorm);
      if (!isReviewOrCrmTask && updatedTask.assignee && !isNonMaReviewerOnlyRole(updatedTask.assignee as any)) {
        reviewsList = upsertOriginalMaEntry(reviewsList, {
          userId: updatedTask.assignee.id,
          userName: updatedTask.assignee.name,
        });
      }
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

      // Clear PM assignment when returning to pool (preserve subtask assignments!)
      reviewsList = reviewsList.filter((r: any) => !(r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId));
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

    const prevTaskAssignees =
      currentTask.assignees && currentTask.assignees.length > 0
        ? currentTask.assignees
        : currentTask.assignee
          ? [currentTask.assignee]
          : [];
    const nextTaskAssignees =
      updatedTask.assignees && updatedTask.assignees.length > 0
        ? updatedTask.assignees
        : updatedTask.assignee
          ? [updatedTask.assignee]
          : [];
    const addedNames = nextTaskAssignees
      .filter((u) => !prevTaskAssignees.some((p) => p.id === u.id))
      .map((u) => u.name);
    const removedNames = prevTaskAssignees
      .filter((p) => !nextTaskAssignees.some((u) => u.id === p.id))
      .map((p) => p.name);
    const finalAssigneeName = updatedTask.assignee?.name || 'Unassigned';

    // AuditLog
    const assignLog = await prisma.auditLog.create({
      data: {
        action: 'ASSIGNMENT',
        entity: 'TASK',
        entityId: id,
        userId: user.id,
        details: {
          assigneeId: assigneeId || null,
          assigneeName: finalAssigneeName,
          added: addedNames,
          removed: removedNames,
          assignedBy: actorName,
          assignedAt: new Date().toISOString(),
        },
      },
    }).catch(() => null);

    const statusChanged =
      updateData.status &&
      (currentTask.status || '').trim().toUpperCase() !== String(updatedTask.status || '').trim().toUpperCase();
    const statusLog = statusChanged
      ? await prisma.auditLog.create({
          data: {
            action: 'STATUS_CHANGE',
            entity: 'TASK',
            entityId: id,
            userId: user.id,
            details: {
              oldStatus: currentTask.status,
              newStatus: updatedTask.status,
            },
          },
        }).catch(() => null)
      : null;

    // Broadcast realtime Socket.io events
    io.emit('task:updated', updatedTask);
    io.emit('task_map:updated', {
      taskId: id,
      task: updatedTask,
      taskMap: updatedRecord,
      assigneeId,
      handedOver,
      statuses: newStatuses,
    });
    io.emit('task_activity', {
      listId: updatedTask.listId,
      taskId: id,
      activity: {
        id: assignLog?.id || `assign-${Date.now()}`,
        type: 'assignment',
        author: actorName,
        assigneeName: finalAssigneeName,
        added: addedNames,
        removed: removedNames,
        date: assignLog?.createdAt || new Date(),
        user: actorUser,
      },
    });
    if (statusLog) {
      io.emit('task_activity', {
        listId: updatedTask.listId,
        taskId: id,
        activity: {
          id: statusLog.id,
          type: 'status_change',
          author: actorName,
          oldStatus: currentTask.status,
          newStatus: updatedTask.status,
          date: statusLog.createdAt,
          user: actorUser,
        },
      });
    }

    // Notify assigned / unassigned user on Task Map
    if (currentTask.assigneeId && currentTask.assigneeId !== user.id && currentTask.assigneeId !== assigneeId) {
      const oldToNotify = await filterUsersByNotificationPreference([currentTask.assigneeId], 'assigned').catch(() => []);
      if (oldToNotify.length > 0) {
        await prisma.taskNotification.create({
          data: {
            userId: currentTask.assigneeId,
            actorId: user.id,
            taskId: id,
            type: 'UNASSIGNMENT',
            title: `${actorName} unassigned you from task ${currentTask.title} on Task Map`,
          },
        }).catch(() => {});
        io.to(`user:${currentTask.assigneeId}`).emit('notification_received', {
          type: 'UNASSIGNMENT',
          taskId: id,
        });
      }
    }
    if (assigneeId && assigneeId !== user.id && currentTask.assigneeId !== assigneeId) {
      const newToNotify = await filterUsersByNotificationPreference([assigneeId], 'assigned').catch(() => []);
      if (newToNotify.length > 0) {
        await prisma.taskNotification.create({
          data: {
            userId: assigneeId,
            actorId: user.id,
            taskId: id,
            type: 'ASSIGNMENT',
            title: `${actorName} assigned you to task ${currentTask.title} on Task Map`,
          },
        }).catch(() => {});
        io.to(`user:${assigneeId}`).emit('notification_received', {
          type: 'ASSIGNMENT',
          taskId: id,
        });
      }
    }

    return res.json({ success: true, task: updatedTask, taskMap: updatedRecord });
  } catch (error: any) {
    logger.error({ error }, 'Error assigning task in Task Map');
    return res.status(500).json({ error: 'Failed to assign task' });
  }
}

export const assignTaskMapTask = async (req: Request, res: Response) => {
  const { assigneeId = null, mode = 'QUEUE' } = req.body || {};
  const normalizedMode: TaskMapMoveMode = mode === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'QUEUE';
  return executeTaskMapAssignment(req, res, {
    action: 'ASSIGN',
    assigneeId: assigneeId || null,
    mode: normalizedMode,
  });
};

export const transferTaskMapTask = async (req: Request, res: Response) => {
  const { targetUserId, assigneeId } = req.body || {};
  const resolvedTargetId = targetUserId ?? assigneeId ?? null;
  return executeTaskMapAssignment(req, res, {
    action: 'TRANSFER',
    assigneeId: resolvedTargetId,
    mode: 'QUEUE',
  });
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

      const nextDate = resolveNextShiftDate(record.shiftDate, nextDay);

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

      const nextDate = resolveNextShiftDate(rec.shiftDate, nextDay);
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
 * Lightweight, range-aware Launch Map feed (zero subtasks/checklists/Upwork overhead).
 * Strictly includes tasks with a Launch Date status/marker (`isLaunchDate`, `LAUNCH DATE` status,
 * or `LAUNCH DATE` sub-status), supporting exact dates and year-level/TBD target periods.
 * Supports optional ?start=YYYY-MM-DD&end=YYYY-MM-DD lazy loading for month/week ranges.
 */
export const getLaunchMapData = async (req: Request, res: Response) => {
  try {
    const rawStart = typeof req.query.start === 'string' ? req.query.start.trim().slice(0, 10) : '';
    const rawEnd = typeof req.query.end === 'string' ? req.query.end.trim().slice(0, 10) : '';
    const start = /^\d{4}-\d{2}-\d{2}$/.test(rawStart) ? rawStart : '';
    const end = /^\d{4}-\d{2}-\d{2}$/.test(rawEnd) ? rawEnd : '';

    const cacheKey = `launch_map:v3:data:${start || 'all'}:${end || 'all'}`;
    const cacheGen = getCacheGeneration(cacheKey);
    const cached = await getCache<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const [rawTasks, clientDashboardLists] = await Promise.all([
      prisma.task.findMany({
        where: {
          status: { notIn: ['KYC', 'PIN BOARD', 'PINBOARD'] },
          OR: [
            { dueDate: { not: null } },
            { taskMapRecord: { isNot: null } },
            { status: { contains: 'launch', mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          dueDate: true,
          listId: true,
          createdAt: true,
          updatedAt: true,
          list: {
            select: {
              id: true,
              name: true,
              folder: { select: { name: true } },
              statuses: {
                select: { name: true, color: true, groupName: true, order: true },
                orderBy: { order: 'asc' },
              },
            },
          },
          assignee: { select: { id: true, name: true, avatarUrl: true, imageUrl: true } },
          assignees: { select: { id: true, name: true, avatarUrl: true, imageUrl: true } },
          taskMapRecord: { select: { statuses: true, pmReviews: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      }),
      fetchClientDashboardLists().catch((err) => {
        logger.warn({ err }, 'Failed to query client dashboard folders for Launch Map');
        return [] as Array<{ id: string; name: string }>;
      }),
    ]);

    const items: any[] = [];
    const clientMap = new Map<string, { id: string; name: string; count: number }>();

    // Seed all clients from "Client Dashboard" so clients with 0 scheduled tasks still appear
    for (const c of clientDashboardLists) {
      if (ADMIN_LIST_NAMES.has(c.name.trim().toLowerCase())) continue;
      clientMap.set(c.id, { id: c.id, name: c.name, count: 0 });
    }

    let totalScheduled = 0;
    let totalInReview = 0;
    let totalMilestones = 0;
    let totalTbd = 0;

    for (const t of rawTasks) {
      const taskMapStatuses = Array.isArray(t.taskMapRecord?.statuses) ? t.taskMapRecord!.statuses : [];
      const { launchMeta, effectiveLaunchDate, targetPeriod, isLaunchDate } = extractLaunchMeta(
        t.taskMapRecord?.pmReviews,
        t.dueDate
      );

      // Strictly include only tasks with a Launch Date status/marker
      const hasLaunchStatus = hasLaunchDateMarker(t.status, taskMapStatuses, launchMeta);
      if (!hasLaunchStatus) continue;

      const resolvedTargetPeriod = !effectiveLaunchDate ? (targetPeriod || 'TBD') : null;
      if (!effectiveLaunchDate && !resolvedTargetPeriod) continue;

      const folderName = (t.list?.folder?.name || '').trim().toLowerCase();
      const listName = (t.list?.name || '').trim().toLowerCase();
      const isAdminTask =
        folderName === 'admin' ||
        folderName.includes('admin') ||
        listName === 'admin' ||
        ADMIN_LIST_NAMES.has(listName);

      const closed = isClosedStatus(t.status);
      const inReview = !closed && isReviewStatus(t.status);

      totalScheduled++;
      if (inReview) totalInReview++;
      if (isLaunchDate || hasLaunchStatus) totalMilestones++;
      if (!effectiveLaunchDate && resolvedTargetPeriod) totalTbd++;

      if (!isAdminTask && t.list?.id && t.list?.name) {
        const cur = clientMap.get(t.list.id);
        if (cur) cur.count++;
        else clientMap.set(t.list.id, { id: t.list.id, name: t.list.name, count: 1 });
      }

      // Range filter applies to exact-dated items; TBD/year-level items stay available for the TBD pill
      if (effectiveLaunchDate && start && end && (effectiveLaunchDate < start || effectiveLaunchDate > end)) {
        continue;
      }

      // Merge scalar assignee + multi-assignees deduplicated by id
      const mergedAssigneesMap = new Map<
        string,
        { id: string; name: string; avatarUrl?: string | null; imageUrl?: string | null }
      >();
      for (const a of t.assignees || []) {
        if (a?.id) mergedAssigneesMap.set(a.id, a);
      }
      if (t.assignee?.id && !mergedAssigneesMap.has(t.assignee.id)) {
        mergedAssigneesMap.set(t.assignee.id, t.assignee);
      }
      const mergedAssignees = Array.from(mergedAssigneesMap.values());

      items.push({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        listId: t.listId,
        list: t.list,
        assignee: t.assignee || mergedAssignees[0] || null,
        assignees: mergedAssignees,
        taskMapStatuses,
        isClosed: closed,
        isAdminTask,
        launchMeta: launchMeta
          ? { ...launchMeta, isLaunchDate: true }
          : {
              type: 'LAUNCH_META',
              launchDate: effectiveLaunchDate,
              targetPeriod: resolvedTargetPeriod,
              isLaunchDate: true,
              workstream: null,
              details: null,
              notes: null,
              updatedAt: t.updatedAt ? new Date(t.updatedAt).toISOString() : new Date().toISOString(),
              updatedById: null,
            },
        effectiveLaunchDate,
        targetPeriod: resolvedTargetPeriod,
        isLaunchDate: true,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      });
    }

    const payload = {
      success: true,
      items,
      clients: Array.from(clientMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      counts: {
        scheduled: totalScheduled,
        inReview: totalInReview,
        milestones: totalMilestones,
        tbd: totalTbd,
      },
    };

    await setCache(cacheKey, payload, 30, cacheGen);
    res.json(payload);
  } catch (error: any) {
    logger.error({ error }, 'Error fetching Launch Map data');
    res.status(500).json({ error: 'Failed to load Launch Map data' });
  }
};

/**
 * Lazy-loaded searchable task candidates for the Launch Map "+ Schedule" picker.
 * Supports searching by Task title, Client/List name, or exact Task UUID.
 */
export const getLaunchCandidates = async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const includeClosed = req.query.includeClosed === 'true';
    const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 25;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 40) : 25;

    const excludedStatuses = includeClosed
      ? ['KYC', 'PIN BOARD', 'PINBOARD']
      : ['KYC', 'PIN BOARD', 'PINBOARD', 'CLOSED', 'Closed', 'DONE', 'Done'];

    const where: any = {
      status: { notIn: excludedStatuses },
    };
    if (q) {
      const orClauses: any[] = [
        { title: { contains: q, mode: 'insensitive' } },
        { list: { name: { contains: q, mode: 'insensitive' } } },
      ];
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)) {
        orClauses.unshift({ id: q });
      }
      where.OR = orClauses;
    }

    const rows = await prisma.task.findMany({
      where,
      take: limit,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        dueDate: true,
        listId: true,
        list: {
          select: {
            id: true,
            name: true,
            statuses: {
              select: { name: true, color: true, groupName: true, order: true },
              orderBy: { order: 'asc' },
            },
          },
        },
        assignee: { select: { id: true, name: true, avatarUrl: true, imageUrl: true } },
        assignees: { select: { id: true, name: true, avatarUrl: true, imageUrl: true } },
        taskMapRecord: { select: { statuses: true, pmReviews: true } },
      },
    });

    const candidates = rows.map((t) => {
      const taskMapStatuses = Array.isArray(t.taskMapRecord?.statuses) ? t.taskMapRecord!.statuses : [];
      const { launchMeta, effectiveLaunchDate, targetPeriod, isLaunchDate } = extractLaunchMeta(
        t.taskMapRecord?.pmReviews,
        t.dueDate
      );
      const hasLaunchStatus = hasLaunchDateMarker(t.status, taskMapStatuses, launchMeta);

      const mergedAssigneesMap = new Map<
        string,
        { id: string; name: string; avatarUrl?: string | null; imageUrl?: string | null }
      >();
      for (const a of t.assignees || []) {
        if (a?.id) mergedAssigneesMap.set(a.id, a);
      }
      if (t.assignee?.id && !mergedAssigneesMap.has(t.assignee.id)) {
        mergedAssigneesMap.set(t.assignee.id, t.assignee);
      }
      const mergedAssignees = Array.from(mergedAssigneesMap.values());

      return {
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        listId: t.listId,
        list: t.list,
        assignee: t.assignee || mergedAssignees[0] || null,
        assignees: mergedAssignees,
        taskMapStatuses,
        launchMeta,
        effectiveLaunchDate,
        targetPeriod,
        isLaunchDate: isLaunchDate || hasLaunchStatus,
      };
    });

    res.json({ success: true, candidates });
  } catch (error: any) {
    logger.error({ error }, 'Error searching Launch Map candidates');
    res.status(500).json({ error: 'Failed to search tasks' });
  }
};

/**
 * Update Launch Map metadata (launchDate, targetPeriod, isLaunchDate milestone flag, workstream, details, notes)
 * and trigger IN REVIEW notification to Project Managers and Auditors if status is IN REVIEW.
 */
export const updateTaskLaunchMeta = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { launchDate, targetPeriod, isLaunchDate, workstream, details, notes, syncDueDate } = req.body || {};
    const user = (req as any).user;

    const target = parseTaskMapTargetId(id);
    if (target.isSubtask) {
      return res.status(400).json({ error: 'Launch Map schedules apply to main tasks' });
    }

    const result = await upsertTaskLaunchMeta(
      id,
      { launchDate, targetPeriod, isLaunchDate, workstream, details, notes, syncDueDate },
      user?.id || null
    );

    const alertRes = await triggerLaunchReviewAlertIfNeeded(id, {
      actingUserId: user?.id || null,
    });

    io.emit('task_map:updated', {
      taskId: id,
      launchMeta: result.launchMeta,
      effectiveLaunchDate: result.effectiveLaunchDate,
      targetPeriod: result.targetPeriod,
      dueDate: result.dueDate,
    });
    io.emit('task:updated', {
      id,
      dueDate: result.dueDate,
      launchMeta: result.launchMeta,
      effectiveLaunchDate: result.effectiveLaunchDate,
      targetPeriod: result.targetPeriod,
    });

    res.json({
      success: true,
      launchMeta: result.launchMeta,
      effectiveLaunchDate: result.effectiveLaunchDate,
      targetPeriod: result.targetPeriod,
      dueDate: result.dueDate,
      alertSent: alertRes.sent,
    });
  } catch (error: any) {
    logger.error({ error }, 'Error updating launch metadata');
    res.status(error?.message === 'Task not found' ? 404 : 400).json({
      error: error?.message || 'Failed to update launch metadata',
    });
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
    const rawMaSessions = await getMaActiveSessionsMap();
    const maSessionsByName: Record<string, any> = {};
    for (const [k, v] of Object.entries(rawMaSessions)) {
      maSessionsByName[k.toLowerCase().trim()] = v;
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
            status: 'IN REVIEW',
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
        revs = revs.filter((r: any) => !(r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId));
      } else {
        revs = [];
      }
      await updateTaskMapRecord(t.id, { statuses: cleanedStatuses, pmReviews: revs, handedOver: true });
      await invalidateCache(`task:${t.id}`, 'task_map:all', 'tasks:all');
      resetTaskIds.push(t.id);
    }

    // Also reset assigned non-closed subtasks for this user back to Available Tasks
    const assignedSubtasks = await prisma.subtask.findMany({
      where: {
        completed: false,
        OR: [
          { assigneeId: targetUserId },
          { assignees: { some: { id: targetUserId } } },
        ],
      },
      select: { id: true, taskId: true, status: true },
    });

    for (const st of assignedSubtasks) {
      const upperStatus = (st.status || '').toUpperCase().trim();
      if (['CLOSED', 'DONE', 'COMPLETE', 'COMPLETED', 'RESOLVED', 'CANCELLED'].includes(upperStatus)) {
        continue;
      }
      await prisma.subtask.update({
        where: { id: st.id },
        data: {
          assigneeId: null,
          assignees: { set: [] },
        },
      });
      const parentRec = await getOrCreateTaskMapRecord(st.taskId);
      let revs = parsePmReviewsArray(parentRec.pmReviews).filter(
        (r: any) => !(r?.type === 'PM_ASSIGNMENT' && r?.subtaskId === st.id)
      );
      const subIdx = revs.findIndex((r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === st.id);
      const existingSubStatuses = subIdx !== -1 && Array.isArray(revs[subIdx].statuses) ? revs[subIdx].statuses : [];
      const cleanedSubStatuses = existingSubStatuses.filter(
        (s: string) => !['IN PROGRESS', 'In progress', 'In Progress'].includes(s)
      );
      if (!cleanedSubStatuses.includes('Available Task')) {
        cleanedSubStatuses.push('Available Task');
      }
      const nextSubState = {
        type: 'SUBTASK_STATE',
        subtaskId: st.id,
        statuses: cleanedSubStatuses,
        handedOver: true,
        updatedAt: new Date().toISOString(),
      };
      if (subIdx !== -1) revs[subIdx] = nextSubState;
      else revs.push(nextSubState);

      await updateTaskMapRecord(st.taskId, { pmReviews: revs });
      await invalidateCache(`task:${st.taskId}`, `task:${st.id}`, 'task_map:all', 'tasks:all');
      resetTaskIds.push(`subtask:${st.id}`);
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

/**
 * GET /api/task-map/task-description?taskId=...&title=...&client=...
 * Lightweight lazy-lookup used when the user clicks Task Description or opens a session card project link.
 */
export const getTaskMapTaskDescription = async (req: Request, res: Response) => {
  try {
    const rawTaskId = typeof req.query.taskId === 'string' ? req.query.taskId.trim() : '';
    const rawTitle = typeof req.query.title === 'string' ? req.query.title.trim().replace(/\.{3}$/, '').trim() : '';
    const rawClient = typeof req.query.client === 'string' ? req.query.client.trim() : '';

    const cleanClient =
      rawClient && !['general', 'no client inputted', 'upwork'].includes(rawClient.toLowerCase())
        ? rawClient
        : '';
    const cleanTitle =
      rawTitle && !['general task', 'no task inputted'].includes(rawTitle.toLowerCase())
        ? rawTitle
        : '';

    const resolveRecordSubStatuses = (rec: any, subtaskId?: string | null): string[] | undefined => {
      if (!rec) return undefined;
      if (subtaskId) {
        const revs = parsePmReviewsArray(rec.pmReviews);
        const subState = revs.find((r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === subtaskId);
        return Array.isArray(subState?.statuses) ? subState.statuses : undefined;
      }
      return Array.isArray(rec.statuses) ? rec.statuses : undefined;
    };

    if (rawTaskId && !rawTaskId.startsWith('general-slot-')) {
      if (rawTaskId.startsWith('subtask:')) {
        const subId = rawTaskId.slice('subtask:'.length);
        const sub = await prisma.subtask.findUnique({
          where: { id: subId },
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            completed: true,
            taskId: true,
            task: { select: { listId: true, list: { select: { name: true } } } },
          },
        });
        if (sub) {
          const rec = await prisma.taskMapRecord.findUnique({
            where: { taskId: sub.taskId },
            select: { statuses: true, pmReviews: true },
          });
          return res.json({
            success: true,
            taskId: rawTaskId,
            listId: sub.task?.listId || null,
            listName: sub.task?.list?.name || null,
            status: sub.status || (sub.completed ? 'CLOSED' : 'PENDING'),
            priority: sub.priority || 'NORMAL',
            subStatuses: resolveRecordSubStatuses(rec, sub.id),
            description: sub.description || null,
          });
        }
      }

      const task = await prisma.task.findUnique({
        where: { id: rawTaskId },
        select: {
          id: true,
          listId: true,
          status: true,
          priority: true,
          description: true,
          list: { select: { name: true } },
        },
      });
      if (task) {
        const rec = await prisma.taskMapRecord.findUnique({
          where: { taskId: task.id },
          select: { statuses: true },
        });
        return res.json({
          success: true,
          taskId: task.id,
          listId: task.listId || null,
          listName: task.list?.name || null,
          status: task.status || null,
          priority: task.priority || null,
          subStatuses: Array.isArray(rec?.statuses) ? rec.statuses : undefined,
          description: task.description || null,
        });
      }
    }

    let matchedList: { id: string; name: string } | null = null;
    if (cleanClient) {
      matchedList = await prisma.list.findFirst({
        where: { name: { equals: cleanClient, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      if (!matchedList && cleanClient.length >= 3) {
        const listCandidates = await prisma.list.findMany({
          where: { name: { startsWith: cleanClient, mode: 'insensitive' } },
          select: { id: true, name: true },
          take: 2,
        });
        if (listCandidates.length === 1) {
          matchedList = listCandidates[0];
        }
      }
    }

    let matchedTask: {
      id: string;
      listId: string;
      status: string;
      priority: string;
      description: string | null;
      list: { name: string } | null;
    } | null = null;

    if (cleanTitle) {
      if (matchedList) {
        matchedTask = await prisma.task.findFirst({
          where: { listId: matchedList.id, title: { equals: cleanTitle, mode: 'insensitive' } },
          select: { id: true, listId: true, status: true, priority: true, description: true, list: { select: { name: true } } },
        });
        if (!matchedTask && cleanTitle.length >= 4) {
          const candidates = await prisma.task.findMany({
            where: { listId: matchedList.id, title: { contains: cleanTitle, mode: 'insensitive' } },
            select: { id: true, listId: true, status: true, priority: true, description: true, list: { select: { name: true } } },
            take: 2,
          });
          if (candidates.length === 1) matchedTask = candidates[0];
        }
      }

      if (!matchedTask) {
        matchedTask = await prisma.task.findFirst({
          where: { title: { equals: cleanTitle, mode: 'insensitive' } },
          select: { id: true, listId: true, status: true, priority: true, description: true, list: { select: { name: true } } },
        });
        if (!matchedTask && cleanTitle.length >= 4) {
          const candidates = await prisma.task.findMany({
            where: { title: { contains: cleanTitle, mode: 'insensitive' } },
            select: { id: true, listId: true, status: true, priority: true, description: true, list: { select: { name: true } } },
            take: 2,
          });
          if (candidates.length === 1) matchedTask = candidates[0];
        }
      }
    }

    if (matchedTask) {
      const rec = await prisma.taskMapRecord.findUnique({
        where: { taskId: matchedTask.id },
        select: { statuses: true },
      });
      return res.json({
        success: true,
        taskId: matchedTask.id,
        listId: matchedTask.listId || matchedList?.id || null,
        listName: matchedTask.list?.name || matchedList?.name || null,
        status: matchedTask.status || null,
        priority: matchedTask.priority || null,
        subStatuses: Array.isArray(rec?.statuses) ? rec.statuses : undefined,
        description: matchedTask.description || null,
      });
    }

    return res.json({
      success: true,
      taskId: null,
      listId: matchedList?.id || null,
      listName: matchedList?.name || null,
      status: null,
      priority: null,
      subStatuses: undefined,
      description: null,
    });
  } catch (error: any) {
    logger.error({ error }, 'Error fetching Task Map task description');
    return res.status(500).json({ error: 'Failed to fetch task description' });
  }
};

/**
 * GET /api/task-map/crm/follow-ups
 * Lists all Sent but Waiting tasks at Day 4+ requiring a CRM follow-up response today.
 */
export const getPendingCrmFollowUpsHandler = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const items = await listPendingCrmFollowUps();
    return res.json({ success: true, items });
  } catch (error: any) {
    logger.error({ error }, 'Error fetching pending CRM follow-ups');
    return res.status(500).json({ error: 'Failed to fetch pending CRM follow-ups' });
  }
};

/**
 * POST /api/task-map/crm/follow-ups/:id/respond
 * Records a required CRM follow-up response (note + action) for a Day 4+ waiting task.
 */
export const respondCrmFollowUpHandler = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { id } = req.params;
    const { note, action = 'FOLLOWED_UP', parentCommentId } = req.body || {};

    const validActions = new Set(['FOLLOWED_UP', 'REVISIONS', 'MOVE_TO_POOL', 'CLOSED']);
    const normalizedAction = String(action || 'FOLLOWED_UP').toUpperCase();
    if (!validActions.has(normalizedAction)) {
      return res.status(400).json({ error: 'Invalid follow-up response action' });
    }

    const result = await respondToCrmFollowUp({
      taskId: id,
      userId: user.id,
      note,
      action: normalizedAction as any,
      parentCommentId: parentCommentId ? String(parentCommentId) : null,
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        error: result.error || 'Failed to submit follow-up response',
        uncheckedAudits: result.uncheckedAudits,
        openSubtasks: result.openSubtasks,
      });
    }

    return res.json({ success: true, task: result.task, comment: result.comment });
  } catch (error: any) {
    logger.error({ error }, 'Error responding to CRM follow-up');
    return res.status(500).json({ error: 'Failed to submit follow-up response' });
  }
};

/**
 * POST /api/task-map/crm/follow-ups/acknowledge
 * Acknowledges that the user reviewed the CRM follow-up report for active clients,
 * creating an AuditLog row on each task (viewable inside TaskDetailModal).
 */
export const acknowledgeCrmFollowUpsHandler = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { taskIds } = req.body || {};
    const ids: string[] = Array.isArray(taskIds)
      ? taskIds
      : req.params.id
      ? [req.params.id]
      : [];

    if (ids.length === 0) {
      return res.status(400).json({ error: 'No task IDs provided' });
    }

    const result = await acknowledgeCrmFollowUps({
      taskIds: ids,
      userId: user.id,
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        error: result.error || 'Failed to acknowledge follow-up report',
      });
    }

    return res.json({ success: true, count: result.count });
  } catch (error: any) {
    logger.error({ error }, 'Error acknowledging CRM follow-up report');
    return res.status(500).json({ error: 'Failed to acknowledge follow-up report' });
  }
};

