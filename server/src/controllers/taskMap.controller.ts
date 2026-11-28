import type { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { io } from '../server';
import { logger } from '../config/logger';
import { invalidateCache, getCache, setCache, getCacheGeneration, redis, isRedisReady, getMaActiveSessionsMap, getMaActiveSession, setMaActiveSession, deleteMaActiveSession } from '../services/redisService';
import { isReviewStatus } from '../utils/auditChecklist';
import { plainTextToCommentHtml } from '../utils/commentHtml';
import { canUserSetAssignees } from '../utils/assignPermission';
import { filterUsersByNotificationPreference } from '../utils/notificationPreferences';
import { generateDailyOtpForUser, verifyDailyOtp, setClientUnlockedToday, getManilaDateString, isUserProjectManagerOrAdmin, notifyAdminsOfClientOtpUnlock } from '../utils/dailyOtp';
import { checkClientLockStatus } from '../services/clientLockService';
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
  createLaunchRecord,
  updateLaunchRecord,
  formatLaunchRecordToItem,
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
import {
  upsertDailySheetLog,
  closeLiveDailySheetLogsForTask,
  getDailySheetLogsForDate,
  getDailySheetLogsIndexForDate,
} from '../services/dailySheetLogService';
import { checkMaSheetActivityStatus } from '../services/maInactivityService';
import { enqueueSpreadsheetSync, SpreadsheetSyncJobPayload } from '../workers/spreadsheetSync.worker';

// Closed status check matching Nexus conventions
const isClosedStatus = (status?: string | null) => {
  const s = (status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  return s === 'CLOSED' || s === 'DONE' || s === 'COMPLETE' || s === 'COMPLETED' || s === 'RESOLVED' || s === 'CANCELLED';
};

const CRM_TAG_SET = new Set([
  'CRM',
  'CRM NEEDED TO SEND',
  'CRM_TO_SEND',
  'CRM NEEDED TO FOLLOW UP',
  'CRM_FOLLOW_UP',
  'SENT',
  'SENT BUT WAITING',
  'SENTBUTWAITING',
  'WAITING',
  'OUTREACH SENT',
  'CLIENT SENT',
  'TO SEND',
  'TO FOLLOW UP',
  'TOFOLLOWUP',
  'FOLLOW UP',
  'FOLLOW-UP 1 DAY',
  'FOLLOW-UP 3RD DAY',
  'FOLLOW-UP 5TH DAY',
  'FOLLOW-UP 1 WEEK',
  'TOSEND',
  'READY TO SEND',
  'READYTOSEND',
  'ASK CLIENT',
  'ASKCLIENT',
  'FOLLOW UP',
  'FOLLOWUP',
  'OUTREACH',
  'CLOSED',
  'DONE',
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

function buildProgressFromSheetLog(sheetLog: any) {
  if (!sheetLog) return null;
  return {
    type: 'SHEET_PROGRESS',
    dailySheetLogId: sheetLog.id,
    timeIn: sheetLog.timeIn,
    timeOut: sheetLog.timeOut,
    isMissingTime: sheetLog.isMissingTime,
    isUpwork: sheetLog.isUpwork,
    client: sheetLog.client,
    timeTracker: sheetLog.timeTracker,
    maName: sheetLog.maName,
    status: sheetLog.status,
    date: sheetLog.dateDisplay || sheetLog.dateKey,
    dateKey: sheetLog.dateKey,
    sheetRow: sheetLog.sheetRow ?? undefined,
    subtaskId: sheetLog.subtaskId || null,
    taskDeliverables: sheetLog.taskDeliverables,
    taskUpdateAndDeliverables: sheetLog.taskUpdateAndDeliverables,
    isLive: sheetLog.isLive,
    startedAt: sheetLog.startedAt ? new Date(sheetLog.startedAt).toISOString() : null,
    updatedAt: sheetLog.submittedAt ? new Date(sheetLog.submittedAt).toISOString() : new Date().toISOString(),
  };
}

/**
 * Closes any older open SHEET_PROGRESS sessions on other TaskMapRecords for the same MA
 * when starting a new IN_PROGRESS task from the board so no previous card lingers as Live Working.
 */
async function closeOtherOpenBoardSessionsForMa(
  maName: string,
  excludeTaskId: string,
  excludeSubtaskId: string | null,
  closeTimeOut: string
) {
  const maKey = (maName || '').trim().toLowerCase();
  if (!maKey) return;
  try {
    const escapedMaKey = maKey.replace(/[\\%_]/g, '\\$&');
    const recordsWithReviews = await prisma.$queryRawUnsafe<
      Array<{ taskId: string; statuses: string[]; pmReviews: any }>
    >(
      `SELECT "taskId", "statuses", "pmReviews"
       FROM "TaskMapRecord"
       WHERE "pmReviews" IS NOT NULL
         AND "pmReviews"::text ILIKE '%SHEET_PROGRESS%'
         AND "pmReviews"::text ILIKE $1 ESCAPE '\\'`,
      `%${escapedMaKey}%`
    );
    for (const rec of recordsWithReviews) {
      let revs = parsePmReviewsArray(rec.pmReviews);
      let modified = false;
      let closedMainProgress = false;
      const closedSubtaskIds: string[] = [];

      revs = revs.map((r: any) => {
        if (!r || r.type !== 'SHEET_PROGRESS' || !r.timeIn || r.timeOut) return r;
        const rMa = (r.maName || '').trim().toLowerCase();
        if (rMa !== maKey) return r;
        const isCurrentTarget =
          rec.taskId === excludeTaskId &&
          (excludeSubtaskId ? r.subtaskId === excludeSubtaskId : !r.subtaskId);
        if (isCurrentTarget) return r;
        modified = true;
        if (r.subtaskId) {
          closedSubtaskIds.push(r.subtaskId);
        } else {
          closedMainProgress = true;
        }
        return { ...r, timeOut: closeTimeOut, isLive: false, updatedAt: new Date().toISOString() };
      });

      if (!modified) continue;

      let nextStatuses = Array.isArray(rec.statuses) ? [...rec.statuses] : [];
      if (closedMainProgress) {
        nextStatuses = nextStatuses.filter(
          (s: string) => s.toUpperCase().replace(/[\s_-]+/g, '') !== 'INPROGRESS'
        );
      }
      if (closedSubtaskIds.length > 0) {
        revs = revs.map((r: any) => {
          if (r?.type === 'SUBTASK_STATE' && closedSubtaskIds.includes(r.subtaskId) && Array.isArray(r.statuses)) {
            return {
              ...r,
              statuses: r.statuses.filter((s: string) => s.toUpperCase().replace(/[\s_-]+/g, '') !== 'INPROGRESS'),
            };
          }
          return r;
        });
      }

      await prisma.$executeRawUnsafe(
        `UPDATE "TaskMapRecord" SET "pmReviews" = $1::jsonb, "statuses" = $2::text[], "updatedAt" = NOW() WHERE "taskId" = $3`,
        JSON.stringify(revs),
        nextStatuses,
        rec.taskId
      );
      await invalidateCache(`task:${rec.taskId}`, 'task_map:*').catch(() => {});
      if (closedMainProgress) {
        io.emit('task_map:updated', {
          taskId: rec.taskId,
          statuses: nextStatuses,
          progress: revs.find((r: any) => r?.type === 'SHEET_PROGRESS' && !r?.subtaskId) || null,
        });
      }
      for (const subId of closedSubtaskIds) {
        const subState = revs.find((r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === subId);
        io.emit('task_map:updated', {
          taskId: `subtask:${subId}`,
          subtaskId: subId,
          parentTaskId: rec.taskId,
          statuses: subState?.statuses,
          progress: revs.find((r: any) => r?.type === 'SHEET_PROGRESS' && r?.subtaskId === subId) || null,
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed closing older open board sessions for MA');
  }
}

/**
 * Clears every MA active session (Redis ma_active_sessions) that points at this task or subtask.
 * Without this, a task dragged back to Queue keeps rendering as the MA's In Progress card,
 * because the board builds the user's live slot from the held session.
 */
async function clearMaSessionsForTarget(taskId: string, subtaskId: string | null) {
  try {
    const sessions = await getMaActiveSessionsMap();
    for (const [key, s] of Object.entries(sessions)) {
      if (!s || s.cleared) continue;
      const matches = subtaskId ? s.subtaskId === subtaskId : s.taskId === taskId && !s.subtaskId;
      if (!matches) continue;
      await deleteMaActiveSession(key).catch(() => {});
      // maName = the Redis key, so the frontend store (keyed by lowercased maName) drops the same entry
      const clearedPayload = { maName: key, cleared: true, taskId: subtaskId ? `subtask:${subtaskId}` : taskId };
      io.emit('ma:session_updated', clearedPayload);
      io.emit('task_map:ma_progress_changed', clearedPayload);
      io.emit('task_map:updated', { maSession: clearedPayload, taskId: clearedPayload.taskId });
    }
  } catch (err) {
    logger.warn({ err }, 'Failed clearing MA sessions for queued task');
  }
}

async function hasLiveSheetSessionForTarget(maName: string, taskId: string, subtaskId?: string | null): Promise<boolean> {
  const maKey = (maName || '').trim().toLowerCase();
  if (!maKey) return false;
  const dateKey = getManilaDateStr();
  const live = await prisma.dailySheetLog.findFirst({
    where: {
      dateKey,
      maKey,
      taskId,
      subtaskId: subtaskId || null,
      isLive: true,
      timeOut: null,
    },
    select: { id: true },
  }).catch(() => null);
  return Boolean(live);
}

/**
 * Enqueues the n8n Google Sheets schedule sync into the rate-limited BullMQ worker
 * (with per-spreadsheet locking, exponential backoff, cached tab resolution, and sheetRow write-back).
 * Falls back to direct execution automatically if Redis is unavailable.
 */
async function triggerN8nStartTaskWebhook(params: SpreadsheetSyncJobPayload) {
  // 1. Direct Apps Script Web App execution (Runs native Apps Script code in the spreadsheet)
  let scriptAppUrl: string | null = null;
  if (params.userId) {
    const u = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { notificationPreferences: true },
    }).catch(() => null);
    scriptAppUrl = (u?.notificationPreferences as any)?.dailySheetScriptUrl || null;
  }

  if (scriptAppUrl) {
    const resolvedSheetName = params.sheetName || process.env.N8N_DEFAULT_SHEET_NAME || '2025';
    try {
      const appScriptPayload = {
        action: params.mode === 'STOP' ? 'stop' : (params.mode === 'UPDATE' ? 'sync' : 'start'),
        sheetName: resolvedSheetName,
        client: params.clientName,
        task: params.taskTitle,
        timeIn: params.timeIn,
        timeOut: params.timeOut,
        timeTracker: params.timeTracker,
        taskLink: params.taskLink,
        status: params.status,
        sheetRow: params.sheetRow,
        taskDeliverablesDescription: params.taskDeliverablesDescription || params.description,
        taskUpdateAndDeliverables: params.taskUpdateAndDeliverables,
      };
      const scriptRes = await fetch(scriptAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appScriptPayload),
        signal: AbortSignal.timeout(15000),
      });
      if (scriptRes.ok) {
        const resTxt = await scriptRes.text().catch(() => '');
        logger.info(`[AppsScript Direct] Native script execution succeeded for ${params.userName} (mode: ${params.mode || 'START'}): ${resTxt.substring(0, 100)}`);
        return;
      }
      logger.warn(`[AppsScript Direct] HTTP ${scriptRes.status} for ${params.userName}, falling back to n8n webhook`);
    } catch (err: any) {
      logger.warn(`[AppsScript Direct] Call failed for ${params.userName}: ${err.message}, falling back to n8n webhook`);
    }
  }

  await enqueueSpreadsheetSync(params);
}

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
/**
 * Extracts task/subtask/external IDs from a Nexus or ClickUp URL or raw ID query.
 */
function extractTaskLinkIds(query: string): { isLink: boolean; ids: string[] } {
  const raw = (query || '').trim();
  if (!raw) return { isLink: false, ids: [] };

  const ids = new Set<string>();
  const isUrlLike =
    /^https?:\/\//i.test(raw) ||
    raw.startsWith('/') ||
    raw.startsWith('?') ||
    /(?:nexus\.vipscaleph\.com|app\.clickup\.com)/i.test(raw);

  if (isUrlLike) {
    try {
      const url =
        raw.startsWith('/') || raw.startsWith('?')
          ? new URL(raw, 'https://nexus.vipscaleph.com')
          : /^https?:\/\//i.test(raw)
            ? new URL(raw)
            : new URL(`https://${raw}`);
      const taskParam = url.searchParams.get('task');
      const subtaskParam = url.searchParams.get('subtask');
      if (taskParam) ids.add(taskParam.trim().toLowerCase());
      if (subtaskParam) ids.add(subtaskParam.trim().toLowerCase());

      const nexusTaskMatch = url.pathname.match(/\/tasks\/([a-zA-Z0-9_-]+)/i);
      if (nexusTaskMatch?.[1]) ids.add(nexusTaskMatch[1].trim().toLowerCase());

      const clickupMatch = url.pathname.match(/\/t\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?/i);
      if (clickupMatch?.[1]) ids.add(clickupMatch[1].trim().toLowerCase());
      if (clickupMatch?.[2]) ids.add(clickupMatch[2].trim().toLowerCase());
    } catch {
      for (const m of raw.matchAll(/[?&](?:task|subtask)=([a-zA-Z0-9_-]+)/gi)) {
        if (m[1]) ids.add(m[1].trim().toLowerCase());
      }
      const pathMatch = raw.match(/\/(?:tasks|t)\/([a-zA-Z0-9_-]+)/i);
      if (pathMatch?.[1]) ids.add(pathMatch[1].trim().toLowerCase());
    }
  } else if (/^[a-zA-Z0-9_-]{6,}$/.test(raw)) {
    ids.add(raw.toLowerCase());
  }

  return { isLink: isUrlLike, ids: Array.from(ids) };
}

function matchesTaskSearchQuery(task: any, searchQuery: string): boolean {
  if (!searchQuery) return true;
  const { isLink, ids } = extractTaskLinkIds(searchQuery);
  if (ids.length > 0) {
    const candidates = [task.id, task.subtaskId, task.parentTaskId, task.externalId]
      .filter(Boolean)
      .map((v) => String(v).trim().toLowerCase());
    if (candidates.some((c) => ids.includes(c))) return true;
    if (!isLink && ids.length === 1 && ids[0].length >= 6 && candidates.some((c) => c.includes(ids[0]))) {
      return true;
    }
    if (isLink) return false;
  }

  const titleMatch = (task.title || '').toLowerCase().includes(searchQuery);
  const clientMatch = (task.list?.name || '').toLowerCase().includes(searchQuery);
  const assigneeMatch =
    (task.assignee?.name || '').toLowerCase().includes(searchQuery) ||
    (task.assignees || []).some((a: any) => (a.name || '').toLowerCase().includes(searchQuery)) ||
    (task.progress?.maName || '').toLowerCase().includes(searchQuery) ||
    (task.progress?.userName || '').toLowerCase().includes(searchQuery);
  const statusMatch = (task.taskMap?.statuses || []).some((s: string) => s.toLowerCase().includes(searchQuery));
  return titleMatch || clientMatch || assigneeMatch || statusMatch;
}

/**
 * Resolves shiftUsers strictly from AuditShiftConfig for the requested shift tokens.
 */
async function resolveShiftUsersForTokens(
  users: any[],
  shiftTokens: string[],
  isAllShifts: boolean
): Promise<any[]> {
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

  const hasExplicitIds = shiftMemberIdSet.size > 0 || shiftAuditorIdSet.size > 0;

  return users
    .filter((u) => {
      if (isAllShifts && !hasExplicitIds && shiftMemberNameSet.size === 0 && shiftAuditorNameSet.size === 0) {
        return true;
      }
      if (shiftMemberIdSet.has(u.id) || shiftAuditorIdSet.has(u.id)) return true;
      const uName = (u.name || '').trim().toLowerCase();
      if (!uName) return false;
      if (shiftMemberNameSet.has(uName) || shiftAuditorNameSet.has(uName)) {
        return true;
      }
      if (!hasExplicitIds) {
        for (const token of [...shiftMemberNameSet, ...shiftAuditorNameSet]) {
          if (token && (uName.startsWith(`${token} `) || (token.length >= 3 && uName.includes(token)))) {
            return true;
          }
        }
      }
      return false;
    })
    .map((u) => ({
      ...u,
      isAudit: isAuditorRole(u.roles) || shiftAuditorIdSet.has(u.id),
    }));
}

export const getTaskMapData = async (req: Request, res: Response) => {
  try {
    const shiftQuery = (req.query.shift as string || '').toUpperCase();
    const dateQuery = req.query.date as string || '';
    const searchQuery = (req.query.search as string || '').toLowerCase().trim();
    const clientQuery = (req.query.client as string || '').trim();
    const isCompact = req.query.compact === '1' || req.query.compact === 'true';

    const formatTaskMapPayload = (payload: any) => {
      if (!payload || typeof payload !== 'object') return payload;
      const tasksArr: any[] = Array.isArray(payload.tasks) ? payload.tasks : [];
      const poolIds: string[] = Array.isArray(payload.availablePoolIds)
        ? payload.availablePoolIds
        : Array.isArray(payload.availablePool)
          ? payload.availablePool.map((t: any) => t.id)
          : [];

      if (isCompact) {
        // Ensure every availablePool item exists in tasks before omitting duplicate availablePool array
        if (Array.isArray(payload.availablePool) && payload.availablePool.length > 0) {
          const taskIdSet = new Set(tasksArr.map((t: any) => t.id));
          const allPresent = payload.availablePool.every((t: any) => taskIdSet.has(t.id));
          if (!allPresent) {
            return { ...payload, availablePoolIds: poolIds };
          }
        }
        const { availablePool: _omitted, ...rest } = payload;
        return { ...rest, availablePoolIds: poolIds };
      }

      if (Array.isArray(payload.availablePool)) {
        return payload;
      }
      const byId = new Map<string, any>();
      for (const t of tasksArr) {
        byId.set(t.id, t);
      }
      const hydratedPool = poolIds.map((id) => byId.get(id)).filter(Boolean);
      return { ...payload, availablePool: hydratedPool };
    };

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
      return res.json(formatTaskMapPayload(cachedData));
    }

    const singleFlightKey = `${cacheKey}:${cacheGen}`;
    const existingInFlight = inFlightTaskMapQueries.get(singleFlightKey);
    if (existingInFlight) {
      const coalescedPayload = await existingInFlight;
      return res.json(formatTaskMapPayload(coalescedPayload));
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
            return rolesStr.includes('pm') || rolesStr.includes('project manager') || rolesStr.includes('team lead') || rolesStr.includes('senior pm') || rolesStr.includes('senior project manager');
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
              s === 'CRM' || s.includes('CRM') ||
              s === 'INREVIEW' || s === 'TOREVIEW' || s === 'REVIEW' ||
              s === 'CHECKING' || s === 'INCHECKING' ||
              s === 'DAILY' || s.includes('DAILY') ||
              s === 'WEEKLY' || s.includes('WEEKLY') ||
              s === 'MONTHLY' || s.includes('MONTHLY') ||
              s === 'RECURRING' || s.includes('RECURRING') ||
              Boolean(t.recurringConfig) ||
              mapStatuses.some((st: string) =>
                ['CRM', 'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING', 'INREVIEW', 'TOREVIEW', 'CHECKING', 'INCHECKING'].includes(st)
              )
            );
          });
        }

        if (searchQuery) {
          tasks = tasks.filter((task: any) => matchesTaskSearchQuery(task, searchQuery));
          availablePool = availablePool.filter((task: any) => matchesTaskSearchQuery(task, searchQuery));
        }

        const filteredSnapshotShiftUsers = await resolveShiftUsersForTokens(
          snapshotAllUsers.length > 0 ? snapshotAllUsers : snapshotShiftUsers,
          shiftTokens,
          isAllShifts
        );

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
          shiftUsers: filteredSnapshotShiftUsers,
          activeUpworkSessions: existingSnapshot.activeUpworkSessions || [],
          upworkClients: existingSnapshot.upworkClients || [],
          upworkProjectClients: existingSnapshot.upworkProjectClients || [],
          maActiveSessions: existingSnapshot.maActiveSessions || {},
          dailySheetLogs: await getDailySheetLogsForDate(requestedDate).catch(() => existingSnapshot.dailySheetLogs || []),
        };
        await setCache(cacheKey, historyPayload, 3600, cacheGen);
        return historyPayload;
      }
    }

    const kycPinboardExclusion = ['KYC', 'PIN BOARD', 'PINBOARD'].map((s) => ({
      status: { equals: s, mode: 'insensitive' as const },
    }));
    const closedOrExcludedFilters = CLOSED_OR_EXCLUDED_STATUS_VARIANTS.map((s) => ({
      status: { equals: s, mode: 'insensitive' as const },
    }));
    // Explicit select omits heavy HTML/rich-text `description` blobs on initial board load
    // (lazy-fetched on click via GET /api/task-map/task-description) and omits per-task `list.statuses`
    // (loaded once per list below and attached in memory, eliminating repeated joins across every task).
    const taskBoardSelect = {
      id: true,
      title: true,
      priority: true,
      listId: true,
      creatorId: true,
      createdAt: true,
      updatedAt: true,
      assigneeId: true,
      dueDate: true,
      startDate: true,
      status: true,
      teamId: true,
      externalId: true,
      assigneeRoleRestrictions: true,
      teamAssignAccessRole: true,
      position: true,
      rolloverExcluded: true,
      recurringConfig: true,
      estimatedHours: true,
      launchDate: true,
      list: {
        select: {
          id: true,
          name: true,
          folder: { select: { id: true, name: true } },
        },
      },
      assignee: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true, dailySheetUrl: true } },
      assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true, dailySheetUrl: true } },
      creator: { select: { id: true, name: true, email: true, avatarUrl: true } },
      subtasks: {
        where: { completed: false },
        select: {
          id: true,
          title: true,
          taskId: true,
          createdAt: true,
          completed: true,
          status: true,
          dueDate: true,
          priority: true,
          assigneeId: true,
          teamId: true,
          assigneeRoleRestrictions: true,
          teamAssignAccessRole: true,
          externalId: true,
          estimatedHours: true,
          User: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
          assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
          checklists: {
            where: { name: { equals: 'Audit', mode: 'insensitive' as const } },
            include: { items: true },
          },
        },
        orderBy: { createdAt: 'asc' as const },
      },
      checklists: {
        // The task's own; subtask Audit checklists (same taskId) come with each subtask above.
        where: { subtaskId: null, name: { equals: 'Audit', mode: 'insensitive' as const } },
        include: { items: true },
      },
      _count: {
        select: {
          subtasks: { where: { NOT: { title: { contains: '--audit', mode: 'insensitive' as const } } } },
        },
      },
    };

    // Fetch all independent board datasets in a single parallel round-trip
    // (open tasks, per-list statuses, TaskMapRecords, metadata, users, daily sheet index, client lists, Upwork lists, MA sessions, supervise checks)
    const [
      records,
      openDbTasks,
      listStatuses,
      rawOptions,
      shifts,
      allUsers,
      workspaceRoles,
      workspaceTeams,
      dailySheetIndex,
      clientDashboardLists,
      upworkClients,
      upworkProjectClients,
      maActiveSessions,
      activeSuperviseChecks,
    ] = await Promise.all([
      prisma.$queryRawUnsafe<TaskMapRecordData[]>(
        `SELECT r.*
         FROM "TaskMapRecord" r
         INNER JOIN "Task" t ON t."id" = r."taskId"
         WHERE UPPER(TRIM(COALESCE(t."status", ''))) NOT IN ('KYC', 'PIN BOARD', 'PINBOARD')
           AND (
             UPPER(TRIM(COALESCE(t."status", ''))) NOT IN ('CLOSED', 'DONE', 'COMPLETED', 'COMPLETE', 'RESOLVED', 'CANCELLED')
             OR r."updatedAt" >= NOW() - INTERVAL '45 days'
           )
         ORDER BY r."updatedAt" DESC`
      ),
      prisma.task.findMany({
        where: {
          AND: [
            { NOT: { OR: kycPinboardExclusion } },
            { NOT: { OR: closedOrExcludedFilters } },
          ],
        },
        select: taskBoardSelect,
        orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      }),
      prisma.list.findMany({
        select: {
          id: true,
          statuses: {
            select: { name: true, color: true, groupName: true, order: true },
            orderBy: { order: 'asc' },
          },
        },
      }),
      getStatusOptions(),
      getShiftConfigs(),
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
      getDailySheetLogsIndexForDate(requestedDate),
      fetchClientDashboardLists().catch((err: any) => {
        logger.warn({ err }, 'Failed to query client dashboard folders');
        return [] as Array<{ id: string; name: string }>;
      }),
      getUpworkClients(),
      getUpworkProjectClients(),
      getMaActiveSessionsMap(),
      (prisma as any).superviseCheck.findMany({
        where: {
          dateKey: requestedDate,
          reappearAt: { gt: new Date() },
        },
        orderBy: { checkedAt: 'desc' },
      }).catch(() => []),
    ]);

    const recordsMap = new Map<string, TaskMapRecordData>();
    const openTaskIdSet = new Set(openDbTasks.map((t) => t.id));
    const closedCrmCandidateTaskIds: string[] = [];
    const MAX_CLOSED_CRM_CANDIDATES = 60;
    for (const r of records) {
      recordsMap.set(r.taskId, r);
      const hasCrmTag = Array.isArray(r.statuses) && r.statuses.some((st) => CRM_TAG_SET.has((st || '').toUpperCase().trim()));
      if (hasCrmTag && !openTaskIdSet.has(r.taskId) && closedCrmCandidateTaskIds.length < MAX_CLOSED_CRM_CANDIDATES) {
        closedCrmCandidateTaskIds.push(r.taskId);
      }
    }

    // Fetch bounded recent closed CRM-tagged tasks (PK index lookup, max 60) and resolve shift users in parallel
    const [closedCrmTasks, shiftUsers] = await Promise.all([
      closedCrmCandidateTaskIds.length > 0
        ? prisma.task.findMany({
            where: {
              AND: [
                { NOT: { OR: kycPinboardExclusion } },
                { OR: closedOrExcludedFilters },
                { id: { in: closedCrmCandidateTaskIds } },
              ],
            },
            select: taskBoardSelect,
          })
        : Promise.resolve([] as typeof openDbTasks),
      resolveShiftUsersForTokens(allUsers, shiftTokens, isAllShifts),
    ]);

    const statusesByList = new Map(listStatuses.map((l) => [l.id, l.statuses]));
    const tasks = closedCrmTasks.length > 0 ? [...openDbTasks, ...closedCrmTasks] : openDbTasks;
    if (closedCrmTasks.length > 0) {
      // Preserve single-query order: position asc, then newest createdAt first
      tasks.sort(
        (a, b) =>
          (a.position === b.position ? 0 : (a.position ?? Infinity) - (b.position ?? Infinity)) ||
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }
    for (const task of tasks as any[]) {
      if (task.list) task.list.statuses = statusesByList.get(task.list.id) || [];
    }

    // Options: filter out obsolete static Upwork options & internal client tags
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

    const isPmUser = (u: any) => {
      if (u.systemRole === 'ADMIN') return true;
      const rolesStr = (u.roles || []).join(' ').toLowerCase();
      if (rolesStr.includes('pm') || rolesStr.includes('project manager') || rolesStr.includes('team lead') || rolesStr.includes('senior pm') || rolesStr.includes('senior project manager')) {
        return true;
      }
      const nameUp = (u.name || '').toUpperCase();
      return nameUp.includes('CHE') || nameUp.includes('PAU') || nameUp.includes('HAN');
    };

    const pmUsers = allUsers.filter(isPmUser);

    const deriveDefaultMapStatuses = (rawStatus?: string | null, isAssignedToMember = false): string[] => {
      const statusKey = (rawStatus || '').toUpperCase().replace(/[\s_-]+/g, '');
      if (statusKey === 'CRM' || statusKey === 'TOSEND' || statusKey === 'CRMNEEDEDTOSEND' || statusKey === 'CRMTOSEND') return ['To send'];
      if (statusKey === 'TOFOLLOWUP' || statusKey === 'CRMNEEDEDTOFOLLOWUP' || statusKey === 'CRMFOLLOWUP') return ['Follow up'];
      if (statusKey === 'WAITING' || statusKey === 'SENT') return ['Sent but Waiting'];
      if (statusKey === 'ONHOLD') return ['On-hold'];
      if (statusKey === 'REVISION' || statusKey === 'REVISIONS') return ['Revision'];
      if (
        statusKey === 'INREVIEW' ||
        statusKey === 'TOREVIEW' ||
        statusKey === 'REVIEW' ||
        statusKey === 'CHECKING' ||
        statusKey === 'INCHECKING'
      ) {
        return ['To Review'];
      }
      if (
        statusKey === 'CLOSED' ||
        statusKey === 'DONE' ||
        statusKey === 'COMPLETE' ||
        statusKey === 'COMPLETED' ||
        statusKey === 'RESOLVED' ||
        statusKey === 'CANCELLED'
      ) {
        return ['Closed'];
      }
      return ['Available Task'];
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

      // Check sheet progress: prefer today's DailySheetLog entry as the source of truth, fallback to pmReviews SHEET_PROGRESS
      const sheetLog = dailySheetIndex.byTaskId.get(task.id);
      let progress: any = sheetLog
        ? buildProgressFromSheetLog(sheetLog)
        : reviewsList.find((r: any) => r.type === 'SHEET_PROGRESS' && !r.subtaskId) || null;

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

      // If taskMapRecord.statuses contains 'In progress' but there is no active live sheet or Upwork progress right now, strip stale 'In progress' substatus
      if (
        Array.isArray(mapRecord.statuses) &&
        mapRecord.statuses.some((s: string) => s.toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS')
      ) {
        const hasLiveWork = (progress?.timeIn && !progress?.timeOut && !progress?.isMissingTime) || Boolean(upworkSession?.active);
        if (!hasLiveWork) {
          mapRecord = {
            ...mapRecord,
            statuses: mapRecord.statuses.filter((s: string) => s.toUpperCase().replace(/[\s_-]+/g, '') !== 'INPROGRESS'),
          };
        }
      }

      // Normalize stale TaskMapRecord.statuses for WAITING / CRM / IN REVIEW / REVISION / empty tasks
      const taskStatusNorm = (task.status || '').toUpperCase().replace(/[\s_-]+/g, '');
      const staleForReview = new Set([
        'AVAILABLETASK', 'HANDOVER', 'HANDOVEROUT', 'HANDOVERIN', 'PAUSED',
        'INPROGRESS', 'PENDING', 'REVISION', 'REVISIONS', 'WAITING', 'SENT', 'SENTBUTWAITING',
        'TOSEND', 'FOLLOWUP', 'ONHOLD',
      ]);
      if (taskStatusNorm === 'WAITING' || taskStatusNorm === 'SENT') {
        const cur = Array.isArray(mapRecord.statuses) ? mapRecord.statuses : [];
        const staleForWaiting = new Set([
          'AVAILABLETASK', 'TOSEND', 'READYTOSEND', 'WAITING', 'SENT', 'SENTBUTWAITING',
          'INPROGRESS', 'PENDING', 'HANDOVER', 'HANDOVEROUT', 'HANDOVERIN', 'ONHOLD', 'TOREVIEW', 'REVISION', 'REVISIONS',
        ]);
        if (cur.length === 0 || cur.every((s: string) => staleForWaiting.has((s || '').toUpperCase().replace(/[\s_-]+/g, '')))) {
          mapRecord = { ...mapRecord, statuses: ['Sent but Waiting'] };
        }
      } else if (taskStatusNorm === 'CRM' || taskStatusNorm === 'TOSEND' || taskStatusNorm === 'CRMNEEDEDTOSEND' || taskStatusNorm === 'CRMTOSEND') {
        const cur = Array.isArray(mapRecord.statuses) ? mapRecord.statuses : [];
        const staleForCrm = new Set([
          'AVAILABLETASK', 'TOSEND', 'WAITING', 'SENT', 'SENTBUTWAITING',
          'INPROGRESS', 'PENDING', 'HANDOVER', 'HANDOVEROUT', 'HANDOVERIN', 'ONHOLD', 'TOREVIEW',
        ]);
        if (cur.length === 0 || cur.every((s: string) => staleForCrm.has((s || '').toUpperCase().replace(/[\s_-]+/g, '')))) {
          mapRecord = { ...mapRecord, statuses: ['To send'] };
        }
      } else if (taskStatusNorm === 'TOFOLLOWUP' || taskStatusNorm === 'CRMNEEDEDTOFOLLOWUP' || taskStatusNorm === 'CRMFOLLOWUP') {
        const cur = Array.isArray(mapRecord.statuses) ? mapRecord.statuses : [];
        const staleForFollowUp = new Set([
          'AVAILABLETASK', 'TOSEND', 'WAITING', 'SENT', 'SENTBUTWAITING',
          'INPROGRESS', 'PENDING', 'HANDOVER', 'HANDOVEROUT', 'HANDOVERIN', 'ONHOLD', 'TOREVIEW',
        ]);
        if (cur.length === 0 || cur.every((s: string) => staleForFollowUp.has((s || '').toUpperCase().replace(/[\s_-]+/g, '')))) {
          mapRecord = { ...mapRecord, statuses: ['Follow up'] };
        }
      } else if (taskStatusNorm === 'INREVIEW' || taskStatusNorm === 'TOREVIEW' || taskStatusNorm === 'REVIEW' || taskStatusNorm === 'CHECKING' || taskStatusNorm === 'INCHECKING') {
        const cur = Array.isArray(mapRecord.statuses) ? mapRecord.statuses : [];
        if (cur.length === 0 || cur.every((s: string) => staleForReview.has((s || '').toUpperCase().replace(/[\s_-]+/g, '')))) {
          mapRecord = { ...mapRecord, statuses: ['To Review'] };
        }
      } else if (taskStatusNorm === 'REVISION' || taskStatusNorm === 'REVISIONS') {
        const cur = Array.isArray(mapRecord.statuses) ? mapRecord.statuses : [];
        if (cur.length === 0 || cur.every((s: string) => staleForReview.has((s || '').toUpperCase().replace(/[\s_-]+/g, '')) || (s || '').toUpperCase().replace(/[\s_-]+/g, '') === 'TOREVIEW')) {
          mapRecord = { ...mapRecord, statuses: ['Revision'] };
        }
      } else if (!Array.isArray(mapRecord.statuses) || mapRecord.statuses.length === 0) {
        mapRecord = {
          ...mapRecord,
          statuses: deriveDefaultMapStatuses(task.status, taskHasAssignee),
        };
      }

      const isAdminTask = isHiddenAdminOrInternalTask(task.list);

      const { launchMeta, effectiveLaunchDate, isLaunchDate } = extractLaunchMeta(reviewsList, task.dueDate);
      const parentClosed = isClosedStatus(task.status);
      // Lightweight subtask refs on parent card (open subtasks are emitted as first-class TaskMapItems below)
      const lightSubtasks = Array.isArray(task.subtasks)
        ? task.subtasks.map((st: any) => ({
            id: st.id,
            title: st.title,
            status: st.status,
            completed: st.completed,
          }))
        : [];
      enrichedTasks.push({
        ...task,
        description: null,
        subtasks: lightSubtasks,
        subtaskCount: task._count?.subtasks ?? 0,
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
          const subSheetLog = dailySheetIndex.bySubtaskId.get(st.id);
          const subProgress: any = subSheetLog
            ? buildProgressFromSheetLog(subSheetLog)
            : reviewsList.find((r: any) => r?.type === 'SHEET_PROGRESS' && r?.subtaskId === st.id) || null;
          const subHasLiveWork = Boolean(
            subProgress?.timeIn && !subProgress?.timeOut && !subProgress?.isMissingTime
          );
          let subStatuses: string[] = parentIsOnHold
            ? ['On-hold']
            : Array.isArray(subState?.statuses) && subState.statuses.length > 0
              ? [...subState.statuses]
              : deriveDefaultMapStatuses(subStatus, subHasAssignee && !subState?.handedOver);
          const subStatusKey = (subStatus || '').toUpperCase().replace(/[\s_-]+/g, '');
          if (subStatusKey === 'INREVIEW' || subStatusKey === 'TOREVIEW' || subStatusKey === 'REVIEW' || subStatusKey === 'CHECKING' || subStatusKey === 'INCHECKING') {
            if (subStatuses.length === 0 || subStatuses.every((s: string) => staleForReview.has((s || '').toUpperCase().replace(/[\s_-]+/g, '')))) {
              subStatuses = ['To Review'];
            }
          } else if (subStatusKey === 'REVISION' || subStatusKey === 'REVISIONS') {
            if (subStatuses.length === 0 || subStatuses.every((s: string) => staleForReview.has((s || '').toUpperCase().replace(/[\s_-]+/g, '')) || (s || '').toUpperCase().replace(/[\s_-]+/g, '') === 'TOREVIEW')) {
              subStatuses = ['Revision'];
            }
          }
          if (subHasLiveWork && !subStatuses.some((s: string) => s.toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS')) {
            subStatuses.push('In progress');
          } else if (!subHasLiveWork && subStatuses.some((s: string) => s.toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS')) {
            subStatuses = subStatuses.filter((s: string) => s.toUpperCase().replace(/[\s_-]+/g, '') !== 'INPROGRESS');
          }
          if (subStatuses.length === 0) {
            subStatuses = deriveDefaultMapStatuses(subStatus, subHasAssignee && !subState?.handedOver);
          }
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
            teamId: st.teamId || null,
            estimatedHours: st.estimatedHours ?? null,
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
            progress: subProgress,
            createdAt: st.createdAt,
            updatedAt: st.updatedAt,
          });
        }
      }
    }

    // Enrich WAITING / Sent but Waiting tasks & multi-assignee AuditLog fallback in parallel
    const waitingItemsForMeta = enrichedTasks.filter(
      (item: any) => !item.isSubtask && !item.isClosed && isWaitingMainStatus(item.status)
    );
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
    const entityIds = multiAssigneeItems.length > 0
      ? Array.from(
          new Set(
            multiAssigneeItems.flatMap((i: any) => (i.isSubtask ? [i.parentTaskId, i.subtaskId] : [i.id])).filter(Boolean)
          )
        )
      : [];

    const [waitingMetaMap, assignmentLogs] = await Promise.all([
      waitingItemsForMeta.length > 0
        ? resolveWaitingSinceMap(
            waitingItemsForMeta.map((item: any) => ({
              id: item.id,
              status: item.status,
              updatedAt: item.updatedAt,
              createdAt: item.createdAt,
              pmReviews: item.taskMap?.pmReviews,
              recordUpdatedAt: item.taskMap?.updatedAt,
            }))
          )
        : Promise.resolve(new Map<string, any>()),
      entityIds.length > 0
        ? prisma.auditLog.findMany({
            where: {
              action: 'ASSIGNMENT',
              entity: { in: ['TASK', 'SUBTASK'] },
              entityId: { in: entityIds },
            },
            select: { entityId: true, details: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: Math.min(entityIds.length * 5, 500),
          })
        : Promise.resolve([] as Array<{ entityId: string; details: any; createdAt: Date }>),
    ]);

    if (waitingItemsForMeta.length > 0) {
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

    if (multiAssigneeItems.length > 0 && assignmentLogs.length > 0) {
      const logsByEntity = new Map<string, any[]>();
      for (const l of assignmentLogs) {
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
    const searchedTasks = enrichedTasks.filter((task: any) => matchesTaskSearchQuery(task, searchQuery));

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

      // Exclude review/audit, recurring, daily, weekly, monthly, and CRM tasks from Available Tasks pool (Waiting is included)
      const isExcluded =
        s === 'CRM' ||
        s.includes('CRM') ||
        s === 'TOSEND' ||
        s === 'TOFOLLOWUP' ||
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
          ['CRM', 'ASKCLIENT', 'READYTOSEND', 'TOSEND', 'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING', 'INREVIEW', 'TOREVIEW', 'CHECKING', 'INCHECKING'].includes(st) ||
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

      if (t.taskMap?.handedOver) {
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

      if (mapStatuses.includes('HANDOVER')) {
        return true;
      }

      // If a task is not live working and has no active Task Map PM assignment,
      // it belongs in Available Tasks pool so PMs can assign it on the Task Map
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

    const getTaskPriorityRank = (t: any) => {
      if (isTaskUrgent(t)) return 0;
      const p = (t.priority || '').trim().toUpperCase();
      if (p === 'HIGH') return 1;
      if (p === 'NORMAL' || p === 'MEDIUM') return 2;
      if (p === 'LOW') return 3;
      return 4;
    };

    const isTaskOnHold = (t: any) => {
      const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      if (s === 'ONHOLD' || s.includes('HOLD')) return true;
      const customStatuses = t.taskMap?.statuses || [];
      return customStatuses.some((cs: string) => cs.toUpperCase().includes('HOLD'));
    };

    const isTaskWaiting = (t: any) => {
      const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      if (s === 'WAITING' || s === 'SENT' || s.includes('WAITING')) return true;
      const customStatuses = t.taskMap?.statuses || [];
      return customStatuses.some((cs: string) => {
        const up = (cs || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
        return up === 'WAITING' || up === 'SENTBUTWAITING' || up.includes('WAITING');
      });
    };

    const getAvailableTaskStatusRank = (t: any) => {
      if (isTaskOnHold(t)) return 4;
      if (isTaskWaiting(t)) return 3;
      const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      const mapStatuses = (t.taskMap?.statuses || []).map((x: string) =>
        (x || '').trim().toUpperCase().replace(/[\s_-]+/g, '')
      );
      if (
        mapStatuses.some(
          (st: string) =>
            st === 'HANDOVER' || st === 'HANDOVERIN' || st === 'HANDOVEROUT' || st.includes('HANDOVER')
        )
      ) {
        return 0;
      }
      if (
        s === 'REVISION' ||
        s === 'REVISIONS' ||
        s === 'REVISING' ||
        s.includes('REVIS') ||
        mapStatuses.some(
          (st: string) => st === 'REVISION' || st === 'REVISIONS' || st === 'REVISING' || st.includes('REVIS')
        )
      ) {
        return 1;
      }
      if (t.taskMap?.handedOver && !mapStatuses.includes('AVAILABLETASK')) {
        return 0;
      }
      return 2;
    };

    const availablePool = filteredTasks
      .filter((t: any) => {
        if (isClosedTask(t)) return false;
        return isAvailableTaskStatus(t);
      })
      .sort((a: any, b: any) => {
        // 0. Bottom tiers: active (0) > Waiting (1) > On-hold (2)
        const tierA = isTaskOnHold(a) ? 2 : isTaskWaiting(a) ? 1 : 0;
        const tierB = isTaskOnHold(b) ? 2 : isTaskWaiting(b) ? 1 : 0;
        if (tierA !== tierB) return tierA - tierB;

        // 1. Prioritize by urgency: URGENT > HIGH > NORMAL/MEDIUM > LOW
        const priorityDiff = getTaskPriorityRank(a) - getTaskPriorityRank(b);
        if (priorityDiff !== 0) return priorityDiff;

        // 2. Order within priority: Hand-over > Revision > Available Task / other
        const statusDiff = getAvailableTaskStatusRank(a) - getAvailableTaskStatusRank(b);
        if (statusDiff !== 0) return statusDiff;

        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });

    // Don't show closed tasks on Task Map, but retain closed CRM tasks for the CRM board
    const openTasks = filteredTasks.filter((t: any) => {
      if (!isClosedTask(t)) return true;
      const s = (t.status || '').toUpperCase().trim();
      const mapStatuses = (t.taskMap?.statuses || []).map((x: string) => x.toUpperCase().trim());
      if ((s === 'CLOSED' || s === 'DONE') && mapStatuses.some((st: string) => CRM_TAG_SET.has(st))) {
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

    // Assemble client list from pre-fetched Client Dashboard lists + active non-admin tasks
    const allClientsMap = new Map<string, { id: string; name: string }>();
    for (const c of clientDashboardLists) {
      allClientsMap.set(c.id, c);
    }
    for (const t of openTasks as any[]) {
      if (t.isAdminTask) continue;
      const listId = t.list?.id;
      const listName = t.list?.name;
      if (listId && listName && !allClientsMap.has(listId)) {
        allClientsMap.set(listId, { id: listId, name: listName });
      }
    }
    const allClients = Array.from(allClientsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    const isStaleLiveProgress = (
      startedAt?: string | Date | null,
      updatedAt?: string | Date | null,
      dateStr?: string | null
    ): boolean => {
      const refRaw = startedAt || updatedAt;
      if (refRaw) {
        const refMs = new Date(refRaw).getTime();
        if (!isNaN(refMs) && nowMs - refMs > MAX_UPWORK_SESSION_MS) {
          return true;
        }
      }
      if (dateStr) {
        const cleanDate = String(dateStr).trim();
        let parsedMs = NaN;
        const ymd = cleanDate.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
        if (ymd) {
          parsedMs = Date.UTC(
            parseInt(ymd[1], 10),
            parseInt(ymd[2], 10) - 1,
            parseInt(ymd[3], 10),
            15,
            59,
            59
          ); // 23:59:59 Manila
        } else {
          const parsed = new Date(cleanDate.includes(':') ? cleanDate : `${cleanDate} 23:59:59 GMT+0800`);
          parsedMs = parsed.getTime();
        }
        if (!isNaN(parsedMs) && nowMs - parsedMs > MAX_UPWORK_SESSION_MS) {
          return true;
        }
      }
      return false;
    };

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
      if (
        sheetProg?.maName &&
        sheetProg.timeIn &&
        !sheetProg.timeOut &&
        !sheetProg.isMissingTime &&
        !isStaleLiveProgress(sheetProg.startedAt, sheetProg.updatedAt, sheetProg.date)
      ) {
        const maKey = sheetProg.maName.toLowerCase().trim();
        const pmAssign = Array.isArray(reviewsList)
          ? reviewsList.find((r: any) => r.type === 'PM_ASSIGNMENT' && !r.subtaskId)
          : null;
        const origMa = Array.isArray(reviewsList)
          ? reviewsList.find((r: any) => r.type === 'ORIGINAL_MA')
          : null;
        const matchedOwnerUser = (allUsers || []).find(
          (u: any) => (u.name || '').trim().toLowerCase() === maKey
        );
        const resolvedUserId = matchedOwnerUser?.id || pmAssign?.assignedTo || origMa?.userId || null;
        const existing = maActiveSessions[maKey];
        const existingHasTimeOut = Boolean(existing?.timeOut && String(existing.timeOut).trim());
        const existingRowNum = existing?.rowNumber ? Number(existing.rowNumber) : -1;
        const incomingRowNum = sheetProg.sheetRow ? Number(sheetProg.sheetRow) : -1;
        const incomingUpdatedMs = sheetProg.updatedAt ? new Date(sheetProg.updatedAt).getTime() : 0;
        const existingUpdatedMs = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const isStaleComparedToTimedOut =
          existingHasTimeOut &&
          ((incomingRowNum > 0 && existingRowNum > 0 && incomingRowNum <= existingRowNum) ||
            incomingUpdatedMs <= existingUpdatedMs);
        const existingIsLive = Boolean(existing && existing.active && existing.timeIn && !existingHasTimeOut && !existing.isMissingTime);
        if (!isStaleComparedToTimedOut && (!existing || (!existingIsLive && !existingHasTimeOut) || incomingUpdatedMs > existingUpdatedMs)) {
          maActiveSessions[maKey] = {
            maName: sheetProg.maName,
            userId: resolvedUserId,
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

    // Also ensure any live DailySheetLog entry (today + overnight shift window) is represented in maActiveSessions
    const liveSheetCandidates = [
      ...(dailySheetIndex?.logs || []),
      ...((dailySheetIndex as any)?.latestByMa || []),
    ];
    for (const log of liveSheetCandidates) {
      if (
        !log?.maName ||
        !log.isLive ||
        !log.timeIn ||
        log.timeOut ||
        log.isMissingTime ||
        isStaleLiveProgress(log.startedAt, log.submittedAt, log.dateKey)
      ) {
        continue;
      }
      const maKey = log.maKey || log.maName.toLowerCase().trim();
      const existing = maActiveSessions[maKey];
      const existingHasTimeOut = Boolean(existing?.timeOut && String(existing.timeOut).trim());
      const existingRowNum = existing?.rowNumber ? Number(existing.rowNumber) : -1;
      const incomingRowNum = log.sheetRow ? Number(log.sheetRow) : -1;
      const incomingUpdatedMs = log.submittedAt ? new Date(log.submittedAt).getTime() : 0;
      const existingUpdatedMs = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const isStaleComparedToTimedOut =
        existingHasTimeOut &&
        ((incomingRowNum > 0 && existingRowNum > 0 && incomingRowNum <= existingRowNum) ||
          incomingUpdatedMs <= existingUpdatedMs);
      const existingIsLive = Boolean(existing && existing.active && existing.timeIn && !existingHasTimeOut && !existing.isMissingTime);
      if (!isStaleComparedToTimedOut && (!existing || (!existingIsLive && !existingHasTimeOut) || incomingUpdatedMs > existingUpdatedMs)) {
        maActiveSessions[maKey] = {
          maName: log.maName,
          userId: log.userId || null,
          taskId: log.taskId || null,
          subtaskId: log.subtaskId || null,
          timeIn: log.timeIn,
          timeOut: null,
          client: log.client || 'General',
          taskName: log.taskName || log.taskDeliverables || 'No task inputted',
          date: log.dateKey || todayManila,
          status: log.status || 'IN PROGRESS',
          isUpwork: Boolean(log.isUpwork),
          rowNumber: log.sheetRow || null,
          updatedAt: log.submittedAt ? new Date(log.submittedAt).toISOString() : new Date().toISOString(),
          active: true,
        };
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

    const availablePoolIds = availablePool.map((t: any) => t.id);

    const responsePayload = {
      success: true,
      isHistory: isPastDate,
      snapshotDate: isPastDate ? requestedDate : undefined,
      tasks: openTasks,
      launchTasks,
      availablePoolIds,
      allClients,
      dailySheetLogs: dailySheetIndex.logs,
      latestSheetRows: dailySheetIndex.latestByMa,
      superviseChecks: activeSuperviseChecks,
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
    // Stores compact `availablePoolIds` instead of duplicating full `availablePool` objects (~40-50% smaller Redis payload).
    await setCache(cacheKey, responsePayload, isPastDate ? 3600 : 30, cacheGen);

    return responsePayload;
    })();

    inFlightTaskMapQueries.set(singleFlightKey, computePromise);
    try {
      const responsePayload = await computePromise;
      return res.json(formatTaskMapPayload(responsePayload));
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
  if (statusKey === 'CRM' || statusKey === 'TOSEND') return ['To send'];
  if (statusKey === 'TOFOLLOWUP') return ['Follow up'];
  if (statusKey === 'WAITING' || statusKey === 'SENT') return ['Sent but Waiting'];
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
function parseFollowUpScheduleDaysBackend(label?: string | null): number | null {
  const compact = String(label || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (compact === 'FOLLOWUP1DAY') return 1;
  if (compact === 'FOLLOWUP3RDDAY') return 3;
  if (compact === 'FOLLOWUP5THDAY') return 5;
  if (compact === 'FOLLOWUP1WEEK') return 7;
  return null;
}

function syncFollowUpScheduleInPmReviews(
  pmReviews: any[],
  statuses: string[],
  subtaskId: string | null
): any[] {
  const matchedLabel = (statuses || []).find((s) => parseFollowUpScheduleDaysBackend(s) !== null) || null;
  const targetDays = matchedLabel ? parseFollowUpScheduleDaysBackend(matchedLabel) : null;
  const filtered = (Array.isArray(pmReviews) ? pmReviews : []).filter(
    (r: any) => !(r && r.type === 'CRM_FOLLOW_UP_SCHEDULE' && (subtaskId ? r.subtaskId === subtaskId : !r.subtaskId))
  );
  if (matchedLabel && targetDays) {
    const nowIso = new Date().toISOString();
    filtered.push({
      type: 'CRM_FOLLOW_UP_SCHEDULE',
      subtaskId: subtaskId || null,
      selectedLabel: matchedLabel,
      targetDays,
      selectedAt: nowIso,
      selectedDateKey: getManilaDateStr(),
      updatedAt: nowIso,
    });
  }
  return filtered;
}

export const updateTaskStatuses = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { statuses, taskDeliverablesDescription, taskUpdateAndDeliverables, timeOut, skipN8nSync, skipSheetSync, sheetRow } = req.body;
    const user = (req as any).user;
    const shouldSkipN8n = Boolean(skipN8nSync || skipSheetSync);

    if (!Array.isArray(statuses)) {
      return res.status(400).json({ error: 'Statuses must be an array of strings' });
    }

    const isPm = await canUserSetAssignees(user?.id);

    const actorUser = user?.id
      ? await prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, name: true, email: true, dailySheetUrl: true },
        })
      : null;
    const actorDisplayName = actorUser?.name || user?.name || user?.email || 'User';

    const nowManilaTime = timeOut
      ? String(timeOut).trim()
      : new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Manila',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }).format(new Date());

    const normSubStatuses = statuses.map((s: string) => s.trim().toUpperCase().replace(/[\s_-]+/g, ''));
    const isAvailableTaskStatus = normSubStatuses.includes('AVAILABLETASK');
    const isRevisionTransferOut = normSubStatuses.some((norm) => norm === 'REVISION' || norm === 'REVISIONS');
    const isExplicitHandover = normSubStatuses.some((norm) => norm === 'HANDOVER');
    const isHandoverSubStatus = isExplicitHandover || isAvailableTaskStatus;
    const isWorkflowTransferOut = normSubStatuses.some((norm) =>
      ['TOREVIEW', 'INREVIEW', 'CHECKING', 'INCHECKING', 'WAITING', 'CRM', 'CRMNEEDEDTOSEND', 'CRMTOSEND', 'CRMNEEDEDTOFOLLOWUP', 'CRMFOLLOWUP', 'ASKCLIENT', 'READYTOSEND', 'TOSEND', 'FOLLOWUP'].includes(norm)
    );
    const isClosedSubStatus = normSubStatuses.some((norm) =>
      ['CLOSED', 'DONE', 'COMPLETE', 'COMPLETED', 'RESOLVED', 'CANCELLED'].includes(norm)
    );
    const shouldClearAssignee = isHandoverSubStatus || isWorkflowTransferOut || isClosedSubStatus;

    const target = parseTaskMapTargetId(id);

    // Server-enforced Revision return: return from Audit/CRM back to original assigned MA's Task Map column
    if (isRevisionTransferOut) {
      const revResult = await applyRevisionReturnToOriginalMa({
        targetId: id,
        actorUser: user,
        io,
        requestedStatuses: statuses,
      });

      const revLog = await prisma.auditLog.create({
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
      }).catch(() => null);

      await invalidateCache(`task:activities:${revResult.taskId}`, `task:${revResult.taskId}`).catch(() => {});
      if (revLog) {
        io.emit('task_activity', {
          taskId: revResult.taskId,
          activity: {
            id: revLog.id,
            type: 'task_map_status_change',
            author: actorDisplayName,
            oldStatus: null,
            newStatus: revResult.statuses.length > 0 ? revResult.statuses.join(', ') : 'None',
            oldStatuses: [],
            newStatuses: revResult.statuses,
            subtaskId: revResult.subtaskId,
            date: revLog.createdAt,
            user: actorUser ? { id: actorUser.id, name: actorDisplayName } : { id: user?.id || 'system', name: actorDisplayName },
          },
        });
      }

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
          assignees: { select: { id: true, name: true, email: true, roles: true, dailySheetUrl: true } },
          User: { select: { id: true, name: true, email: true, roles: true, dailySheetUrl: true } },
          task: { select: { id: true, title: true, listId: true, list: { select: { id: true, name: true } } } },
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
        let matchedSubSheetRow: number | null = sheetRow ? Number(sheetRow) : null;
        let matchedSubTimeIn: string | null = null;
        let matchedSubDate: string | null = null;
        let matchedSubClient: string | null = null;
        for (const r of pmReviews) {
          if (r?.type === 'SHEET_PROGRESS' && r?.subtaskId === subtask.id) {
            if (!matchedSubSheetRow && r.sheetRow) matchedSubSheetRow = Number(r.sheetRow);
            if (!matchedSubTimeIn && r.timeIn) matchedSubTimeIn = r.timeIn;
            if (!matchedSubDate && r.date) matchedSubDate = r.date;
            if (!matchedSubClient && r.client) matchedSubClient = r.client;
            if (r.timeIn && !r.timeOut) {
              r.timeOut = nowManilaTime;
              if (taskDeliverablesDescription) r.taskDeliverables = String(taskDeliverablesDescription).trim();
              if (taskUpdateAndDeliverables) r.taskUpdateAndDeliverables = String(taskUpdateAndDeliverables).trim();
            }
          }
          if (r?.type === 'UPWORK_SESSION' && r?.subtaskId === subtask.id && r.active) {
            r.active = false;
            r.stoppedAt = new Date().toISOString();
          }
        }
        await closeLiveDailySheetLogsForTask({
          taskId: subtask.taskId,
          subtaskId: subtask.id,
          timeOut: nowManilaTime,
        }).catch(() => {});
        const subUser = subtask.User || (subtask.assignees && subtask.assignees[0]);
        const subNamesToClear = [actorDisplayName, subUser?.name].filter(Boolean) as string[];
        for (const n of subNamesToClear) {
          await deleteMaActiveSession(n).catch(() => {});
          const clearedPayload = { maName: n, cleared: true, taskId: target.rawId };
          io.emit('ma:session_updated', clearedPayload);
          io.emit('task_map:ma_progress_changed', clearedPayload);
          io.emit('task_map:updated', { maSession: clearedPayload, taskId: target.rawId });
        }
        if (!shouldSkipN8n && (isHandoverSubStatus || isWorkflowTransferOut)) {
          const dedupeKey = `${getManilaDateStr()}::${(subUser?.name || actorDisplayName).trim().toLowerCase()}::${target.rawId}`;
          let skipWebhook = false;
          if (isRedisReady()) {
            const acquired = await redis.set(`task_map:stop_dedupe:${dedupeKey}`, '1', 'EX', 30, 'NX').catch(() => 'OK');
            if (!acquired) skipWebhook = true;
          } else {
            const prevTs = recentSpreadsheetStopDedupe.get(dedupeKey);
            const nowTs = Date.now();
            if (prevTs && nowTs - prevTs < 30000) {
              skipWebhook = true;
            } else {
              recentSpreadsheetStopDedupe.set(dedupeKey, nowTs);
            }
          }

          if (!skipWebhook) {
            triggerN8nStartTaskWebhook({
              userId: subtask.assigneeId || subUser?.id || user?.id,
              userName: subUser?.name || actorDisplayName,
              userEmail: (subUser as any)?.email || actorUser?.email,
              dailySheetUrl: (subUser as any)?.dailySheetUrl || (actorUser as any)?.dailySheetUrl,
              taskId: subtask.taskId,
              subtaskId: subtask.id,
              sheetRow: sheetRow ? Number(sheetRow) : matchedSubSheetRow,
              taskTitle: `${subtask.title} (${subtask.task?.title || 'Subtask'})`,
              clientName: matchedSubClient || (subtask.task as any)?.list?.name || 'General',
              taskLink: `https://nexus.vipscaleph.com/lists/${(subtask.task as any)?.listId || ''}?task=${subtask.taskId}&subtask=${subtask.id}`,
              status: isExplicitHandover ? 'Hand-over' : isAvailableTaskStatus ? 'Available Task' : 'In Review',
              date: matchedSubDate || getManilaDateStr(),
              timeIn: matchedSubTimeIn || undefined,
              timeOut: nowManilaTime,
              taskDeliverablesDescription: taskDeliverablesDescription !== undefined && taskDeliverablesDescription !== null && String(taskDeliverablesDescription).trim() !== '' ? String(taskDeliverablesDescription).trim() : null,
              taskUpdateAndDeliverables: taskUpdateAndDeliverables ? String(taskUpdateAndDeliverables).trim() : null,
              description: taskDeliverablesDescription !== undefined && taskDeliverablesDescription !== null && String(taskDeliverablesDescription).trim() !== '' ? String(taskDeliverablesDescription).trim() : '',
              mode: 'STOP',
            });
          }
        }
        if (isClosedSubStatus) {
          await prisma.subtask.update({
            where: { id: subtask.id },
            data: { status: 'CLOSED', completed: true, assigneeId: null, assignees: { set: [] } },
          });
        } else if (subtask.assigneeId || (subtask.assignees && subtask.assignees.length > 0)) {
          await prisma.subtask.update({
            where: { id: subtask.id },
            data: { assigneeId: null, assignees: { set: [] } },
          });
        }
      }

      const nextHandedOver = isExplicitHandover
        ? true
        : (isAvailableTaskStatus || isWorkflowTransferOut)
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
      pmReviews = syncFollowUpScheduleInPmReviews(pmReviews, statuses, subtask.id);

      const updatedParent = await updateTaskMapRecord(subtask.taskId, { pmReviews });
      await invalidateCache('task:*', 'tasks:all', `task:${subtask.taskId}`, `task:${subtask.id}`, `task:activities:${subtask.taskId}`, 'task_map:*');

      const subLog = await prisma.auditLog.create({
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

      io.emit('task_activity', {
        listId: subtask.task?.listId || undefined,
        taskId: subtask.taskId,
        activity: {
          id: subLog.id,
          type: 'task_map_status_change',
          author: actorDisplayName,
          oldStatus: oldStatuses.length > 0 ? oldStatuses.join(', ') : null,
          newStatus: statuses.length > 0 ? statuses.join(', ') : 'None',
          oldStatuses,
          newStatuses: statuses,
          subtaskId: subtask.id,
          subtaskTitle: subtask.title,
          date: subLog.createdAt,
          user: actorUser ? { id: actorUser.id, name: actorDisplayName } : { id: user?.id || 'system', name: actorDisplayName },
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
        listId: true,
        list: { select: { id: true, name: true } },
        assigneeId: true,
        assignees: { select: { id: true, name: true, email: true, roles: true, dailySheetUrl: true } },
        assignee: { select: { id: true, name: true, email: true, roles: true, dailySheetUrl: true } },
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
      let matchedMainSheetRow: number | null = sheetRow ? Number(sheetRow) : null;
      let matchedMainTimeIn: string | null = null;
      let matchedMainDate: string | null = null;
      let matchedMainClient: string | null = null;
      if (Array.isArray(pmReviews)) {
        pmReviews = pmReviews.filter((r: any) => !(r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId));
        // Clock out any open sheet progress and close Upwork session on handover / transfer
        for (const r of pmReviews) {
          if (r?.type === 'SHEET_PROGRESS' && !r?.subtaskId) {
            if (!matchedMainSheetRow && r.sheetRow) matchedMainSheetRow = Number(r.sheetRow);
            if (!matchedMainTimeIn && r.timeIn) matchedMainTimeIn = r.timeIn;
            if (!matchedMainDate && r.date) matchedMainDate = r.date;
            if (!matchedMainClient && r.client) matchedMainClient = r.client;
            if (r.timeIn && !r.timeOut) {
              r.timeOut = nowManilaTime;
              if (taskDeliverablesDescription) r.taskDeliverables = String(taskDeliverablesDescription).trim();
              if (taskUpdateAndDeliverables) r.taskUpdateAndDeliverables = String(taskUpdateAndDeliverables).trim();
            }
          }
          if (r?.type === 'UPWORK_SESSION' && !r?.subtaskId && r.active) {
            r.active = false;
            r.stoppedAt = new Date().toISOString();
          }
        }
      }
      await closeLiveDailySheetLogsForTask({
        taskId: id,
        subtaskId: null,
        timeOut: nowManilaTime,
      }).catch(() => {});
      const namesToClear = [actorDisplayName, currentTask?.assignee?.name].filter(Boolean) as string[];
      for (const n of namesToClear) {
        await deleteMaActiveSession(n).catch(() => {});
        const clearedPayload = { maName: n, cleared: true, taskId: id };
        io.emit('ma:session_updated', clearedPayload);
        io.emit('task_map:ma_progress_changed', clearedPayload);
        io.emit('task_map:updated', { maSession: clearedPayload, taskId: id });
      }
      if (!shouldSkipN8n && (isHandoverSubStatus || isWorkflowTransferOut)) {
        const primaryAssignee = currentTask?.assignee || (currentTask?.assignees && currentTask.assignees[0]);
        const dedupeKey = `${getManilaDateStr()}::${(primaryAssignee?.name || actorDisplayName).trim().toLowerCase()}::${id}`;
        let skipWebhook = false;
        if (isRedisReady()) {
          const acquired = await redis.set(`task_map:stop_dedupe:${dedupeKey}`, '1', 'EX', 30, 'NX').catch(() => 'OK');
          if (!acquired) skipWebhook = true;
        } else {
          const prevTs = recentSpreadsheetStopDedupe.get(dedupeKey);
          const nowTs = Date.now();
          if (prevTs && nowTs - prevTs < 30000) {
            skipWebhook = true;
          } else {
            recentSpreadsheetStopDedupe.set(dedupeKey, nowTs);
          }
        }

        if (!skipWebhook) {
          triggerN8nStartTaskWebhook({
            userId: currentTask?.assigneeId || primaryAssignee?.id || user?.id,
            userName: primaryAssignee?.name || actorDisplayName,
            userEmail: primaryAssignee?.email || actorUser?.email,
            dailySheetUrl: (primaryAssignee as any)?.dailySheetUrl || (actorUser as any)?.dailySheetUrl,
            taskId: id,
            sheetRow: sheetRow ? Number(sheetRow) : matchedMainSheetRow,
            taskTitle: currentTask?.title || 'Task',
            clientName: matchedMainClient || (currentTask as any)?.list?.name || 'General',
            taskLink: `https://nexus.vipscaleph.com/lists/${(currentTask as any)?.listId || ''}?task=${id}`,
            status: isExplicitHandover ? 'Hand-over' : isAvailableTaskStatus ? 'Available Task' : 'In Review',
            date: matchedMainDate || getManilaDateStr(),
            timeIn: matchedMainTimeIn || undefined,
            timeOut: nowManilaTime,
            taskDeliverablesDescription: taskDeliverablesDescription !== undefined && taskDeliverablesDescription !== null && String(taskDeliverablesDescription).trim() !== '' ? String(taskDeliverablesDescription).trim() : null,
            taskUpdateAndDeliverables: taskUpdateAndDeliverables ? String(taskUpdateAndDeliverables).trim() : null,
            description: taskDeliverablesDescription !== undefined && taskDeliverablesDescription !== null && String(taskDeliverablesDescription).trim() !== '' ? String(taskDeliverablesDescription).trim() : '',
            mode: 'STOP',
          });
        }
      }
      if (isRedisReady()) {
        await redis.hdel('task_map:upwork_active', id).catch(() => {});
      }
      if (isClosedSubStatus) {
        const taskWithList = await prisma.task.findUnique({
          where: { id },
          select: { listId: true },
        });
        const listClosedStatus = taskWithList?.listId
          ? await prisma.listStatus.findFirst({
              where: {
                listId: taskWithList.listId,
                name: { in: ['CLOSED', 'DONE', 'COMPLETED', 'COMPLETE', 'RESOLVED'], mode: 'insensitive' },
              },
              select: { name: true },
            }).catch(() => null)
          : null;
        const targetClosedStatus = listClosedStatus?.name ?? 'CLOSED';

        await prisma.task.update({
          where: { id },
          data: {
            status: targetClosedStatus,
            assigneeId: null,
            assignees: { set: [] },
          },
        });
        io.emit('task:updated', { id, status: targetClosedStatus, assigneeId: null, assignees: [] });
      } else if (currentTask?.assigneeId || (currentTask?.assignees && currentTask.assignees.length > 0)) {
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

    pmReviews = syncFollowUpScheduleInPmReviews(pmReviews, statuses, null);

    const updated = await updateTaskMapRecord(id, {
      statuses,
      waitingReviewSince,
      pmReviews,
      ...(isExplicitHandover ? { handedOver: true } : (isAvailableTaskStatus || isWorkflowTransferOut) ? { handedOver: false } : {}),
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
    const mainLog = await prisma.auditLog.create({
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

    await invalidateCache(`task:activities:${id}`, `task:${id}`).catch(() => {});

    io.emit('task_activity', {
      listId: currentTask?.listId || undefined,
      taskId: id,
      activity: {
        id: mainLog.id,
        type: 'task_map_status_change',
        author: actorDisplayName,
        oldStatus: oldStatuses.length > 0 ? oldStatuses.join(', ') : null,
        newStatus: statuses.length > 0 ? statuses.join(', ') : 'None',
        oldStatuses,
        newStatuses: statuses,
        date: mainLog.createdAt,
        user: actorUser ? { id: actorUser.id, name: actorDisplayName } : { id: user?.id || 'system', name: actorDisplayName },
      },
    });

    io.emit('task_map:updated', {
      taskId: id,
      statuses,
      taskMap: updated,
      ...(isExplicitHandover ? { handedOver: true } : (isAvailableTaskStatus || isWorkflowTransferOut) ? { handedOver: false } : {}),
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
/** "6:04 PM" in Manila time, the format the daily sheets and SHEET_PROGRESS use. */
function formatManilaClockTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

async function executeTaskMapAssignment(
  req: Request,
  res: Response,
  params: {
    action: TaskMapMoveAction;
    assigneeId: string | null;
    mode: TaskMapMoveMode;
    assigneeRoleRestrictions?: string[];
    role?: string;
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

    const actorUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, email: true, avatarUrl: true },
    });
    const actorName = actorUser?.name || user.name || user.email || 'Team Member';

    // MAs must start their To Do in hierarchy order (hand-over urgent, urgent, hand-over high, high, ...)
    if (!isPm && mode === 'IN_PROGRESS') {
      const { findHigherPriorityQueued } = await import('../services/autoQueue/autoQueueService');
      const blocker = await findHigherPriorityQueued(user.id, id);
      if (blocker) {
        return res.status(409).json({
          error: `Start "${blocker.title}" (${blocker.tier}) first. Tasks must be worked in priority order.`,
          code: 'PRIORITY_ORDER',
          blockingTaskId: blocker.id,
        });
      }
    }

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
      const existingSubOwnerName =
        (currentSubtask.User?.id === assigneeId ? currentSubtask.User?.name : null) ||
        (currentSubtask.assignees || []).find((a: any) => a.id === assigneeId)?.name ||
        '';
      const hasActiveLiveSub =
        mode === 'IN_PROGRESS' && existingSubOwnerName
          ? await hasLiveSheetSessionForTarget(existingSubOwnerName, currentSubtask.taskId, currentSubtask.id)
          : false;
      // A live sheet session keeps the card in In Progress even when status/PM assignment already say Queue
      const subHasLiveSession =
        (await prisma.dailySheetLog.count({
          where: { taskId: currentSubtask.taskId, subtaskId: currentSubtask.id, isLive: true },
        })) > 0;
      const isAlreadyAssigned =
        assigneeId &&
        (currentSubtask.assigneeId === assigneeId ||
          (currentSubtask.assignees || []).some((a) => a.id === assigneeId)) &&
        existingSubPmAssignment &&
        existingSubPmAssignment.mode === mode &&
        !(mode === 'QUEUE' && (isCurrentlyInProgressOrHold || subHasLiveSession)) &&
        !(mode === 'IN_PROGRESS' && !hasActiveLiveSub);
      if (isAlreadyAssigned) {
        return res.json({ success: true, task: currentSubtask, taskMap: parentRecord });
      }

      const updateSubData: any = {};
      const currentSubStatusUpper = (currentSubtask.status || '').toUpperCase().trim();
      const isCadenceSubtask = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(currentSubStatusUpper);

      if (assigneeId) {
        const targetUser = await prisma.user.findUnique({
          where: { id: assigneeId },
          select: { id: true, name: true, roles: true, systemRole: true, dailySheetUrl: true, email: true },
        });
        if (!targetUser) {
          return res.status(404).json({ error: 'Target user not found' });
        }
        updateSubData.assigneeId = assigneeId;
        updateSubData.assignees = { set: [{ id: assigneeId }] };
        if (Array.isArray(params.assigneeRoleRestrictions)) {
          updateSubData.assigneeRoleRestrictions = params.assigneeRoleRestrictions;
        } else {
          const targetRole = params.role || targetUser.roles?.[0];
          const existingRestrictions = currentSubtask.assigneeRoleRestrictions || [];
          if (targetRole && !existingRestrictions.some((r: string) => r.toLowerCase().trim() === targetRole.toLowerCase().trim())) {
            updateSubData.assigneeRoleRestrictions = [...existingRestrictions, targetRole];
          }
        }
        if (mode === 'IN_PROGRESS') {
          updateSubData.completed = false;
          if (!isCadenceSubtask) {
            updateSubData.status = 'IN PROGRESS';
          }
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
          User: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true, dailySheetUrl: true } },
          assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true, dailySheetUrl: true } },
        },
      });

      let subStatuses: string[] =
        subStateIdx !== -1 && Array.isArray(reviewsList[subStateIdx].statuses)
          ? [...reviewsList[subStateIdx].statuses]
          : [];
      let subHandedOver = subStateIdx !== -1 ? Boolean(reviewsList[subStateIdx].handedOver) : false;
      let subProgressPayload: any = null;
      let subMaSession: any = null;

      if (assigneeId) {
        const hasPausedSub = subStatuses.some(
          (s) => s.toUpperCase().replace(/[\s_-]+/g, '') === 'PAUSED'
        );
        const hasHandoverOutSub = subStatuses.some(
          (s) => s.toUpperCase().replace(/[\s_-]+/g, '') === 'HANDOVEROUT'
        );
        const hadSubHandover =
          subHandedOver ||
          subStatuses.some((s) => {
            const n = s.toUpperCase().replace(/[\s_-]+/g, '');
            return n === 'HANDOVER' || n === 'HANDOVEROUT' || n === 'HANDOVERIN';
          });
        const isSubTransferBetweenUsers =
          action === 'TRANSFER' || Boolean(currentOwnerId && currentOwnerId !== assigneeId);
        const keepSubHandoverOutInQueue =
          mode === 'QUEUE' &&
          !isSubTransferBetweenUsers &&
          !Boolean((req.body as any)?.preserveHandover) &&
          hasHandoverOutSub;
        const shouldSetSubHandover =
          mode === 'QUEUE' &&
          !hasPausedSub &&
          !keepSubHandoverOutInQueue &&
          (hadSubHandover || isSubTransferBetweenUsers || Boolean((req.body as any)?.preserveHandover));

        subStatuses = subStatuses.filter((s) => {
          const up = s.toUpperCase().replace(/[\s_-]+/g, '');
          if (mode === 'QUEUE' && up === 'INPROGRESS') return false;
          return up !== 'AVAILABLETASK' && up !== 'PENDING' && up !== 'REVISION' && up !== 'REVISIONS' && up !== 'INREVIEW' && up !== 'TOREVIEW' && up !== 'HANDOVER' && up !== 'HANDOVEROUT' && up !== 'HANDOVERIN';
        });
        if (keepSubHandoverOutInQueue) {
          subStatuses = ['Hand-over Out'];
        } else if (shouldSetSubHandover) {
          subStatuses = ['Hand-over In'];
        } else if (mode === 'IN_PROGRESS' && !subStatuses.some((s) => s.toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS')) {
          subStatuses.push('In progress');
        } else if (mode === 'QUEUE' && subStatuses.length === 0) {
          subStatuses = ['Available Task'];
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
          'CRMNEEDEDTOSEND',
          'CRMTOSEND',
          'CRMNEEDEDTOFOLLOWUP',
          'CRMFOLLOWUP',
          'WAITING',
          'SENT',
          'CLOSED',
          'DONE',
        ].includes(subStatusNorm);
        const targetSubUser =
          updatedSubtask.User?.id === assigneeId
            ? updatedSubtask.User
            : (updatedSubtask.assignees || []).find((u: any) => u.id === assigneeId);

        if (mode === 'IN_PROGRESS') {
          const nowManilaTime = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Manila',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }).format(new Date());

          const nowManilaDate = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Manila',
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }).format(new Date());

          const existingSubProgIdx = reviewsList.findIndex(
            (r: any) => r?.type === 'SHEET_PROGRESS' && r?.subtaskId === currentSubtask.id
          );
          const subMaName = targetSubUser?.name || actorName;
          const subClientForSheet = currentSubtask.task?.list?.name || 'General';
          const liveSubProg = {
            type: 'SHEET_PROGRESS',
            subtaskId: currentSubtask.id,
            timeIn: nowManilaTime,
            timeOut: null,
            sheetRow: null,
            isMissingTime: false,
            isUpwork: false,
            client: subClientForSheet,
            timeTracker: 'No Need to Track',
            maName: subMaName,
            status: 'In progress',
            date: nowManilaDate,
            isLive: true,
            taskDeliverables: currentSubtask.title,
            taskUpdateAndDeliverables: null,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          if (existingSubProgIdx !== -1) {
            reviewsList[existingSubProgIdx] = { ...reviewsList[existingSubProgIdx], ...liveSubProg };
          } else {
            reviewsList.push(liveSubProg);
          }

          // Persist DailySheetLog synchronously and trigger n8n Google Sheets sync in the background
          const subTaskTitleForSheet = `${currentSubtask.title} (${currentSubtask.task?.title || 'Subtask'})`;

          const savedSubLog = await upsertDailySheetLog({
            date: nowManilaDate,
            maName: subMaName,
            userId: assigneeId,
            taskId: currentSubtask.taskId,
            subtaskId: currentSubtask.id,
            sheetRow: null,
            client: subClientForSheet,
            taskName: subTaskTitleForSheet,
            timeIn: nowManilaTime,
            timeOut: null,
            isUpwork: false,
            timeTracker: 'No Need to Track',
            status: 'In Progress',
            taskDeliverables: null,
            taskLink: `https://nexus.vipscaleph.com/lists/${currentSubtask.task?.listId}?task=${currentSubtask.taskId}&subtask=${currentSubtask.id}`,
            source: 'NEXUS_BOARD',
          }).catch((err) => {
            logger.warn({ err }, 'Failed to upsert DailySheetLog on subtask IN_PROGRESS');
            return null;
          });
          void triggerN8nStartTaskWebhook({
            userId: assigneeId,
            userName: subMaName,
            userEmail: targetSubUser?.email || actorUser?.email,
            dailySheetUrl: (targetSubUser as any)?.dailySheetUrl,
            dailySheetLogId: savedSubLog?.id || null,
            taskId: currentSubtask.taskId,
            subtaskId: currentSubtask.id,
            taskTitle: subTaskTitleForSheet,
            clientName: subClientForSheet,
            taskLink: `https://nexus.vipscaleph.com/lists/${currentSubtask.task?.listId}?task=${currentSubtask.taskId}&subtask=${currentSubtask.id}`,
            status: 'In Progress',
            timeIn: nowManilaTime,
            timeOut: null,
            timeTracker: 'No Need to Track',
            taskDeliverablesDescription: '',
            description: '',
            date: nowManilaDate,
            mode: 'START',
            insertEmptyRowBeforeStart: hasPausedSub,
          });
          await closeOtherOpenBoardSessionsForMa(subMaName, currentSubtask.taskId, currentSubtask.id, nowManilaTime);
          subProgressPayload = savedSubLog ? buildProgressFromSheetLog(savedSubLog) : liveSubProg;
          subMaSession = {
            maName: subMaName,
            taskId: target.rawId,
            subtaskId: currentSubtask.id,
            listId: currentSubtask.task?.listId || null,
            taskStatus: updatedSubtask.status || 'IN PROGRESS',
            priority: updatedSubtask.priority || null,
            subStatuses,
            timeIn: nowManilaTime,
            timeOut: null,
            client: subClientForSheet,
            taskName: currentSubtask.title,
            date: savedSubLog?.dateKey || getManilaDateStr(),
            status: 'In progress',
            isUpwork: false,
            isMissingTime: false,
            rowNumber: savedSubLog?.sheetRow ?? null,
            startedAt: liveSubProg.startedAt,
            updatedAt: liveSubProg.updatedAt,
            active: true,
          };
          await setMaActiveSession(subMaName.toLowerCase().trim(), subMaSession).catch(() => {});
          io.emit('ma:session_updated', subMaSession);
          io.emit('task_map:ma_progress_changed', subMaSession);
          if (savedSubLog) {
            io.emit('daily_sheet_log:updated', { log: savedSubLog });
          }
        }

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

      // Leaving In Progress (to Queue or back to the pool) ends the subtask's open time-in session
      if (mode === 'QUEUE' || !assigneeId) {
        const subTimeOut = formatManilaClockTime(new Date());
        for (const r of reviewsList) {
          if (r?.type === 'SHEET_PROGRESS' && r?.subtaskId === currentSubtask.id && r.timeIn && !r.timeOut) {
            r.timeOut = subTimeOut;
          }
        }
        await closeLiveDailySheetLogsForTask({
          taskId: currentSubtask.taskId,
          subtaskId: currentSubtask.id,
          timeOut: subTimeOut,
        }).catch((err) => logger.warn({ err }, 'Failed to close live DailySheetLog for subtask'));
        await clearMaSessionsForTarget(currentSubtask.taskId, currentSubtask.id);
      }

      const updatedRecord = await updateTaskMapRecord(currentSubtask.taskId, { pmReviews: reviewsList });
      await invalidateCache(
        `task:${currentSubtask.taskId}`,
        `task:${currentSubtask.id}`,
        `task:activities:${currentSubtask.taskId}`,
        'tasks:all',
        'dashboard:all',
        'lists:all',
        'task_map:*'
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
        ...(subProgressPayload ? { progress: subProgressPayload } : {}),
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

      return res.json({
        success: true,
        task: updatedSubtask,
        taskMap: updatedRecord,
        ...(subProgressPayload ? { progress: subProgressPayload } : {}),
        ...(subMaSession ? { maSession: subMaSession } : {}),
      });
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

    // Guard: Client Overhours / Lock enforcement
    // When assigning a task to a user, if the client is overtime/overhours, require a valid 4-digit PM OTP
    if (assigneeId) {
      const clientName = currentTask.list?.name;
      if (clientName) {
        const lockStatus = await checkClientLockStatus(clientName);
        if (lockStatus.isLocked) {
          const otpInput = (req.body?.otp || '').toString().trim();
          if (otpInput) {
            const verification = await verifyDailyOtp(otpInput);
            if (verification.valid && verification.pm) {
              await setClientUnlockedToday(clientName, verification.pm);
              await prisma.auditLog.create({
                data: {
                  action: 'CLIENT_OVERHOURS_OTP_UNLOCK',
                  entity: 'CLIENT',
                  entityId: clientName,
                  userId: verification.pm.id,
                  details: {
                    pmId: verification.pm.id,
                    pmName: verification.pm.name,
                    pmEmail: verification.pm.email,
                    clientName,
                    taskId: id,
                    taskTitle: currentTask.title,
                    unlockedBy: user.name,
                    source: 'nexus_task_map',
                    unlockedAt: new Date().toISOString(),
                  },
                },
              }).catch(() => {});
              io.emit('otp:used', {
                pmId: verification.pm.id,
                pmName: verification.pm.name,
                clientName,
                maName: user.name,
                taskId: id,
                source: 'nexus_task_map',
                timestamp: new Date().toISOString(),
              });
            } else {
              return res.status(400).json({ error: 'Invalid 4-digit PM OTP' });
            }
          } else {
            const hoursInfo =
              typeof lockStatus.hoursLogged === 'number' && typeof lockStatus.weeklyLimit === 'number'
                ? ` (${lockStatus.hoursLogged.toFixed(1)} / ${lockStatus.weeklyLimit.toFixed(1)} hrs)`
                : '';
            return res.status(403).json({
              error: 'CLIENT_LOCKED',
              isClientLocked: true,
              clientName,
              hoursLogged: lockStatus.hoursLogged,
              weeklyLimit: lockStatus.weeklyLimit,
              message: `Client "${clientName}" is locked: exceeded weekly limit${hoursInfo}. 4-digit PM OTP required to assign.`,
            });
          }
        }
      }
    }

    const existingPmAssignment = reviewsList.find(
      (r: any) => r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId && r?.assignedTo === assigneeId
    );

    const currentStatusNorm = (currentTask.status || '').toUpperCase().replace(/[\s_-]+/g, '');
    const isCurrentlyInProgressOrHold = currentStatusNorm === 'INPROGRESS' || currentStatusNorm === 'ONHOLD';
    const existingOwnerName =
      (currentTask.assignee?.id === assigneeId ? currentTask.assignee?.name : null) ||
      (currentTask.assignees || []).find((a: any) => a.id === assigneeId)?.name ||
      '';
    const hasActiveLiveMain =
      mode === 'IN_PROGRESS' && existingOwnerName
        ? await hasLiveSheetSessionForTarget(existingOwnerName, id, null)
        : false;
    // A live sheet session keeps the card in In Progress even when status/PM assignment already say Queue
    const hasLiveSession = (await prisma.dailySheetLog.count({ where: { taskId: id, isLive: true } })) > 0;

    // Guard: If task is already assigned to this user and has matching PM assignment mode, return early
    const isAlreadyAssigned =
      assigneeId &&
      (currentTask.assigneeId === assigneeId ||
        (currentTask.assignees || []).some((a) => a.id === assigneeId)) &&
      existingPmAssignment &&
      existingPmAssignment.mode === mode &&
      !(mode === 'QUEUE' && (isCurrentlyInProgressOrHold || hasLiveSession)) &&
      !(mode === 'IN_PROGRESS' && !hasActiveLiveMain);
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
        select: { id: true, name: true, roles: true, systemRole: true, dailySheetUrl: true, email: true },
      });

      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found' });
      }

      updateData.assigneeId = assigneeId;
      updateData.assignees = { set: [{ id: assigneeId }] };
      if (Array.isArray(params.assigneeRoleRestrictions)) {
        updateData.assigneeRoleRestrictions = params.assigneeRoleRestrictions;
      } else {
        const targetRole = params.role || targetUser.roles?.[0];
        const existingRestrictions = currentTask.assigneeRoleRestrictions || [];
        if (targetRole && !existingRestrictions.some((r: string) => r.toLowerCase().trim() === targetRole.toLowerCase().trim())) {
          updateData.assigneeRoleRestrictions = [...existingRestrictions, targetRole];
        }
      }
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
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true, dailySheetUrl: true } },
        assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true, dailySheetUrl: true } },
        creator: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    // Remove Available / Pending / Revision statuses if assigned to a user column; add Available Task if unassigned back to pool
    let newStatuses = record.statuses || [];
    let reviewsModified = false;
    let handedOver = record.handedOver;
    let mainProgressPayload: any = null;
    let mainMaSession: any = null;

    if (assigneeId) {
      const hasPausedMain = newStatuses.some(
        (s) => s.toUpperCase().replace(/[\s_-]+/g, '') === 'PAUSED'
      );
      const hasHandoverOutMain = newStatuses.some(
        (s) => s.toUpperCase().replace(/[\s_-]+/g, '') === 'HANDOVEROUT'
      );
      const hadMainHandover =
        Boolean(record.handedOver) ||
        newStatuses.some((s) => {
          const n = s.toUpperCase().replace(/[\s_-]+/g, '');
          return n === 'HANDOVER' || n === 'HANDOVEROUT' || n === 'HANDOVERIN';
        });
      const isMainTransferBetweenUsers =
        action === 'TRANSFER' || Boolean(currentOwnerId && currentOwnerId !== assigneeId);
      const keepMainHandoverOutInQueue =
        mode === 'QUEUE' &&
        !isMainTransferBetweenUsers &&
        !Boolean((req.body as any)?.preserveHandover) &&
        hasHandoverOutMain;
      const shouldSetMainHandover =
        mode === 'QUEUE' &&
        !hasPausedMain &&
        !keepMainHandoverOutInQueue &&
        (hadMainHandover || isMainTransferBetweenUsers || Boolean((req.body as any)?.preserveHandover));

      newStatuses = newStatuses.filter((s) => {
        const up = s.toUpperCase().replace(/[\s_-]+/g, '');
        if (mode === 'QUEUE' && up === 'INPROGRESS') return false;
        return up !== 'AVAILABLETASK' && up !== 'PENDING' && up !== 'REVISION' && up !== 'REVISIONS' && up !== 'INREVIEW' && up !== 'TOREVIEW' && up !== 'HANDOVER' && up !== 'HANDOVEROUT' && up !== 'HANDOVERIN';
      });
      if (keepMainHandoverOutInQueue) {
        newStatuses = ['Hand-over Out'];
      } else if (shouldSetMainHandover) {
        newStatuses = ['Hand-over In'];
      } else if (mode === 'IN_PROGRESS' && !newStatuses.some((s) => s.toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS')) {
        newStatuses.push('In progress');
      } else if (mode === 'QUEUE' && newStatuses.length === 0) {
        newStatuses = ['Available Task'];
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

      if (mode === 'IN_PROGRESS') {
        const nowManilaTime = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Manila',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }).format(new Date());

        const nowManilaDate = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Manila',
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }).format(new Date());

        const existingProgIdx = reviewsList.findIndex((r: any) => r?.type === 'SHEET_PROGRESS' && !r?.subtaskId);
        const mainMaName = updatedTask.assignee?.name || actorName;
        const mainClientForSheet = updatedTask.list?.name || 'General';
        const liveProg = {
          type: 'SHEET_PROGRESS',
          timeIn: nowManilaTime,
          timeOut: null,
          sheetRow: null,
          isMissingTime: false,
          isUpwork: false,
          client: mainClientForSheet,
          timeTracker: 'No Need to Track',
          maName: mainMaName,
          status: 'In progress',
          date: nowManilaDate,
          isLive: true,
          taskDeliverables: null,
          taskUpdateAndDeliverables: null,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (existingProgIdx !== -1) {
          reviewsList[existingProgIdx] = { ...reviewsList[existingProgIdx], ...liveProg };
        } else {
          reviewsList.push(liveProg);
        }

        // Persist DailySheetLog synchronously and trigger n8n Google Sheets sync in the background
        const savedMainLog = await upsertDailySheetLog({
          date: nowManilaDate,
          maName: mainMaName,
          userId: assigneeId,
          taskId: id,
          sheetRow: null,
          client: mainClientForSheet,
          taskName: updatedTask.title,
          timeIn: nowManilaTime,
          timeOut: null,
          isUpwork: false,
          timeTracker: 'No Need to Track',
          status: 'In Progress',
          taskDeliverables: null,
          taskLink: `https://nexus.vipscaleph.com/lists/${updatedTask.listId}?task=${id}`,
          source: 'NEXUS_BOARD',
        }).catch((err) => {
          logger.warn({ err }, 'Failed to upsert DailySheetLog on main task IN_PROGRESS');
          return null;
        });
        void triggerN8nStartTaskWebhook({
          userId: assigneeId,
          userName: mainMaName,
          userEmail: updatedTask.assignee?.email || actorUser?.email,
          dailySheetUrl: (updatedTask.assignee as any)?.dailySheetUrl,
          dailySheetLogId: savedMainLog?.id || null,
          taskId: id,
          taskTitle: updatedTask.title,
          clientName: mainClientForSheet,
          taskLink: `https://nexus.vipscaleph.com/lists/${updatedTask.listId}?task=${id}`,
          status: 'In Progress',
          timeIn: nowManilaTime,
          timeOut: null,
          timeTracker: 'No Need to Track',
          taskDeliverablesDescription: '',
          description: '',
          date: nowManilaDate,
          mode: 'START',
          insertEmptyRowBeforeStart: hasPausedMain,
        });
        await closeOtherOpenBoardSessionsForMa(mainMaName, id, null, nowManilaTime);
        mainProgressPayload = savedMainLog ? buildProgressFromSheetLog(savedMainLog) : liveProg;
        mainMaSession = {
          maName: mainMaName,
          taskId: id,
          listId: updatedTask.listId || null,
          listName: updatedTask.list?.name || null,
          listStatuses: Array.isArray(updatedTask.list?.statuses) ? updatedTask.list.statuses : undefined,
          taskStatus: updatedTask.status || 'IN PROGRESS',
          priority: updatedTask.priority || null,
          subStatuses: newStatuses,
          timeIn: nowManilaTime,
          timeOut: null,
          client: mainClientForSheet,
          taskName: updatedTask.title,
          date: savedMainLog?.dateKey || getManilaDateStr(),
          status: 'In progress',
          isUpwork: false,
          isMissingTime: false,
          rowNumber: savedMainLog?.sheetRow ?? null,
          startedAt: liveProg.startedAt,
          updatedAt: liveProg.updatedAt,
          active: true,
        };
        await setMaActiveSession(mainMaName.toLowerCase().trim(), mainMaSession).catch(() => {});
        io.emit('ma:session_updated', mainMaSession);
        io.emit('task_map:ma_progress_changed', mainMaSession);
        if (savedMainLog) {
          io.emit('daily_sheet_log:updated', { log: savedMainLog });
        }
      }

      const taskStatusNorm = (updatedTask.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      const isReviewOrCrmTask = [
        'TOREVIEW',
        'INREVIEW',
        'REVIEW',
        'CHECKING',
        'INCHECKING',
        'CRM',
        'CRMNEEDEDTOSEND',
        'CRMTOSEND',
        'CRMNEEDEDTOFOLLOWUP',
        'CRMFOLLOWUP',
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
      const hadHandoverTag = newStatuses.some((s) => {
        const n = s.toUpperCase().replace(/[\s_-]+/g, '');
        return n === 'HANDOVER' || n === 'HANDOVEROUT' || n === 'HANDOVERIN';
      });
      handedOver = hadHandoverTag;
      newStatuses = hadHandoverTag ? ['Hand-over'] : ['Available Task'];

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

    // Leaving In Progress (to Queue or back to the pool) ends the task's open time-in sessions
    if (mode === 'QUEUE' || !assigneeId) {
      const queueTimeOut = formatManilaClockTime(new Date());
      for (const r of reviewsList) {
        if (r?.type === 'SHEET_PROGRESS' && r.timeIn && !r.timeOut) {
          r.timeOut = queueTimeOut;
          reviewsModified = true;
        }
      }
      await closeLiveDailySheetLogsForTask({ taskId: id, timeOut: queueTimeOut }).catch((err) =>
        logger.warn({ err }, 'Failed to close live DailySheetLog for task')
      );
      await clearMaSessionsForTarget(id, null);
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
      'task_map:*'
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
      ...(mainProgressPayload ? { progress: mainProgressPayload } : {}),
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

    return res.json({
      success: true,
      task: updatedTask,
      taskMap: updatedRecord,
      ...(mainProgressPayload ? { progress: mainProgressPayload } : {}),
      ...(mainMaSession ? { maSession: mainMaSession } : {}),
    });
  } catch (error: any) {
    logger.error({ error }, 'Error assigning task in Task Map');
    return res.status(500).json({ error: 'Failed to assign task' });
  }
}

export const assignTaskMapTask = async (req: Request, res: Response) => {
  const { assigneeId = null, mode = 'QUEUE', assigneeRoleRestrictions, role } = req.body || {};
  const normalizedMode: TaskMapMoveMode = mode === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'QUEUE';
  return executeTaskMapAssignment(req, res, {
    action: 'ASSIGN',
    assigneeId: assigneeId || null,
    mode: normalizedMode,
    assigneeRoleRestrictions,
    role,
  });
};

export const transferTaskMapTask = async (req: Request, res: Response) => {
  const { targetUserId, assigneeId, assigneeRoleRestrictions, role } = req.body || {};
  const resolvedTargetId = targetUserId ?? assigneeId ?? null;
  return executeTaskMapAssignment(req, res, {
    action: 'TRANSFER',
    assigneeId: resolvedTargetId,
    mode: 'QUEUE',
    assigneeRoleRestrictions,
    role,
  });
};

/**
 * Search or list tasks under Admin folder or known Admin lists regardless of status (Closed, Daily, In Progress, etc.)
 */
export const getAdminTasks = async (req: Request, res: Response) => {
  try {
    const rawQ = ((req.query.q as string) || '').trim().toLowerCase();
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 250);

    // 1. Locate all lists under the Admin folder or in ADMIN_LIST_NAMES
    const adminLists = await prisma.list.findMany({
      where: {
        OR: [
          { name: { in: Array.from(ADMIN_LIST_NAMES), mode: 'insensitive' } },
          { folder: { name: { contains: 'Admin', mode: 'insensitive' } } },
        ],
      },
      select: { id: true, name: true, folder: { select: { id: true, name: true } } },
    });
    const adminListIds = adminLists.map((l) => l.id);

    // Build search conditions across title, list name, folder name with NO status restrictions
    let whereClause: any = {
      listId: { in: adminListIds },
    };

    if (rawQ) {
      if (rawQ !== 'admin' && rawQ !== 'adm') {
        const orConditions: any[] = [
          { title: { contains: rawQ, mode: 'insensitive' } },
          { list: { name: { contains: rawQ, mode: 'insensitive' } } },
          { list: { folder: { name: { contains: rawQ, mode: 'insensitive' } } } },
        ];

        // Handle common aliases/typos: "xfinite" vs "xfnite"
        if (rawQ.includes('xfinite')) {
          const alias = rawQ.replace(/xfinite/g, 'xfnite');
          orConditions.push({ title: { contains: alias, mode: 'insensitive' } });
          orConditions.push({ list: { name: { contains: alias, mode: 'insensitive' } } });
        } else if (rawQ.includes('xfnite')) {
          const alias = rawQ.replace(/xfnite/g, 'xfinite');
          orConditions.push({ title: { contains: alias, mode: 'insensitive' } });
          orConditions.push({ list: { name: { contains: alias, mode: 'insensitive' } } });
        }

        whereClause.OR = orConditions;
      }
    }

    const tasks = await prisma.task.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        assigneeId: true,
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
        list: {
          select: {
            id: true,
            name: true,
            folder: { select: { id: true, name: true } },
          },
        },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    const mappedTasks = tasks.map((t) => ({
      ...t,
      isAdminTask: true,
      isClosed: isClosedStatus((t.status || '').toUpperCase().replace(/[\s_-]+/g, '')),
      progress: {
        client: t.list?.name || 'Admin',
      },
    }));

    return res.json({ success: true, tasks: mappedTasks });
  } catch (error: any) {
    logger.error({ error }, 'Error fetching admin tasks');
    return res.status(500).json({ error: 'Failed to fetch admin tasks' });
  }
};

/**
 * Claim an available task from the pool (Assign to self)
 */
export const claimTask = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'Authentication required' });

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
      'task_map:*'
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
        // Tag "Ready to Send"
        if (!statuses.includes('Ready to Send')) {
          statuses.push('Ready to Send');
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

      await invalidateCache('task_map:*', `task:${id}`).catch(() => { });
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

      await invalidateCache('task_map:*', `task:${id}`).catch(() => { });
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

    await invalidateCache('task_map:*').catch(() => { });
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
    // latestDate must always be today's operational date, never a past snapshot date
    const latestDate = todayManila;
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
    await invalidateCache('task_map:*', `task:${id}`).catch(() => { });
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

    const [rawTasks, launchRecords, clientDashboardLists] = await Promise.all([
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
      prisma.launchRecord.findMany({
        include: {
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
          assignees: { select: { id: true, name: true, avatarUrl: true, imageUrl: true } },
          creator: { select: { id: true, name: true } },
          task: { select: { id: true, title: true, status: true, priority: true } },
        },
        orderBy: [{ startDate: 'asc' }, { updatedAt: 'desc' }],
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
    const linkedTaskIds = new Set<string>();

    // 1. Process dedicated LaunchRecord entries
    for (const lr of launchRecords) {
      if (lr.taskId) linkedTaskIds.add(lr.taskId);

      const formatted = formatLaunchRecordToItem(lr);
      const effectiveLaunchDate = formatted.effectiveLaunchDate;
      const targetPeriod = formatted.targetPeriod;

      const closed = formatted.isClosed;
      const inReview = !closed && isReviewStatus(lr.status);

      totalScheduled++;
      if (inReview) totalInReview++;
      if (lr.isMilestone) totalMilestones++;
      if (!effectiveLaunchDate && targetPeriod) totalTbd++;

      if (lr.list?.id && lr.list?.name) {
        const cur = clientMap.get(lr.list.id);
        if (cur) cur.count++;
        else clientMap.set(lr.list.id, { id: lr.list.id, name: lr.list.name, count: 1 });
      }

      if (effectiveLaunchDate && start && end && (effectiveLaunchDate < start || effectiveLaunchDate > end)) {
        continue;
      }

      items.push(formatted);
    }

    // 2. Process legacy Task entries (skip if already represented by a LaunchRecord)
    for (const t of rawTasks) {
      if (linkedTaskIds.has(t.id)) continue;
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

    // Check if :id is an existing LaunchRecord
    const existingLaunchRecord = await prisma.launchRecord.findUnique({ where: { id } });
    if (existingLaunchRecord) {
      if (isLaunchDate === false && (launchDate === null || launchDate === undefined) && !targetPeriod) {
        await prisma.launchRecord.delete({ where: { id } });
        await invalidateCache('task_map:*', 'launch_map:all', 'launch_map:*').catch(() => {});
        io.emit('launch_map:deleted', { id });
        io.emit('task_map:updated', { taskId: id, deleted: true });
        return res.json({ success: true, deleted: true });
      }

      const updated = await updateLaunchRecord(
        id,
        {
          startDate: launchDate ? new Date(`${launchDate}T12:00:00+08:00`) : undefined,
          targetPeriod,
          isMilestone: isLaunchDate !== undefined ? Boolean(isLaunchDate) : undefined,
          workstream,
          details,
          notes,
        },
        user?.id || null
      );

      if (!updated) {
        return res.status(404).json({ error: 'Launch record not found' });
      }

      const formatted = formatLaunchRecordToItem(updated);
      io.emit('task_map:updated', { taskId: id, ...formatted });
      io.emit('launch_map:updated', { ...formatted });

      return res.json({
        success: true,
        launchMeta: formatted.launchMeta,
        effectiveLaunchDate: formatted.effectiveLaunchDate,
        targetPeriod: formatted.targetPeriod,
        dueDate: formatted.dueDate,
        alertSent: false,
      });
    }

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
 * Create a new LaunchRecord directly in the dedicated LaunchRecord table
 */
export const createLaunchRecordHandler = async (req: Request, res: Response) => {
  try {
    const {
      title,
      listId,
      startDate,
      startTime,
      endDate,
      endTime,
      timezone,
      targetPeriod,
      isMilestone,
      workstream,
      details,
      notes,
      status,
      priority,
      assigneeIds,
      taskId,
    } = req.body || {};

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (!listId) {
      return res.status(400).json({ error: 'Client listId is required' });
    }

    const user = (req as any).user;
    const cleanStartDate = startDate
      ? new Date(`${String(startDate).slice(0, 10)}T12:00:00+08:00`)
      : new Date();

    const cleanEndDate = endDate
      ? new Date(`${String(endDate).slice(0, 10)}T12:00:00+08:00`)
      : null;

    const record = await createLaunchRecord(
      {
        title: title.trim(),
        listId,
        startDate: cleanStartDate,
        startTime: startTime || null,
        endDate: cleanEndDate,
        endTime: endTime || null,
        timezone: timezone || 'Asia/Manila',
        targetPeriod: targetPeriod || null,
        isMilestone: isMilestone !== undefined ? Boolean(isMilestone) : true,
        workstream: workstream || null,
        details: details || null,
        notes: notes || null,
        status: status || 'SCHEDULED',
        priority: priority || 'MEDIUM',
        assigneeIds: Array.isArray(assigneeIds) ? assigneeIds : [],
        taskId: taskId || null,
      },
      user?.id || null
    );

    const formatted = formatLaunchRecordToItem(record);

    io.emit('launch_map:created', formatted);
    io.emit('task_map:updated', { taskId: record.id, ...formatted });

    res.status(201).json({
      success: true,
      launch: record,
      item: formatted,
      launchMeta: formatted.launchMeta,
      effectiveLaunchDate: formatted.effectiveLaunchDate,
      targetPeriod: formatted.targetPeriod,
      dueDate: formatted.dueDate,
    });
  } catch (error: any) {
    logger.error({ error }, 'Error creating launch record');
    res.status(500).json({ error: error?.message || 'Failed to create launch record' });
  }
};

/**
 * Delete a LaunchRecord directly
 */
export const deleteLaunchRecordHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.launchRecord.findUnique({ where: { id } });
    if (!existing) {
      // Fallback: check if it's a task with launch meta
      const existingTask = await prisma.task.findUnique({ where: { id } });
      if (existingTask) {
        await upsertTaskLaunchMeta(id, { launchDate: null, targetPeriod: null, isLaunchDate: false }, (req as any).user?.id);
        return res.json({ success: true, message: 'Task unscheduled from Launch Map' });
      }
      return res.status(404).json({ error: 'Launch record not found' });
    }

    await prisma.launchRecord.delete({ where: { id } });
    await invalidateCache('task_map:*', 'launch_map:all', 'launch_map:*').catch(() => {});
    io.emit('launch_map:deleted', { id });
    io.emit('task_map:updated', { taskId: id, deleted: true });

    res.json({ success: true, message: 'Launch record deleted successfully' });
  } catch (error: any) {
    logger.error({ error }, 'Error deleting launch record');
    res.status(500).json({ error: 'Failed to delete launch record' });
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
      const reviewStatusNames = ['In Review', 'IN REVIEW', 'To review', 'TO REVIEW', 'Review', 'Checking', 'CHECKING', 'In Checking', 'IN CHECKING'];
      // Find tasks and subtasks assigned to this auditor in review status
      const [reviewTasks, reviewSubtasks] = await Promise.all([
        prisma.task.findMany({
          where: {
            assigneeId: targetUserId,
            status: { in: reviewStatusNames },
          },
          select: { id: true, title: true, listId: true, checklists: { include: { items: true } } },
        }),
        prisma.subtask.findMany({
          where: {
            assigneeId: targetUserId,
            completed: false,
            status: { in: reviewStatusNames },
          },
          select: { id: true, taskId: true, title: true },
        }),
      ]);

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
        await invalidateCache(`task:${t.id}`, 'task_map:*', 'tasks:all');
      }

      for (const st of reviewSubtasks) {
        await prisma.subtask.update({
          where: { id: st.id },
          data: {
            assigneeId: null,
            status: 'IN REVIEW',
            assignees: { set: [] },
          },
        });
        const parentRec = await getOrCreateTaskMapRecord(st.taskId);
        let revs: any[] = Array.isArray(parentRec.pmReviews) ? [...parentRec.pmReviews] : [];
        revs = revs
          .filter((r: any) => !(r?.type === 'PM_ASSIGNMENT' && r?.subtaskId === st.id))
          .map((r: any) =>
            r?.type === 'SUBTASK_STATE' && r?.subtaskId === st.id
              ? { ...r, statuses: [], handedOver: false }
              : r
          );
        await updateTaskMapRecord(st.taskId, { pmReviews: revs });
        await invalidateCache(`task:${st.taskId}`, 'task_map:*', 'tasks:all');
      }

      await invalidateCache('task_map:*').catch(() => { });
      io.emit('task_map:updated');
      return res.json({
        success: true,
        count: reviewTasks.length + reviewSubtasks.length,
        resetTaskIds: [
          ...reviewTasks.map((t) => t.id),
          ...reviewSubtasks.map((st) => `subtask:${st.id}`),
        ],
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
      await invalidateCache(`task:${t.id}`, 'task_map:*', 'tasks:all');
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
      await invalidateCache(`task:${st.taskId}`, `task:${st.id}`, 'task_map:*', 'tasks:all');
      resetTaskIds.push(`subtask:${st.id}`);
    }

    await invalidateCache('task_map:*').catch(() => { });
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

/**
 * Returns today's 4-digit OTP for the currently authenticated user if they are a Project Manager or Admin.
 */
export const getMyDailyOtpHandler = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !isUserProjectManagerOrAdmin(user)) {
    return res.json({ isPm: false, otp: null });
  }
  const otp = generateDailyOtpForUser(user.id);
  const dateStr = getManilaDateString();

  const recentLogs = await prisma.auditLog.findMany({
    where: {
      userId: user.id,
      action: 'CLIENT_OVERHOURS_OTP_UNLOCK',
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  }).catch(() => []);

  const recentAuthorizations = recentLogs.map((log: any) => ({
    clientName: log.details?.clientName || log.entityId,
    maName: log.details?.maName || log.details?.unlockedBy || 'Assistant',
    sheet: log.details?.sheet || null,
    source: log.details?.source || 'spreadsheet',
    timestamp: log.createdAt,
  }));

  return res.json({ isPm: true, otp, date: dateStr, recentAuthorizations });
};

/**
 * Authenticated in-app verification of a 4-digit PM OTP for client unlock.
 */
export const verifyClientOtpHandler = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { client, otp } = req.body || {};
  if (!client || !otp) {
    return res.status(400).json({ success: false, error: 'Client and OTP are required' });
  }
  const verification = await verifyDailyOtp(String(otp).trim());
  if (!verification.valid || !verification.pm) {
    return res.status(400).json({ success: false, error: 'Invalid 4-digit PM OTP' });
  }
  const pm = verification.pm;
  await setClientUnlockedToday(client.trim(), pm);
  await prisma.auditLog.create({
    data: {
      action: 'CLIENT_OVERHOURS_OTP_UNLOCK',
      entity: 'CLIENT',
      entityId: client.trim(),
      userId: pm.id,
      details: {
        pmId: pm.id,
        pmName: pm.name,
        pmEmail: pm.email,
        clientName: client.trim(),
        unlockedBy: user?.name || 'Nexus User',
        source: 'nexus_in_app',
        unlockedAt: new Date().toISOString(),
      },
    },
  }).catch(() => {});
  io.emit('otp:used', {
    pmId: pm.id,
    pmName: pm.name,
    clientName: client.trim(),
    maName: user?.name || 'Nexus User',
    source: 'nexus_in_app',
    timestamp: new Date().toISOString(),
  });
  notifyAdminsOfClientOtpUnlock({
    pm,
    clientName: client.trim(),
    maName: user?.name || 'Nexus User',
  });
  return res.json({ success: true, pmName: pm.name, clientName: client.trim() });
};

/**
 * Returns lock and overtime pacing status for a specific client.
 */
export const getClientLockStatusHandler = async (req: Request, res: Response) => {
  const clientName = String(req.query.client || '').trim();
  const status = await checkClientLockStatus(clientName);
  return res.json(status);
};

/**
 * Handles explicit schedule row sync from frontend to spreadsheet / n8n
 */
const recentSpreadsheetStopDedupe = new Map<string, number>();

export const syncSpreadsheetRowHandler = async (req: Request, res: Response) => {
  try {
    const { taskId, subtaskId, mode, sheetRow, rows, isSplitAcrossMidnight, source } = req.body;
    const user = (req as any).user;

    const actorUser = user?.id
      ? await prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, name: true, email: true, dailySheetUrl: true },
        })
      : null;
    const actorDisplayName = actorUser?.name || user?.name || user?.email || 'User';

    const targetRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (targetRow && (targetRow.timeIn || targetRow.timeOut)) {
      if (!String(targetRow.client || '').trim() || !String(targetRow.task || '').trim()) {
        return res.status(400).json({
          error: 'Client and Task are required before logging Time In or Time Out.',
        });
      }
    }

    const parsedTaskId = taskId ? parseTaskMapTargetId(taskId).entityId : null;
    // Never treat synthetic frontend assumption-block IDs (general-slot-*) as real DB Task IDs
    const cleanTaskId = parsedTaskId && !parsedTaskId.startsWith('general-slot-') ? parsedTaskId : null;
    const nowTimeOut = targetRow?.timeOut || new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date());
    const effectiveTimeOut = mode === 'STOP' ? nowTimeOut : (targetRow?.timeOut || null);
    let resolvedSheetRow: number | null = sheetRow ? Number(sheetRow) : null;
    let resolvedTimeIn: string | null = targetRow?.timeIn || null;

    // On STOP, if sheetRow or timeIn wasn't supplied by the frontend, look up the MA's open DailySheetLog for today
    if (mode === 'STOP' && (!resolvedSheetRow || !resolvedTimeIn)) {
      const maKey = actorDisplayName.trim().toLowerCase();
      const dateKey = getManilaDateStr();
      const openLog = await prisma.dailySheetLog.findFirst({
        where: {
          dateKey,
          isLive: true,
          ...(actorUser?.id ? { OR: [{ maKey }, { userId: actorUser.id }] } : { maKey }),
          ...(cleanTaskId ? { taskId: cleanTaskId } : {}),
        },
        orderBy: { submittedAt: 'desc' },
        select: { sheetRow: true, timeIn: true },
      }).catch(() => null);
      if (openLog) {
        if (!resolvedSheetRow && openLog.sheetRow) resolvedSheetRow = Number(openLog.sheetRow);
        if (!resolvedTimeIn && openLog.timeIn) resolvedTimeIn = openLog.timeIn;
      }
    }

    const normalizedTargetDeliverables =
      targetRow?.taskDeliverablesDescription !== undefined && targetRow?.taskDeliverablesDescription !== null
        ? String(targetRow.taskDeliverablesDescription).trim()
        : '';

    if (cleanTaskId && targetRow) {
      const parentRecord = await getOrCreateTaskMapRecord(cleanTaskId);
      let pmReviews = parsePmReviewsArray(parentRecord.pmReviews);

      let matched = false;
      for (const r of pmReviews) {
        if (r?.type === 'SHEET_PROGRESS' && (!subtaskId || r.subtaskId === subtaskId)) {
          if (targetRow.timeIn && r.timeIn === targetRow.timeIn) {
            r.timeOut = effectiveTimeOut || '';
            if (normalizedTargetDeliverables) r.taskDeliverables = normalizedTargetDeliverables;
            if (targetRow.taskUpdateAndDeliverables) r.taskUpdateAndDeliverables = targetRow.taskUpdateAndDeliverables;
            if (!resolvedSheetRow && r.sheetRow) resolvedSheetRow = Number(r.sheetRow);
            matched = true;
          } else if (!r.timeOut) {
            r.timeOut = effectiveTimeOut || '';
            if (normalizedTargetDeliverables) r.taskDeliverables = normalizedTargetDeliverables;
            if (targetRow.taskUpdateAndDeliverables) r.taskUpdateAndDeliverables = targetRow.taskUpdateAndDeliverables;
            if (!resolvedSheetRow && r.sheetRow) resolvedSheetRow = Number(r.sheetRow);
            matched = true;
          }
        }
      }
      if (!matched && mode === 'STOP') {
        pmReviews.push({
          type: 'SHEET_PROGRESS',
          taskId: cleanTaskId,
          subtaskId: subtaskId || null,
          timeIn: targetRow.timeIn || '',
          timeOut: nowTimeOut,
          client: targetRow.client || 'General',
          task: targetRow.task || 'Task',
          taskDeliverables: normalizedTargetDeliverables || null,
          taskUpdateAndDeliverables: targetRow.taskUpdateAndDeliverables || null,
          updatedAt: new Date().toISOString(),
        });
      }
      await updateTaskMapRecord(cleanTaskId, { pmReviews });
    }

    let savedLog = null;
    if (targetRow) {
      savedLog = await upsertDailySheetLog({
        date: targetRow.date || getManilaDateStr(),
        maName: actorDisplayName,
        userId: actorUser?.id || user?.id || null,
        taskId: cleanTaskId || null,
        subtaskId: subtaskId || null,
        sheetRow: resolvedSheetRow,
        client: targetRow.client || 'General',
        taskName: targetRow.task || 'Task',
        timeIn: resolvedTimeIn || targetRow.timeIn || null,
        timeOut: effectiveTimeOut,
        isUpwork: (targetRow.timeTracker || '').toLowerCase() === 'upwork',
        timeTracker: targetRow.timeTracker || null,
        status: targetRow.taskStatus || (mode === 'STOP' ? 'Completed' : 'In Progress'),
        taskDeliverables: normalizedTargetDeliverables || null,
        taskUpdateAndDeliverables: targetRow.taskUpdateAndDeliverables || null,
        taskLink: targetRow.taskLink || (cleanTaskId ? `https://nexus.vipscaleph.com/task/${cleanTaskId}` : null),
        source: source || (cleanTaskId ? 'NEXUS_BOARD' : 'NEXUS_DAILY_TRACKER'),
      }).catch((err) => {
        logger.warn({ err }, 'Failed to upsert DailySheetLog from syncSpreadsheetRowHandler');
        return null;
      });
      if (!resolvedSheetRow && savedLog?.sheetRow) {
        resolvedSheetRow = Number(savedLog.sheetRow);
      }
      if (savedLog) {
        io.emit('daily_sheet_log:updated', { log: savedLog });
      }
      await invalidateCache('task_map:*').catch(() => {});
    }

    if (mode === 'STOP') {
      const effectiveTargetId = subtaskId ? `subtask:${subtaskId}` : (cleanTaskId || null);
      const maSessionKey = actorDisplayName.trim().toLowerCase();
      await deleteMaActiveSession(maSessionKey).catch(() => {});
      if (cleanTaskId) {
        await clearMaSessionsForTarget(cleanTaskId, subtaskId || null).catch(() => {});
      }
      const clearedPayload = {
        maName: actorDisplayName,
        cleared: true,
        active: false,
        taskId: effectiveTargetId,
        subtaskId: subtaskId || null,
        timeOut: effectiveTimeOut,
      };
      const stoppedProgressPayload = {
        maName: actorDisplayName,
        timeIn: resolvedTimeIn || targetRow?.timeIn || null,
        timeOut: effectiveTimeOut,
        isLive: false,
        isMissingTime: false,
        date: targetRow?.date || getManilaDateStr(),
        client: targetRow?.client || 'General',
        sheetRow: resolvedSheetRow || undefined,
      };
      io.emit('ma:session_updated', clearedPayload);
      io.emit('task_map:ma_progress_changed', clearedPayload);
      io.emit('task_map:updated', {
        maSession: clearedPayload,
        ...(effectiveTargetId ? { taskId: effectiveTargetId, progress: stoppedProgressPayload } : {}),
      });
      if (effectiveTargetId) {
        io.emit('task:progress_updated', {
          taskId: effectiveTargetId,
          progress: stoppedProgressPayload,
        });
      }
    }

    // Forward to n8n webhook to update the user's personal Google Spreadsheet (with STOP deduplication)
    if (targetRow) {
      let skipDuplicateWebhook = false;
      if (mode === 'STOP') {
        const dedupeTarget = subtaskId ? `subtask:${subtaskId}` : (cleanTaskId || 'none');
        const dedupeKey = `${getManilaDateStr()}::${actorDisplayName.trim().toLowerCase()}::${dedupeTarget}`;
        if (isRedisReady()) {
          const acquired = await redis.set(`task_map:stop_dedupe:${dedupeKey}`, '1', 'EX', 30, 'NX').catch(() => 'OK');
          if (!acquired) skipDuplicateWebhook = true;
        } else {
          const prevTs = recentSpreadsheetStopDedupe.get(dedupeKey);
          const nowTs = Date.now();
          if (prevTs && nowTs - prevTs < 30000) {
            skipDuplicateWebhook = true;
          } else {
            recentSpreadsheetStopDedupe.set(dedupeKey, nowTs);
          }
        }
      }

      if (!skipDuplicateWebhook) {
        const webhookPayload = {
          userId: user?.id,
          userName: actorDisplayName,
          userEmail: actorUser?.email,
          dailySheetUrl: actorUser?.dailySheetUrl,
          dailySheetLogId: savedLog?.id || null,
          taskId: cleanTaskId || null,
          subtaskId: subtaskId || null,
          sheetRow: resolvedSheetRow,
          taskTitle: targetRow.task || 'Task',
          clientName: targetRow.client || 'General',
          taskLink: targetRow.taskLink || (cleanTaskId ? `https://nexus.vipscaleph.com/task/${cleanTaskId}` : null),
          status: targetRow.taskStatus || mode,
          date: targetRow.date,
          timeIn: resolvedTimeIn || targetRow.timeIn,
          timeOut: effectiveTimeOut,
          timeTracker: targetRow.timeTracker || null,
          taskDeliverablesDescription: normalizedTargetDeliverables,
          taskUpdateAndDeliverables: targetRow.taskUpdateAndDeliverables ? String(targetRow.taskUpdateAndDeliverables).trim() : '',
          description: normalizedTargetDeliverables || targetRow.task,
          mode: mode || 'UPDATE',
        };
        if (mode === 'STOP') {
          await triggerN8nStartTaskWebhook(webhookPayload);
        } else {
          void triggerN8nStartTaskWebhook(webhookPayload);
        }

        // Also post the submitted deliverables/update directly to the Nexus task's Activity/Comments
        // because Google Sheets API writes from n8n do not fire Apps Script onEdit triggers.
        if (cleanTaskId && mode === 'STOP') {
          const deliverableMsg = [
            targetRow.taskDeliverablesDescription,
            targetRow.taskUpdateAndDeliverables,
          ]
            .map((s: any) => String(s || '').trim())
            .filter(Boolean)
            .join('\n\n');

          const commentAuthorId = actorUser?.id || user?.id;
          if (deliverableMsg && commentAuthorId) {
            try {
              const now = new Date();
              const manilaParts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Manila',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              }).formatToParts(now);
              const mp = (type: string) => manilaParts.find((x) => x.type === type)?.value ?? '';
              const editedStr = `${mp('month')} ${mp('day')}, ${mp('year')} ${mp('hour')}:${mp('minute')} ${mp('dayPeriod')}`;
              const timeRangeStr =
                targetRow.timeIn && effectiveTimeOut
                  ? `${targetRow.timeIn} - ${effectiveTimeOut}`
                  : effectiveTimeOut || targetRow.timeIn || `${mp('hour')}:${mp('minute')} ${mp('dayPeriod')}`;
              const dateLabel = targetRow.date
                ? new Intl.DateTimeFormat('en-US', {
                    timeZone: 'Asia/Manila',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  }).format(new Date(targetRow.date))
                : `${mp('month')} ${mp('day')}, ${mp('year')}`;
              const formattedContent = plainTextToCommentHtml(
                `👤 ${actorDisplayName} | 📅  ${dateLabel}, ${timeRangeStr} | ✏️ ${editedStr}\n\n${deliverableMsg}`
              );

              const targetSubtaskId = subtaskId ? String(subtaskId) : null;
              const recentDup = await prisma.taskComment.findFirst({
                where: {
                  taskId: cleanTaskId,
                  subtaskId: targetSubtaskId,
                  userId: commentAuthorId,
                  createdAt: { gte: new Date(Date.now() - 30_000) },
                },
                select: { id: true },
              });

              if (!recentDup) {
                const taskRec = await prisma.task.findUnique({
                  where: { id: cleanTaskId },
                  select: { id: true, listId: true },
                });
                if (taskRec) {
                  const createdComment = await prisma.taskComment.create({
                    data: {
                      content: formattedContent,
                      taskId: cleanTaskId,
                      userId: commentAuthorId,
                      ...(targetSubtaskId ? { subtaskId: targetSubtaskId } : {}),
                    },
                    include: {
                      user: { select: { id: true, name: true, avatarUrl: true, email: true } },
                      subtask: { select: { id: true, title: true } },
                    },
                  });

                  const auditLog = await prisma.auditLog.create({
                    data: {
                      action: 'COMMENT',
                      entity: 'TASK',
                      entityId: cleanTaskId,
                      userId: commentAuthorId,
                      details: {
                        text: formattedContent,
                        commentId: createdComment.id,
                        subtaskId: targetSubtaskId,
                        source: 'NEXUS_CLOCK_OUT',
                      },
                    },
                  });

                  await redis
                    .del(
                      `comments:list:${cleanTaskId}`,
                      ...(targetSubtaskId ? [`comments:list:${cleanTaskId}:sub:${targetSubtaskId}`] : [])
                    )
                    .catch(() => {});
                  await invalidateCache(`task:activities:${cleanTaskId}`).catch(() => {});

                  const commentPayload = {
                    ...createdComment,
                    reactions: [],
                    replies: [],
                  };
                  const activityPayload = {
                    id: auditLog.id,
                    commentId: createdComment.id,
                    type: 'comment',
                    author: createdComment.user?.name || actorDisplayName,
                    text: formattedContent,
                    date: auditLog.createdAt,
                    user: createdComment.user,
                    parentCommentId: null,
                    subtaskId: targetSubtaskId,
                  };

                  io.emit('task:comment_added', {
                    taskId: cleanTaskId,
                    comment: commentPayload,
                    activity: activityPayload,
                    subtaskId: targetSubtaskId || undefined,
                  });
                  io.emit('task_activity', {
                    listId: taskRec.listId,
                    taskId: cleanTaskId,
                    activity: activityPayload,
                  });
                }
              }
            } catch (commentErr) {
              logger.warn({ err: commentErr }, 'Failed to post clock-out deliverables comment to Nexus task');
            }
          }
        }
      }
    }

    return res.json({
      success: true,
      rows: rows || [],
      log: savedLog,
      isSplitAcrossMidnight: Boolean(isSplitAcrossMidnight),
    });
  } catch (err: any) {
    logger.error({ err }, 'Error in syncSpreadsheetRowHandler');
    return res.status(500).json({ error: err.message });
  }
};

export const getDailySheetLogsHandler = async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || getManilaDateStr();
    const maName = (req.query.maName as string) || undefined;
    const search = (req.query.search as string) || undefined;

    const logs = await getDailySheetLogsForDate(date, { maName, search });
    return res.json({
      success: true,
      date: date.trim().split('T')[0],
      logs,
    });
  } catch (err: any) {
    logger.error({ err }, 'Error in getDailySheetLogsHandler');
    return res.status(500).json({ error: err.message });
  }
};

export const createDailySheetLogHandler = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const {
      date,
      maName,
      taskId,
      subtaskId,
      sheetRow,
      client,
      taskName,
      timeIn,
      timeOut,
      isMissingTime,
      isUpwork,
      timeTracker,
      status,
      taskDeliverables,
      taskUpdateAndDeliverables,
      taskLink,
    } = req.body;

    const effectiveMaName = (maName || user?.name || user?.email || '').trim();
    if (!effectiveMaName) {
      return res.status(400).json({ error: 'maName is required' });
    }

    const log = await upsertDailySheetLog({
      date: date || getManilaDateStr(),
      maName: effectiveMaName,
      userId: user?.id || null,
      taskId: taskId || null,
      subtaskId: subtaskId || null,
      sheetRow: sheetRow ? Number(sheetRow) : null,
      client: client || null,
      taskName: taskName || null,
      timeIn: timeIn || null,
      timeOut: timeOut || null,
      isMissingTime: Boolean(isMissingTime),
      isUpwork: Boolean(isUpwork),
      timeTracker: timeTracker || null,
      status: status || null,
      taskDeliverables: taskDeliverables || null,
      taskUpdateAndDeliverables: taskUpdateAndDeliverables || null,
      taskLink: taskLink || null,
      source: 'NEXUS_SHEETS',
    });

    if (log) {
      io.emit('daily_sheet_log:updated', { log });
    }
    await invalidateCache('task_map:*').catch(() => {});

    return res.json({ success: true, log });
  } catch (err: any) {
    logger.error({ err }, 'Error in createDailySheetLogHandler');
    return res.status(500).json({ error: err.message });
  }
};

export const getUserDailyScheduleConfigHandler = async (req: Request, res: Response) => {
  try {
    const requestedUserId = (req.query.userId as string) || (req as any).user?.id;
    if (!requestedUserId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const user = await prisma.user.findUnique({
      where: { id: requestedUserId },
      select: { id: true, name: true, email: true, dailySheetUrl: true, notificationPreferences: true },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const match = user.dailySheetUrl?.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const prefs = (user.notificationPreferences as any) || {};
    return res.json({
      success: true,
      userId: user.id,
      userName: user.name,
      dailySheetUrl: user.dailySheetUrl || null,
      dailySheetScriptUrl: prefs.dailySheetScriptUrl || (user as any).dailySheetScriptUrl || null,
      spreadsheetId: match ? match[1] : null,
    });
  } catch (err: any) {
    logger.error({ err }, 'Error in getUserDailyScheduleConfigHandler');
    return res.status(500).json({ error: err.message });
  }
};

export const updateUserDailyScheduleConfigHandler = async (req: Request, res: Response) => {
  try {
    const userId = (req.body.userId as string) || (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized or userId missing' });
    }
    const { dailySheetUrl, dailySheetScriptUrl } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, notificationPreferences: true, dailySheetUrl: true },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentPrefs = (user.notificationPreferences as any) || {};
    const updatedPrefs = {
      ...currentPrefs,
      ...(dailySheetScriptUrl !== undefined ? { dailySheetScriptUrl: dailySheetScriptUrl ? String(dailySheetScriptUrl).trim() : null } : {}),
    };

    const updateData: any = {
      notificationPreferences: updatedPrefs,
    };
    if (dailySheetUrl !== undefined) {
      updateData.dailySheetUrl = dailySheetUrl ? String(dailySheetUrl).trim() : null;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, name: true, email: true, dailySheetUrl: true, notificationPreferences: true },
    });

    const match = updated.dailySheetUrl?.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return res.json({
      success: true,
      userId: updated.id,
      userName: updated.name,
      dailySheetUrl: updated.dailySheetUrl || null,
      dailySheetScriptUrl: (updated.notificationPreferences as any)?.dailySheetScriptUrl || null,
      spreadsheetId: match ? match[1] : null,
    });
  } catch (err: any) {
    logger.error({ err }, 'Error in updateUserDailyScheduleConfigHandler');
    return res.status(500).json({ error: err.message });
  }
};

export const triggerSheetFilterHandler = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { filter, scriptUrl } = req.body;
    if (!filter || !['today', 'week', 'month', 'all'].includes(String(filter).toLowerCase())) {
      return res.status(400).json({ error: 'Valid filter ("today", "week", "month", "all") is required' });
    }

    let targetScriptUrl = scriptUrl;
    if (!targetScriptUrl && user?.id) {
      const u = await prisma.user.findUnique({
        where: { id: user.id },
        select: { notificationPreferences: true },
      });
      targetScriptUrl = (u?.notificationPreferences as any)?.dailySheetScriptUrl;
    }

    if (!targetScriptUrl) {
      return res.status(400).json({
        error: 'No Apps Script Web App URL found. Please connect your Apps Script Web App URL first.',
      });
    }

    // Call the deployed Google Apps Script Web App directly from the server (35s timeout for cold starts)
    const targetUrl = new URL(targetScriptUrl);
    targetUrl.searchParams.set('filter', String(filter).toLowerCase());
    targetUrl.searchParams.set('_t', String(Date.now()));

    const fetchRes = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(35000),
      redirect: 'follow',
    });

    const text = await fetchRes.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    if (parsed?.raw) {
      if (
        parsed.raw.includes('doGet') ||
        parsed.raw.includes('function: doGet') ||
        parsed.raw.includes('Script function not found') ||
        parsed.raw.includes('Hindi mahanap ang script function')
      ) {
        return res.status(502).json({
          success: false,
          error:
            'Your Google Apps Script Web App deployment does not have the latest code with doGet. Please open Extensions > Apps Script in your sheet, paste the updated appscript.js, and under Deploy > Manage deployments, select "New version" and click Deploy.',
          details: parsed,
        });
      }
    }

    if (!fetchRes.ok || (parsed && parsed.ok === false)) {
      return res.status(fetchRes.status >= 400 ? fetchRes.status : 502).json({
        success: false,
        error: parsed?.error || `Apps Script returned HTTP ${fetchRes.status}`,
        details: parsed,
      });
    }

    return res.json({
      success: true,
      filter,
      result: parsed,
    });
  } catch (err: any) {
    logger.error({ err }, 'Error in triggerSheetFilterHandler');
    return res.status(500).json({ error: err.message });
  }
};

export const getUserDailyScheduleMetadataHandler = async (req: Request, res: Response) => {
  try {
    const requestedUserId = (req.query.userId as string) || (req as any).user?.id;
    if (!requestedUserId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const user = await prisma.user.findUnique({
      where: { id: requestedUserId },
      select: { id: true, name: true, email: true, dailySheetUrl: true },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.dailySheetUrl) {
      return res.json({
        success: true,
        metadata: null,
      });
    }

    const idMatch = user.dailySheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch?.[1]) {
      return res.json({
        success: true,
        metadata: null,
      });
    }
    const spreadsheetId = idMatch[1];
    const gidMatch = user.dailySheetUrl.match(/[?#&]gid=(\d+)/);
    const gid = gidMatch?.[1] || '0';

    // Current Manila date & intervals
    let todayKey = '';
    try {
      todayKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      todayKey = new Date().toISOString().split('T')[0];
    }

    const todayDate = new Date(`${todayKey}T12:00:00+08:00`);
    const dayOfWeek = todayDate.getDay();
    const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const mondayDate = new Date(todayDate);
    mondayDate.setDate(todayDate.getDate() + diffToMon);
    const weekStartKey = mondayDate.toISOString().split('T')[0];
    const monthStartKey = `${todayKey.slice(0, 7)}-01`;

    let metadata: any = null;

    // 1. Attempt GViz fetch
    const candidateUrls = [
      ...(gid && gid !== '0' ? [`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&gid=${gid}`] : []),
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=2025`,
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json`,
    ];

    for (const url of candidateUrls) {
      try {
        const fetchRes = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!fetchRes.ok) continue;
        const txt = await fetchRes.text();
        if (!txt || !txt.includes('setResponse(')) continue;
        const jsonStr = txt.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, '');
        const parsed = JSON.parse(jsonStr);
        if (parsed?.status === 'error' || !Array.isArray(parsed?.table?.rows)) continue;

        const rows = parsed.table.rows;
        let lastDateKey: string | null = null;
        const parsedRows: Array<{
          rowNum: number;
          dateKey: string;
          timeIn?: string | null;
          timeOut?: string | null;
          client?: string | null;
          task?: string | null;
          isLive: boolean;
        }> = [];

        rows.forEach((r: any, idx: number) => {
          const rowNum = idx + 2;
          const cell0 = r?.c?.[0];
          let dateKey: string | null = null;
          if (cell0) {
            const v = String(cell0.v || '');
            const m = v.match(/Date\((\d+),(\d+),(\d+)\)/);
            if (m) {
              const y = parseInt(m[1], 10);
              const mo = parseInt(m[2], 10) + 1;
              const d = parseInt(m[3], 10);
              dateKey = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            } else if (cell0.f) {
              const dt = new Date(cell0.f);
              if (!isNaN(dt.getTime())) {
                dateKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
              }
            }
          }
          if (dateKey) lastDateKey = dateKey;

          const timeIn = r?.c?.[1]?.f || r?.c?.[1]?.v;
          const timeOut = r?.c?.[2]?.f || r?.c?.[2]?.v;
          const client = r?.c?.[6]?.f || r?.c?.[6]?.v;
          const task = r?.c?.[8]?.f || r?.c?.[8]?.v;

          if (lastDateKey && (timeIn || timeOut || client || task || dateKey)) {
            parsedRows.push({
              rowNum,
              dateKey: lastDateKey,
              timeIn: timeIn ? String(timeIn).trim() : null,
              timeOut: timeOut ? String(timeOut).trim() : null,
              client: client ? String(client).trim() : null,
              task: task ? String(task).trim() : null,
              isLive: Boolean(timeIn && !timeOut),
            });
          }
        });

        const todayRows = parsedRows.filter((p) => p.dateKey === todayKey);
        const weekRows = parsedRows.filter((p) => p.dateKey >= weekStartKey && p.dateKey <= todayKey);
        const monthRows = parsedRows.filter((p) => p.dateKey >= monthStartKey && p.dateKey <= todayKey);

        const currentTask = todayRows.find((p) => p.isLive) || todayRows[todayRows.length - 1] || null;

        metadata = {
          spreadsheetId,
          gid,
          todayKey,
          weekStartKey,
          monthStartKey,
          currentTaskRow: currentTask?.rowNum || (todayRows[0]?.rowNum ?? (parsedRows[parsedRows.length - 1]?.rowNum ? parsedRows[parsedRows.length - 1].rowNum + 1 : 1)),
          currentTask: currentTask
            ? {
                row: currentTask.rowNum,
                date: currentTask.dateKey,
                timeIn: currentTask.timeIn,
                timeOut: currentTask.timeOut,
                client: currentTask.client,
                task: currentTask.task,
                isLive: currentTask.isLive,
              }
            : null,
          todayRange: todayRows.length > 0 ? { startRow: todayRows[0].rowNum, endRow: todayRows[todayRows.length - 1].rowNum } : null,
          weekRange: weekRows.length > 0 ? { startRow: weekRows[0].rowNum, endRow: weekRows[weekRows.length - 1].rowNum } : null,
          monthRange: monthRows.length > 0 ? { startRow: monthRows[0].rowNum, endRow: monthRows[monthRows.length - 1].rowNum } : null,
          totalRows: parsedRows.length,
          source: 'GOOGLE_SHEET_GVIZ',
        };
        break;
      } catch {
        // Continue to fallback
      }
    }

    // 2. Fallback to DailySheetLog if GViz was not reachable
    if (!metadata) {
      const maKey = (user.name || user.email || '').toLowerCase().trim();
      const dbLogs = await prisma.dailySheetLog.findMany({
        where: {
          OR: [
            { userId: user.id },
            ...(maKey ? [{ maKey }] : []),
          ],
          dateKey: { gte: monthStartKey },
        },
        orderBy: { dateKey: 'desc' },
      });

      const todayLogs = dbLogs.filter((l) => l.dateKey === todayKey);
      const weekLogs = dbLogs.filter((l) => l.dateKey >= weekStartKey && l.dateKey <= todayKey);
      const monthLogs = dbLogs;

      const liveLog = todayLogs.find((l) => l.isLive && l.sheetRow) || todayLogs.find((l) => l.sheetRow) || null;
      const currentTaskRow = liveLog?.sheetRow || 1;

      const todaySheetRows = todayLogs.map((l) => l.sheetRow).filter((r): r is number => Boolean(r && r > 0)).sort((a, b) => a - b);
      const weekSheetRows = weekLogs.map((l) => l.sheetRow).filter((r): r is number => Boolean(r && r > 0)).sort((a, b) => a - b);
      const monthSheetRows = monthLogs.map((l) => l.sheetRow).filter((r): r is number => Boolean(r && r > 0)).sort((a, b) => a - b);

      metadata = {
        spreadsheetId,
        gid,
        todayKey,
        weekStartKey,
        monthStartKey,
        currentTaskRow,
        currentTask: liveLog
          ? {
              row: liveLog.sheetRow,
              date: liveLog.dateKey,
              timeIn: liveLog.timeIn,
              timeOut: liveLog.timeOut,
              client: liveLog.client,
              task: liveLog.taskName,
              isLive: liveLog.isLive,
            }
          : null,
        todayRange: todaySheetRows.length > 0 ? { startRow: todaySheetRows[0], endRow: todaySheetRows[todaySheetRows.length - 1] } : null,
        weekRange: weekSheetRows.length > 0 ? { startRow: weekSheetRows[0], endRow: weekSheetRows[weekSheetRows.length - 1] } : null,
        monthRange: monthSheetRows.length > 0 ? { startRow: monthSheetRows[0], endRow: monthSheetRows[monthSheetRows.length - 1] } : null,
        totalRows: dbLogs.length,
        source: 'DAILY_SHEET_LOG_DB',
      };
    }

    return res.json({
      success: true,
      metadata,
    });
  } catch (err: any) {
    logger.error({ err }, 'Error in getUserDailyScheduleMetadataHandler');
    return res.status(500).json({ error: err.message });
  }
};

const SUPERVISE_TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const SUPERVISE_THREE_HOURS_MS = 3 * 60 * 60 * 1000;

function parseManilaSessionStart(dateKey: string, timeIn: string, now: Date): Date | null {
  const m = String(timeIn || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const period = (m[3] || '').toUpperCase();
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;

  const cleanDate = String(dateKey || '').split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  let start = new Date(`${cleanDate}T${pad(hours)}:${pad(mins)}:00+08:00`);
  if (isNaN(start.getTime())) return null;

  if (start.getTime() - now.getTime() > SUPERVISE_TWO_HOURS_MS) {
    start = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  }
  return start;
}

function computeNextSuperviseReappearAt(dateKey: string, timeIn: string, checkedAt: Date): Date {
  const start = parseManilaSessionStart(dateKey, timeIn, checkedAt);
  if (!start) {
    return new Date(checkedAt.getTime() + SUPERVISE_TWO_HOURS_MS);
  }
  const elapsedMs = Math.max(0, checkedAt.getTime() - start.getTime());
  const nextMilestoneMs =
    elapsedMs < SUPERVISE_TWO_HOURS_MS
      ? SUPERVISE_TWO_HOURS_MS
      : SUPERVISE_TWO_HOURS_MS +
        (Math.floor((elapsedMs - SUPERVISE_TWO_HOURS_MS) / SUPERVISE_THREE_HOURS_MS) + 1) *
          SUPERVISE_THREE_HOURS_MS;
  return new Date(start.getTime() + nextMilestoneMs);
}

export const createSuperviseCheckHandler = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const {
      maName,
      dateKey,
      timeIn,
      taskId,
      taskTitle,
      client,
      note,
    } = req.body || {};

    if (!maName || !timeIn) {
      return res.status(400).json({ error: 'maName and timeIn are required' });
    }

    const effectiveDateKey = String(dateKey || getManilaDateStr()).trim().split('T')[0];
    const maKey = String(maName).trim().toLowerCase();
    const cleanTimeIn = String(timeIn).trim();
    const cleanTaskId = taskId ? String(taskId).trim() : null;
    const sessionKey = `${effectiveDateKey}::${maKey}::${cleanTimeIn}::${cleanTaskId || 'none'}`;

    const checkedAt = new Date();
    const reappearAt = computeNextSuperviseReappearAt(effectiveDateKey, cleanTimeIn, checkedAt);

    const check = await (prisma as any).superviseCheck.upsert({
      where: { sessionKey },
      update: {
        maKey,
        maName: String(maName).trim(),
        dateKey: effectiveDateKey,
        timeIn: cleanTimeIn,
        taskId: cleanTaskId,
        taskTitle: taskTitle ? String(taskTitle).trim() : null,
        client: client ? String(client).trim() : null,
        note: note ? String(note).trim() : null,
        checkedById: user?.id || null,
        checkedByName: user?.name || user?.email || 'Supervisor',
        checkedAt,
        reappearAt,
      },
      create: {
        sessionKey,
        maKey,
        maName: String(maName).trim(),
        dateKey: effectiveDateKey,
        timeIn: cleanTimeIn,
        taskId: cleanTaskId,
        taskTitle: taskTitle ? String(taskTitle).trim() : null,
        client: client ? String(client).trim() : null,
        note: note ? String(note).trim() : null,
        checkedById: user?.id || null,
        checkedByName: user?.name || user?.email || 'Supervisor',
        checkedAt,
        reappearAt,
      },
    });

    io.emit('supervise:updated', { action: 'check', check });
    await invalidateCache('task_map:*').catch(() => {});

    return res.json({ success: true, check });
  } catch (err: any) {
    logger.error({ err }, 'Error in createSuperviseCheckHandler');
    return res.status(500).json({ error: err.message });
  }
};

export const deleteSuperviseCheckHandler = async (req: Request, res: Response) => {
  try {
    const { sessionKey } = req.body || {};
    if (!sessionKey) {
      return res.status(400).json({ error: 'sessionKey is required' });
    }

    await (prisma as any).superviseCheck.deleteMany({
      where: { sessionKey: String(sessionKey) },
    });

    io.emit('supervise:updated', { action: 'uncheck', sessionKey: String(sessionKey) });
    await invalidateCache('task_map:*').catch(() => {});

    return res.json({ success: true, sessionKey: String(sessionKey) });
  } catch (err: any) {
    logger.error({ err }, 'Error in deleteSuperviseCheckHandler');
    return res.status(500).json({ error: err.message });
  }
};

export const getUserSheetActivityHandler = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const activity = await checkMaSheetActivityStatus(userId);
    return res.json({ success: true, ...activity });
  } catch (err: any) {
    logger.error({ err }, 'Error checking MA sheet activity');
    return res.status(500).json({ error: err.message || 'Failed to check MA sheet activity' });
  }
};



