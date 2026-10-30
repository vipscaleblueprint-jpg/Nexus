/**
 * Nexus's own Audit checklist (Instructions / Design / UI UX / Funnel) vs. a ClickUp
 * checklist that happens to be named "Audit". They share a name, so the items decide:
 * Nexus's only ever holds the four audit items. Mirrors frontend/src/lib/auditChecklist.ts.
 */
export const normalizeAuditName = (name: string) => {
  const clean = (name || '').trim().toLowerCase();
  return clean.replace(/[\/\-_]/g, ' ').replace(/\s+/g, ' ');
};

const NEXUS_AUDIT_ITEMS = new Set([
  'instructions audit',
  'design audit',
  'ui ux audit',
  'funnel audit',
]);

export function isNexusAuditChecklist(c: {
  name: string;
  externalId?: string | null;
  items?: { text: string }[] | null;
}): boolean {
  if (c.name.trim().toLowerCase() !== 'audit') return false;
  const items = c.items ?? [];
  // Empty: Nexus's own Audit checklist (even if synced with ClickUp externalId).
  if (items.length === 0) return true;
  return items.every((i) => {
    const raw = (i.text || '').trim();
    const clean = raw.startsWith('!') ? raw.slice(1).trim() : raw;
    return NEXUS_AUDIT_ITEMS.has(normalizeAuditName(clean));
  });
}

/**
 * Audits the Galaxy AI picked for a task are saved as its Audit checklist, marked by this
 * externalId instead of a ClickUp id. Nexus-only: ClickUp sync skips it, and the ClickUp pull
 * never matches it (it matches ClickUp ids, and never merges an "Audit" checklist by name).
 */
const AI_AUDIT_PREFIX = 'ai-audit:';
export const aiAuditExternalId = (taskId: string) => `${AI_AUDIT_PREFIX}${taskId}`;
export const isAiAuditChecklist = (c: { externalId?: string | null } | null | undefined) =>
  !!c?.externalId?.startsWith(AI_AUDIT_PREFIX);

/** The audits the AI picked for this task, or null when it has none (title rules apply). */
export function getAiPickedAudits(
  checklists: { name: string; externalId?: string | null; subtaskId?: string | null; items?: { text: string }[] | null }[] | null | undefined
): string[] | null {
  const picked = (checklists ?? []).find((c) => !c.subtaskId && isAiAuditChecklist(c) && isNexusAuditChecklist(c));
  return picked ? (picked.items ?? []).map((i) => i.text) : null;
}

/**
 * Status gates. Mirrors frontend/src/lib/permissions.ts.
 * - In Review: auditing happens *during* review, so entering it only needs every subtask Closed
 *   (a task with no subtasks moves straight in).
 * - Completion statuses: need every subtask Closed AND every required audit checked.
 */
export const IN_REVIEW_STATUSES = ['in review', 'inreview', 'in-review', 'review', 'under review', 'for review'];
export const COMPLETION_GATE_STATUSES = ['checking', 'in checking', 'inchecking', 'closed', 'crm', 'done', 'completed'];

const norm = (status: string | null | undefined) =>
  (status || '').trim().toLowerCase().replace(/[\-_]/g, ' ').replace(/\s+/g, ' ');

export function isReviewStatus(status: string | null | undefined): boolean {
  const s = norm(status);
  return IN_REVIEW_STATUSES.includes(s) || s.includes('review');
}

export function isCompletionStatus(status: string | null | undefined): boolean {
  const s = norm(status);
  return COMPLETION_GATE_STATUSES.includes(s);
}

/** Moving to this status requires every non-audit subtask to be Closed. */
export function requiresClosedSubtasks(status: string | null | undefined): boolean {
  return isReviewStatus(status) || isCompletionStatus(status);
}

/** Moving to this status requires every required audit to be checked. */
export function requiresCompletedAudits(status: string | null | undefined): boolean {
  // Review statuses never require completed audits — auditing happens during review
  if (isReviewStatus(status)) return false;
  return isCompletionStatus(status);
}
