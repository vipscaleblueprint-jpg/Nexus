/**
 * Nexus's own Audit checklist (Instructions / Design / UI UX / Funnel) vs. a ClickUp
 * checklist that happens to be named "Audit". They share a name, so the items decide:
 * Nexus's only ever holds the four audit items. Mirrors frontend/src/lib/auditChecklist.ts.
 */
const NEXUS_AUDIT_ITEMS = new Set([
  'instructions audit',
  'design audit',
  'ui ux audit',
  'ui/ux audit',
  'funnel audit',
]);

export function isNexusAuditChecklist(c: {
  name: string;
  externalId?: string | null;
  items?: { text: string }[] | null;
}): boolean {
  if (c.name.trim().toLowerCase() !== 'audit') return false;
  const items = c.items ?? [];
  // Empty: Nexus's own unless it came from ClickUp.
  if (items.length === 0) return !c.externalId;
  return items.every((i) => {
    const raw = (i.text || '').trim().toLowerCase();
    const clean = raw.startsWith('!') ? raw.slice(1).trim() : raw;
    return NEXUS_AUDIT_ITEMS.has(clean);
  });
}

/**
 * Status gates. Mirrors frontend/src/lib/permissions.ts.
 * - In Review: auditing happens *during* review, so entering it only needs every subtask Closed
 *   (a task with no subtasks moves straight in).
 * - Completion statuses: need every subtask Closed AND every required audit checked.
 */
export const IN_REVIEW_STATUSES = ['in review', 'inreview', 'in-review'];
export const COMPLETION_GATE_STATUSES = ['checking', 'closed', 'crm', 'done', 'completed'];

const norm = (status: string | null | undefined) => (status || '').trim().toLowerCase();

/** Moving to this status requires every subtask to be Closed. */
export function requiresClosedSubtasks(status: string | null | undefined): boolean {
  const s = norm(status);
  return IN_REVIEW_STATUSES.includes(s) || COMPLETION_GATE_STATUSES.includes(s);
}

/** Moving to this status requires every required audit to be checked. */
export function requiresCompletedAudits(status: string | null | undefined): boolean {
  return COMPLETION_GATE_STATUSES.includes(norm(status));
}
