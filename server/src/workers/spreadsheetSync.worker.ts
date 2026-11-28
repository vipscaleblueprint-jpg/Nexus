import { Worker, Job } from 'bullmq';
import { redis as bullmqRedis } from '../config/redis';
import { redis as appRedis, isRedisReady } from '../services/redisService';
import { prisma } from '../config/prisma';
import { logger, errMsg } from '../config/logger';
import { getManilaDateStr } from '../services/taskMapService';
import {
  SPREADSHEET_SYNC_JOB,
  SpreadsheetSyncJobPayload,
  spreadsheetSyncQueue,
} from '../queues/spreadsheetSync.queue';

export type { SpreadsheetSyncJobPayload };

const DEFAULT_N8N_WEBHOOK_URL = 'https://n8n.heysnaply.com/webhook/nexus-auto-input-schedule';
const DEFAULT_FALLBACK_SPREADSHEET_ID = '1Ydt21Yi-3F1IV5N4AfMSC-Q7uNFjRO3x376qgVCzMwk';

// Rate limit: stays safely under Google Sheets API's shared 60 req/min/user OAuth quota
// even when each webhook performs 1-2 sheet operations.
const MAX_JOBS_PER_MINUTE = Math.max(
  5,
  parseInt(process.env.N8N_SHEET_SYNC_MAX_PER_MIN || '25', 10) || 25
);
const WORKER_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.N8N_SHEET_SYNC_CONCURRENCY || '3', 10) || 3
);
const WEBHOOK_TIMEOUT_MS = Math.max(
  10000,
  parseInt(process.env.N8N_SHEET_SYNC_TIMEOUT_MS || '25000', 10) || 25000
);

function extractSpreadsheetId(dailySheetUrl?: string | null): string {
  const raw = String(dailySheetUrl || '').trim();
  if (!raw) return DEFAULT_FALLBACK_SPREADSHEET_ID;
  const match = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || raw;
}

function buildRowCacheKey(dateKey: string, userName: string, taskId?: string | null, subtaskId?: string | null): string | null {
  const maKey = (userName || '').trim().toLowerCase();
  const targetKey = subtaskId ? `subtask:${subtaskId}` : (taskId || '');
  if (!maKey || !targetKey) return null;
  return `sheet_sync:row:${dateKey}:${maKey}:${targetKey}`;
}

function parseN8nSyncResponse(parsed: any): {
  ok: boolean;
  rowNumber: number | null;
  sheetName: string | null;
  errorMessage: string | null;
} {
  const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  if (items.length === 0) {
    return { ok: true, rowNumber: null, sheetName: null, errorMessage: null };
  }

  const failedItem = items.find((item) => item && item.ok === false);
  if (failedItem) {
    return {
      ok: false,
      rowNumber: null,
      sheetName: failedItem.sheetName ? String(failedItem.sheetName).trim() : null,
      errorMessage: String(failedItem.error || 'n8n reported ok:false'),
    };
  }

  // Pick the primary written row (prefer part 1 if midnight split, otherwise first item with a valid row number)
  let rowNumber: number | null = null;
  let sheetName: string | null = null;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (!sheetName && item.sheetName) {
      sheetName = String(item.sheetName).trim();
    }
    const candidate = Number(item.targetRowNumber ?? item.row_number ?? item.sheetRow ?? 0);
    if (Number.isFinite(candidate) && candidate > 1) {
      if (rowNumber === null || item.midnightSplitPart === 1) {
        rowNumber = candidate;
      }
    }
  }

  return { ok: true, rowNumber, sheetName, errorMessage: null };
}

/**
 * Acquires a per-spreadsheet Redis lock so concurrent jobs targeting the exact same
 * Google Sheet never read the same stale snapshot and overwrite each other's row.
 */
async function acquireSheetLock(spreadsheetId: string, lockToken: string): Promise<boolean> {
  if (!isRedisReady()) return true;
  const lockKey = `sheet_sync:lock:${spreadsheetId}`;
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const acquired = await appRedis.set(lockKey, lockToken, 'EX', 35, 'NX');
      if (acquired === 'OK') return true;
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

async function releaseSheetLock(spreadsheetId: string, lockToken: string): Promise<void> {
  if (!isRedisReady()) return;
  const lockKey = `sheet_sync:lock:${spreadsheetId}`;
  try {
    const current = await appRedis.get(lockKey);
    if (current === lockToken) {
      await appRedis.del(lockKey);
    }
  } catch {
    // Lock will auto-expire via TTL
  }
}

async function resolveCachedSheetName(spreadsheetId: string, explicitSheetName?: string): Promise<string> {
  if (explicitSheetName) return explicitSheetName;
  if (isRedisReady()) {
    try {
      const cached = await appRedis.get(`sheet_sync:tab:${spreadsheetId}`);
      if (cached && cached.trim()) return cached.trim();
    } catch {}
  }
  return process.env.N8N_DEFAULT_SHEET_NAME || '2025';
}

async function cacheResolvedSheetName(spreadsheetId: string, sheetName?: string | null): Promise<void> {
  if (!sheetName || !isRedisReady()) return;
  try {
    await appRedis.set(`sheet_sync:tab:${spreadsheetId}`, sheetName.trim(), 'EX', 7 * 24 * 3600);
  } catch {}
}

/**
 * If a STOP/UPDATE job was enqueued before the START job finished writing back sheetRow,
 * look up the newly persisted sheetRow from Redis or DailySheetLog right before calling n8n.
 */
async function hydrateMissingSheetRowForStop(payload: SpreadsheetSyncJobPayload): Promise<number | null> {
  if (payload.sheetRow && Number(payload.sheetRow) > 1) {
    return Number(payload.sheetRow);
  }
  if (payload.mode === 'START') return null;

  const dateKey = getManilaDateStr();
  const rowCacheKey = buildRowCacheKey(dateKey, payload.userName, payload.taskId, payload.subtaskId);
  if (rowCacheKey && isRedisReady()) {
    try {
      const cachedRow = await appRedis.get(rowCacheKey);
      const parsed = cachedRow ? Number(cachedRow) : 0;
      if (Number.isFinite(parsed) && parsed > 1) return parsed;
    } catch {}
  }

  try {
    if (payload.dailySheetLogId) {
      const byId = await prisma.dailySheetLog.findUnique({
        where: { id: payload.dailySheetLogId },
        select: { sheetRow: true },
      });
      if (byId?.sheetRow && byId.sheetRow > 1) return byId.sheetRow;
    }
    if (payload.taskId) {
      const maKey = (payload.userName || '').trim().toLowerCase();
      const matched = await prisma.dailySheetLog.findFirst({
        where: {
          dateKey,
          taskId: payload.taskId,
          subtaskId: payload.subtaskId || null,
          sheetRow: { gt: 1 },
          ...(payload.userId ? { OR: [{ maKey }, { userId: payload.userId }] } : { maKey }),
        },
        orderBy: { submittedAt: 'desc' },
        select: { sheetRow: true },
      });
      if (matched?.sheetRow && matched.sheetRow > 1) return matched.sheetRow;
    }
  } catch {
    // Non-fatal: n8n will fall back to sheet scan
  }
  return null;
}

/**
 * Persists the row number returned by n8n back to DailySheetLog (and Redis cache)
 * so subsequent STOP/UPDATE calls can target the exact row directly without scanning the sheet.
 */
async function persistWrittenSheetRow(payload: SpreadsheetSyncJobPayload, rowNumber: number): Promise<void> {
  if (!Number.isFinite(rowNumber) || rowNumber <= 1) return;

  const dateKey = getManilaDateStr();
  const rowCacheKey = buildRowCacheKey(dateKey, payload.userName, payload.taskId, payload.subtaskId);
  if (rowCacheKey && isRedisReady()) {
    try {
      await appRedis.set(rowCacheKey, String(rowNumber), 'EX', 18 * 3600);
    } catch {}
  }

  try {
    if (payload.dailySheetLogId) {
      await prisma.dailySheetLog.updateMany({
        where: { id: payload.dailySheetLogId, sheetRow: null },
        data: { sheetRow: rowNumber },
      });
      return;
    }

    if (payload.taskId) {
      const maKey = (payload.userName || '').trim().toLowerCase();
      const unrowed = await prisma.dailySheetLog.findFirst({
        where: {
          dateKey,
          taskId: payload.taskId,
          subtaskId: payload.subtaskId || null,
          sheetRow: null,
          ...(payload.userId ? { OR: [{ maKey }, { userId: payload.userId }] } : { maKey }),
        },
        orderBy: { submittedAt: 'desc' },
        select: { id: true },
      });
      if (unrowed) {
        await prisma.dailySheetLog.update({
          where: { id: unrowed.id },
          data: { sheetRow: rowNumber },
        });
      }
    }
  } catch (err) {
    logger.warn({ err, rowNumber, taskId: payload.taskId }, '[n8n Sync] Failed writing back sheetRow to DailySheetLog');
  }
}

/**
 * Executes a single n8n Google Sheets sync webhook call with per-sheet locking,
 * cached tab resolution, and sheetRow write-back.
 * Throws on transient/HTTP/n8n failures so BullMQ can retry with exponential backoff.
 */
export async function executeN8nSpreadsheetSync(
  params: SpreadsheetSyncJobPayload,
  jobMeta?: { jobId?: string; attempt?: number }
): Promise<{ rowNumber: number | null; sheetName: string | null }> {
  const n8nUrl = process.env.N8N_START_TASK_WEBHOOK || DEFAULT_N8N_WEBHOOK_URL;
  const spreadsheetId = extractSpreadsheetId(params.dailySheetUrl);
  const lockToken = `${jobMeta?.jobId || 'direct'}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  const lockAcquired = await acquireSheetLock(spreadsheetId, lockToken);
  if (!lockAcquired) {
    throw new Error(`Timed out waiting for per-spreadsheet lock (${spreadsheetId}) — retrying via queue`);
  }

  try {
    const resolvedSheetRow = await hydrateMissingSheetRowForStop(params);
    const resolvedSheetName = await resolveCachedSheetName(spreadsheetId, params.sheetName);

    // Strip automation-managed sheet columns (Task Link, Task Status, Was Deliverables Submitted?, IsRecorded?)
    // and internal queue metadata so Nexus never overwrites Google Sheet formulas / Apps Script automations.
    const {
      taskLink: _omitTaskLink,
      status: _omitStatus,
      dailySheetLogId: _omitLogId,
      ...safePayload
    } = params;

    const payload = JSON.stringify({
      ...safePayload,
      sheetRow: resolvedSheetRow ?? safePayload.sheetRow ?? null,
      sheetName: resolvedSheetName,
    });

    const res = await fetch(n8nUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    const bodyText = await res.text().catch(() => '');
    let parsed: any = null;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      parsed = null;
    }

    const result = parseN8nSyncResponse(parsed);

    if (!res.ok || !result.ok) {
      const reason = !res.ok
        ? `HTTP ${res.status}`
        : `n8n ok:false (${result.errorMessage || 'unknown'})`;
      throw new Error(`[n8n Sync] ${reason} for ${params.userName} (mode: ${params.mode || 'START'})`);
    }

    if (result.sheetName) {
      await cacheResolvedSheetName(spreadsheetId, result.sheetName);
    }
    if (result.rowNumber) {
      await persistWrittenSheetRow(params, result.rowNumber);
    }

    logger.info(
      `[n8n Sync] Synced ${params.userName} (mode: ${params.mode || 'START'}, row: ${result.rowNumber ?? resolvedSheetRow ?? 'auto'}, tab: ${result.sheetName || resolvedSheetName}, attempt: ${jobMeta?.attempt ?? 1})`
    );
    return { rowNumber: result.rowNumber, sheetName: result.sheetName };
  } finally {
    await releaseSheetLock(spreadsheetId, lockToken);
  }
}

/**
 * Enqueues a spreadsheet sync job into BullMQ (non-blocking, rate-limited, durable).
 * Falls back to direct execution if Redis is unavailable so functionality is never lost.
 */
export async function enqueueSpreadsheetSync(params: SpreadsheetSyncJobPayload): Promise<void> {
  if (!isRedisReady()) {
    try {
      await executeN8nSpreadsheetSync(params);
    } catch (err) {
      logger.warn(`[n8n Sync] Direct fallback failed for ${params.userName}: ${errMsg(err)}`);
    }
    return;
  }

  try {
    // Preserve strict FIFO ordering so a user's START always executes before a subsequent STOP.
    await spreadsheetSyncQueue.add(SPREADSHEET_SYNC_JOB, params);
  } catch (err) {
    logger.warn(`[n8n Sync] Queue enqueue failed, running direct fallback for ${params.userName}: ${errMsg(err)}`);
    try {
      await executeN8nSpreadsheetSync(params);
    } catch (directErr) {
      logger.warn(`[n8n Sync] Direct fallback also failed for ${params.userName}: ${errMsg(directErr)}`);
    }
  }
}

export const spreadsheetSyncWorker = new Worker<SpreadsheetSyncJobPayload>(
  'SpreadsheetSync',
  async (job: Job<SpreadsheetSyncJobPayload>) => {
    return executeN8nSpreadsheetSync(job.data, {
      jobId: job.id,
      attempt: job.attemptsMade + 1,
    });
  },
  {
    connection: bullmqRedis,
    concurrency: WORKER_CONCURRENCY,
    limiter: {
      max: MAX_JOBS_PER_MINUTE,
      duration: 60_000,
    },
  }
);

spreadsheetSyncWorker.on('failed', (job, err) => {
  const attempts = job ? `${job.attemptsMade}/${job.opts.attempts ?? 5}` : '?';
  logger.error(
    { jobId: job?.id, userName: job?.data?.userName, mode: job?.data?.mode, attempts },
    `[n8n Sync] Job failed: ${errMsg(err)}`
  );
});

spreadsheetSyncWorker.on('error', (err) => {
  logger.error(`[n8n Sync] Worker Redis error: ${errMsg(err)}`);
});
