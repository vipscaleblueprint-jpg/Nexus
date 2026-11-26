import { prisma } from '../config/prisma';
import { invalidateCache } from './redisService';
import {
  AUDIT_ITEM_ORDER,
  HIDE_INSTRUCTIONS_AUDIT,
  aiAuditExternalId,
  isCompletionStatus,
  isReviewStatus,
} from '../utils/auditChecklist';

/**
 * Lets the AI decide the audits (Instructions / Design / UI UX / Funnel) for every new task and
 * subtask, wherever it was made: Galaxy, the ClickUp/n8n pull, Nexus itself, the external API,
 * recurring copies. The AI lives in VIPScale Tools (POST /api/galaxy-task/audits, the same rules
 * the Galaxy team picker uses). Its pick is saved as the task's Audit checklist, marked as an AI
 * pick (aiAuditExternalId), which then replaces the title/role rules everywhere.
 *
 * Tasks made before this keep the title/role rules: nothing here touches an existing task.
 */

type Target = { taskId: string; subtaskId?: string | null };

const TOOLS_TIMEOUT_MS = 20_000;
/** Space the AI calls out so a large ClickUp import stays under Tools' 120/min limit. */
const GAP_MS = 600;
const MAX_DESCRIPTION_CHARS = 4000;

function getIo() {
  try {
    return require('../server').io;
  } catch {
    return null;
  }
}

function toolsBaseUrl(): string {
  const isDev = process.env.NODE_ENV === 'development';
  return (process.env.TOOLS_VIP_URL || (isDev ? 'http://localhost:3001' : 'https://tools.vipscaleph.com')).replace(/\/+$/, '');
}

const plainText = (html: string | null | undefined) =>
  (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION_CHARS);

/** Keeps only real audit names, in list order. */
export function toAuditItems(picked: unknown): string[] {
  const names = Array.isArray(picked) ? picked.map((p) => String(p).trim().toLowerCase()) : [];
  return AUDIT_ITEM_ORDER.filter(
    (a) => (a === 'Instructions Audit' ? !HIDE_INSTRUCTIONS_AUDIT : names.includes(a.toLowerCase()))
  );
}

/** Audit subtasks ("--Audit Design — …") are audits, not deliverables: they get none of their own. */
const isAuditSubtaskTitle = (title: string) => /^\s*--\s*audit/i.test(title || '');

const DESIGN_ONLY_TITLE = /^\W*(re)?design(ing)?\b|\bmock\s?-?ups?\b/i;
const BUILD_TITLE = /\b(build|develop|implement|migrat|set\s?up|code|coding|integrat|install)/i;

/**
 * Used only when the AI can't answer: the title rules, with Design on, a page that is only being
 * designed going to Design instead of UI UX, and a migration to UI UX without Design.
 */
export function fallbackAudits(title: string): string[] {
  const t = (title || '').toLowerCase();
  const audits = new Set<string>(HIDE_INSTRUCTIONS_AUDIT ? [] : ['Instructions Audit']);
  const designOnly = DESIGN_ONLY_TITLE.test(t) && !BUILD_TITLE.test(t);
  const migration = /\bmigrat/.test(t);

  if (/graphic|reel|video|sample|design|mock\s?-?up|carousel|flyer|banner|logo|thumbnail|pdf|ebook|lead magnet/.test(t)) {
    audits.add('Design Audit');
  }
  if (/email|newsletter|social media/.test(t)) {
    audits.add('Design Audit');
    audits.add('Funnel Audit');
  }
  if (/website|page|funnel|link/.test(t)) {
    if (!designOnly) audits.add('UI UX Audit');
    if (!migration) audits.add('Design Audit');
    audits.add('Funnel Audit');
  }
  if (migration) audits.delete('Design Audit');
  return toAuditItems([...audits]);
}

async function askToolsForAudits(input: {
  title: string;
  description: string;
  parentTitle?: string;
}): Promise<string[] | null> {
  const apiKey = process.env.VIPSCALE_API_KEY?.trim();
  if (!apiKey) return null;
  try {
    const res = await fetch(`${toolsBaseUrl()}/api/galaxy-task/audits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ title: input.title, description: input.description, parent_title: input.parentTitle }),
      signal: AbortSignal.timeout(TOOLS_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[AI Audits] Tools answered ${res.status} for "${input.title}"`);
      return null;
    }
    const data: any = await res.json();
    if (!Array.isArray(data?.audits) || data.audits.length === 0) return null;
    const items = toAuditItems(data.audits);
    return items.length > 0 ? items : null;
  } catch (err) {
    console.warn(`[AI Audits] Could not reach Tools for "${input.title}":`, err);
    return null;
  }
}

/**
 * Saves these audits as the task's (or subtask's) Audit checklist, marked as an AI pick.
 * No-op when it already has one. Returns whether it saved.
 */
export async function saveAuditPicks(target: Target, audits: string[]): Promise<boolean> {
  const items = toAuditItems(audits);
  if (items.length === 0) return false;
  const subtaskId = target.subtaskId || null;
  try {
    const checklist = await prisma.checklist.create({
      data: {
        taskId: target.taskId,
        subtaskId,
        name: 'Audit',
        externalId: aiAuditExternalId(subtaskId || target.taskId),
        items: { create: items.map((text) => ({ text })) },
      },
      include: { items: true },
    });
    getIo()?.emit('task:checklist_created', { taskId: target.taskId, subtaskId, checklist });
    invalidateCache(`task:${target.taskId}`, ...(subtaskId ? [`task:${subtaskId}`] : [])).catch(() => {});
    return true;
  } catch (err: any) {
    // P2002: already saved (the externalId is unique per task/subtask).
    if (err?.code !== 'P2002') console.error('[AI Audits] Failed to save audits:', err);
    return false;
  }
}

/** Asks the AI (title rules when it can't answer) and saves the pick. Skips audit subtasks and closed work. */
export async function pickAndSaveAudits(target: Target): Promise<string[] | null> {
  const subtaskId = target.subtaskId || null;
  const existing = await prisma.checklist.findUnique({
    where: { externalId: aiAuditExternalId(subtaskId || target.taskId) },
    select: { id: true },
  });
  if (existing) return null;

  const task = await prisma.task.findUnique({
    where: { id: target.taskId },
    select: { title: true, description: true, status: true },
  });
  if (!task) return null;

  let title = task.title;
  let description = task.description;
  let status: string | null = task.status;
  let parentTitle: string | undefined;
  if (subtaskId) {
    const subtask = await prisma.subtask.findUnique({
      where: { id: subtaskId },
      select: { title: true, description: true, status: true, completed: true },
    });
    if (!subtask) return null;
    if (subtask.completed) return null;
    title = subtask.title;
    description = subtask.description;
    status = subtask.status;
    parentTitle = task.title;
  }
  if (isAuditSubtaskTitle(title) || isCompletionStatus(status)) return null;

  const aiPick = await askToolsForAudits({ title, description: plainText(description), parentTitle });
  const audits = (aiPick && aiPick.length > 0) ? aiPick : fallbackAudits(title);
  console.log(`[AI Audits] "${title}" -> ${audits.join(', ')}${aiPick && aiPick.length > 0 ? '' : ' (title rules: AI unavailable or empty)'}`);

  if (audits.length === 0) return null;
  const saved = await saveAuditPicks(target, audits);
  // Already in review (e.g. created there): hand the new audit items to this shift's auditors.
  if (saved && !subtaskId && isReviewStatus(status)) {
    const { autoAssignAudits } = require('./auditAutoAssign');
    autoAssignAudits(target.taskId).catch((err: unknown) => console.error('[AI Audits] Audit auto-assign failed:', err));
  }
  return audits;
}

/**
 * A renamed task or subtask may now produce something else (often: created as "New Task", then
 * named). While none of its audits has started (nothing checked or assigned), drop the AI pick and
 * ask again. Tasks without an AI pick (made before it) are left alone.
 */
export async function repickAuditsAfterRename(target: Target): Promise<void> {
  const subtaskId = target.subtaskId || null;
  const checklist = await prisma.checklist.findUnique({
    where: { externalId: aiAuditExternalId(subtaskId || target.taskId) },
    include: { items: { select: { completed: true, assigneeId: true } } },
  });
  if (checklist) {
    if (checklist.items.some((i) => i.completed || i.assigneeId.length > 0)) return;
    await prisma.checklist.delete({ where: { id: checklist.id } });
    getIo()?.emit('task:checklist_deleted', { taskId: target.taskId, subtaskId, checklistId: checklist.id });
  }
  queueAuditPick(target);
}

const queue: Target[] = [];
const queued = new Set<string>();
let draining = false;

const keyOf = (t: Target) => t.subtaskId || t.taskId;

/**
 * Queues the AI audit pick for a task or subtask that was just created. Never throws and never
 * blocks the caller; jobs run one at a time.
 */
export function queueAuditPick(target: Target): void {
  const key = keyOf(target);
  if (!target.taskId || queued.has(key)) return;
  queued.add(key);
  queue.push(target);
  if (!draining) void drain();
}

async function drain() {
  draining = true;
  while (queue.length > 0) {
    const job = queue.shift()!;
    try {
      await pickAndSaveAudits(job);
    } catch (err) {
      console.error('[AI Audits] Pick failed:', err);
    } finally {
      queued.delete(keyOf(job));
    }
    await new Promise((resolve) => setTimeout(resolve, GAP_MS));
  }
  draining = false;
}
