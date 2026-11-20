/**
 * Nexus's own Audit checklist (Instructions / Design / UI UX / Funnel) vs. a ClickUp
 * checklist that happens to be named "Audit". They share a name, so the items decide:
 * Nexus's only ever holds the four audit items. Mirrors frontend/src/lib/auditChecklist.ts.
 */
// Hides Design Audit on older tasks, whose audits still come from the title/role rules below.
// Tasks with saved picks (see getAiPickedAudits) show the Design Audit the AI picked.
export const HIDE_DESIGN_AUDIT = true;

/** The order audit items are listed in. */
export const AUDIT_ITEM_ORDER = ['Instructions Audit', 'Design Audit', 'UI UX Audit', 'Funnel Audit'];

export const normalizeAuditName = (name: string) => {
  const clean = (name || '').trim().toLowerCase();
  const replaced = clean.replace(/[\/\-_]/g, ' ').replace(/\s+/g, ' ');
  if (replaced === 'instruction audit') return 'instructions audit';
  return replaced;
};

export const getRequiredAudits = (taskTitle: string, auditorRoles?: string[]): string[] => {
  const t = (taskTitle || '').toLowerCase();
  const audits = new Set<string>();

  // Every task must pass an Instructions Audit globally
  audits.add('Instructions Audit');

  // Whatever auditor role was actually assigned determines the required audit item directly,
  // regardless of what the task title says.
  (auditorRoles || []).forEach((role) => {
    const r = (role || '').toLowerCase();
    if (r.includes('ui') || r.includes('ux')) audits.add('UI UX Audit');
    if (!HIDE_DESIGN_AUDIT && r.includes('design')) audits.add('Design Audit');
    if (r.includes('funnel') || r.includes('backend')) audits.add('Funnel Audit');
  });

  // 1. Graphics, Reels, Video, Samples -> ONLY Design
  if (!HIDE_DESIGN_AUDIT && t.match(/graphic|reel|video|sample/)) {
    audits.add('Design Audit');
  }

  // 2. Newsletters, Emails, Social Media Packages -> Design + Funnel
  if (t.match(/email|newsletter|social media/)) {
    if (!HIDE_DESIGN_AUDIT) audits.add('Design Audit');
    audits.add('Funnel Audit');
  }

  // 3. Websites, Links, Landing Pages -> ALL THREE
  if (t.match(/website|page|funnel|link/)) {
    audits.add('UI UX Audit');
    if (!HIDE_DESIGN_AUDIT) audits.add('Design Audit');
    audits.add('Funnel Audit');
  }

  return Array.from(audits);
};

const NEXUS_AUDIT_ITEMS = new Set([
  'instructions audit',
  'instruction audit',
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
 * The audits the AI picked for a task or subtask (services/aiAuditPicker.ts) are saved as its
 * Audit checklist, marked by this externalId instead of a ClickUp id. Nexus-only: ClickUp sync
 * skips it, and the ClickUp pull never matches it (it matches ClickUp ids, and never merges an
 * "Audit" checklist by name).
 */
const AI_AUDIT_PREFIX = 'ai-audit:';
/** Pass the subtask's id for a subtask, else the task's. */
export const aiAuditExternalId = (taskOrSubtaskId: string) => `${AI_AUDIT_PREFIX}${taskOrSubtaskId}`;
export const isAiAuditChecklist = (c: { externalId?: string | null } | null | undefined) =>
  !!c?.externalId?.startsWith(AI_AUDIT_PREFIX);

type AuditChecklistLike = {
  name: string;
  externalId?: string | null;
  subtaskId?: string | null;
  items?: { text: string }[] | null;
};

/**
 * The audits the AI picked for this task (no subtaskId) or this subtask, or null when it has
 * none: an older task, whose audits still come from the title/role rules.
 */
export function getAiPickedAudits(
  checklists: AuditChecklistLike[] | null | undefined,
  subtaskId?: string | null,
): string[] | null {
  const picked = (checklists ?? []).find(
    (c) => (subtaskId ? c.subtaskId === subtaskId : !c.subtaskId) && isAiAuditChecklist(c) && isNexusAuditChecklist(c)
  );
  return picked ? (picked.items ?? []).map((i) => i.text) : null;
}

/**
 * Every audit a task (or, with subtaskId, a subtask) must pass: its saved AI picks, or on older
 * tasks the title/role rules (Design hidden). Audit items saved on it are added, "!"-excluded
 * ones removed. Mirrors frontend/src/lib/auditChecklist.ts.
 */
export function resolveRequiredAudits(opts: {
  title: string;
  auditorRoles?: string[];
  checklists?: AuditChecklistLike[] | null;
  subtaskId?: string | null;
}): string[] {
  const items = (opts.checklists ?? [])
    .filter((c) => (opts.subtaskId ? c.subtaskId === opts.subtaskId : !c.subtaskId) && isNexusAuditChecklist(c))
    .flatMap((c) => c.items ?? []);
  const excluded = new Set(
    items.filter((i) => (i.text || '').startsWith('!')).map((i) => normalizeAuditName(i.text.slice(1)))
  );
  const picked = getAiPickedAudits(opts.checklists, opts.subtaskId);
  const hideDesign = HIDE_DESIGN_AUDIT && !picked;

  const seen = new Set<string>();
  return [
    ...(picked ? [] : getRequiredAudits(opts.title, opts.auditorRoles)),
    ...items.map((i) => i.text),
  ].filter((text) => {
    const n = normalizeAuditName(text);
    if (!text || text.startsWith('!') || excluded.has(n) || seen.has(n)) return false;
    if (hideDesign && n === 'design audit') return false;
    seen.add(n);
    return true;
  });
}

/**
 * Status gates. Mirrors frontend/src/lib/permissions.ts.
 * - In Review: involves UI/UX and Design audits. Only needs subtasks Closed.
 * - Checking: involves Instruction and Funnel audits. Needs subtasks Closed AND Level 1 audits (UI UX & Design) completed.
 * - Completion statuses: need every subtask Closed AND all required audits checked.
 */
export const IN_REVIEW_STATUSES = ['in review', 'inreview', 'in-review', 'review', 'under review', 'for review'];
export const CHECKING_STATUSES = ['checking', 'in checking', 'inchecking'];
export const COMPLETION_GATE_STATUSES = ['closed', 'crm', 'done', 'completed'];

const norm = (status: string | null | undefined) =>
  (status || '').trim().toLowerCase().replace(/[\-_]/g, ' ').replace(/\s+/g, ' ');

export function isReviewStatus(status: string | null | undefined): boolean {
  const s = norm(status);
  return IN_REVIEW_STATUSES.includes(s) || s.includes('review');
}

export function isCheckingStatus(status: string | null | undefined): boolean {
  const s = norm(status);
  return CHECKING_STATUSES.includes(s);
}

export function isCompletionStatus(status: string | null | undefined): boolean {
  const s = norm(status);
  return COMPLETION_GATE_STATUSES.includes(s);
}

/** Moving to this status requires every non-audit subtask to be Closed. */
export function requiresClosedSubtasks(status: string | null | undefined): boolean {
  return isReviewStatus(status) || isCheckingStatus(status) || isCompletionStatus(status);
}

/** Moving to this status requires Level 1 audits (UI UX Audit and Design Audit) to be checked if present. */
export function requiresLevel1Audits(status: string | null | undefined): boolean {
  return isCheckingStatus(status);
}

/** Moving to this status requires every required audit to be checked. */
export function requiresCompletedAudits(status: string | null | undefined): boolean {
  // Review & Checking statuses do not require all audits — audits happen during review and checking
  if (isReviewStatus(status) || isCheckingStatus(status)) return false;
  return isCompletionStatus(status);
}
