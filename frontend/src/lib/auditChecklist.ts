/**
 * Nexus's own Audit checklist (Instructions / Design / UI UX / Funnel, shown in the
 * Audit section) vs. a ClickUp checklist that happens to be named "Audit". The two
 * share a name, so the items decide: Nexus's only ever holds the four audit items.
 */
export interface AuditOption {
  id: string;
  label: string;
  role: string | null;
  description: string;
}

export const ALL_AUDIT_OPTIONS: AuditOption[] = [
  { id: 'Instructions Audit', label: 'Instructions Audit', role: null, description: 'Review against task briefing & instructions' },
  { id: 'UI UX Audit', label: 'UI/UX Audit', role: 'UI/UX', description: 'Review user experience & interaction design' },
  { id: 'Design Audit', label: 'Design Audit', role: 'Designer', description: 'Review visual aesthetics, static assets & layouts' },
  { id: 'Production Audit', label: 'Production Audit', role: 'Production', description: 'Review video, motion, audio & production deliverables' },
  { id: 'Funnel Audit', label: 'Funnel Audit', role: 'Funnel/Backend', description: 'Review funnel flow, tracking & backend setup' },
];

export const normalizeAuditName = (name: string) => {
  const clean = (name || '').trim().toLowerCase();
  const replaced = clean.replace(/[\/\-_]/g, ' ').replace(/\s+/g, ' ');
  if (replaced === 'instruction audit') return 'instructions audit';
  if (replaced === 'prod audit') return 'production audit';
  return replaced;
};

const NEXUS_AUDIT_ITEMS = new Set([
  'instructions audit',
  'instruction audit',
  'design audit',
  'production audit',
  'ui ux audit',
  'funnel audit',
]);

export interface ChecklistLike {
  name: string;
  externalId?: string | null;
  items?: { text: string; completed?: boolean; assigneeId?: string[] }[] | null;
  subtaskId?: string | null;
}

export function isNexusAuditItemText(text: string): boolean {
  const raw = (text || '').trim();
  const clean = raw.startsWith('!') ? raw.slice(1).trim() : raw;
  return NEXUS_AUDIT_ITEMS.has(normalizeAuditName(clean));
}

export function isNexusAuditChecklist(c: ChecklistLike): boolean {
  if (!c || !c.name) return false;
  if (c.name.trim().toLowerCase() !== 'audit') return false;
  if (isAiAuditChecklist(c)) return true;
  const items = c.items ?? [];
  // Empty: Nexus's own Audit checklist (even if synced with ClickUp externalId).
  if (items.length === 0) return true;
  return items.every((i) => isNexusAuditItemText(i.text));
}

// Hides Design Audit on older tasks, whose audits still come from the title/role rules below.
// Tasks with saved AI picks (see getAiPickedAudits) show the Design Audit the AI picked.
export const HIDE_DESIGN_AUDIT = false;
// Hides Instructions Audit globally across UI and completion checks.
export const HIDE_INSTRUCTIONS_AUDIT = true;

// Which auditor role (User.roles) audits each item. Mirrors server/src/services/auditAutoAssign.ts.
const AUDIT_ROLE_MATCHERS: Record<string, (role: string) => boolean> = {
  'instructions audit': (r) => r.includes('instruction'),
  'ui ux audit': (r) => /ui\s*\/?\s*ux/.test(r),
  'design audit': (r) => r.includes('design'),
  'production audit': (r) => r.includes('production') || /\bprod\b/.test(r),
  'funnel audit': (r) => r.includes('funnel'),
};

/** Whether someone with these roles holds the auditor role for this audit item (e.g. "UI UX Auditor"). */
export function isAuditorFor(auditText: string, roles: (string | null | undefined)[] | null | undefined): boolean {
  const matches = AUDIT_ROLE_MATCHERS[normalizeAuditName(auditText)];
  if (!matches) return false;
  return (roles || []).some((role) => {
    const r = (role || '').toLowerCase();
    return r.includes('audit') && matches(r);
  });
}

/**
 * Audits the AI picked for a task or subtask (every new one gets them), saved as its Audit
 * checklist with this externalId marker (Nexus-only, never a ClickUp id).
 * Mirrors server/src/utils/auditChecklist.ts.
 */
export const isAiAuditChecklist = (c: ChecklistLike | null | undefined) =>
  !!c?.externalId?.startsWith('ai-audit:');

/**
 * The audits the AI picked for this task (no subtaskId) or this subtask, or null when it has
 * none: an older task, whose audits still come from the title/role rules.
 */
export function getAiPickedAudits(
  checklists: ChecklistLike[] | null | undefined,
  subtaskId?: string | null,
): string[] | null {
  const picked = (checklists ?? []).find(
    (c) => (subtaskId ? c.subtaskId === subtaskId : !c.subtaskId) && isAiAuditChecklist(c) && isNexusAuditChecklist(c)
  );
  if (!picked || !picked.items || picked.items.length === 0) return null;
  return picked.items.map((i) => i.text);
}

/**
 * Every audit a task (or, with subtaskId, a subtask) must pass: its saved AI picks, or on older
 * tasks the title/role rules (Design hidden). Audit items saved on it are added, "!"-excluded
 * ones removed. Mirrors resolveRequiredAudits in server/src/utils/auditChecklist.ts.
 */
export function resolveRequiredAudits(opts: {
  title: string;
  auditorRoles?: string[];
  checklists?: ChecklistLike[] | null;
  subtaskId?: string | null;
}): string[] {
  const items = (opts.checklists ?? [])
    .filter((c) => (opts.subtaskId ? c.subtaskId === opts.subtaskId : !c.subtaskId) && isNexusAuditChecklist(c))
    .flatMap((c) => c.items ?? []);
  const excluded = new Set(
    items
      .filter((i) => (i.text || '').startsWith('!'))
      .map((i) => normalizeAuditName((i.text || '').replace(/^!\s*/, '')))
  );
  const picked = getAiPickedAudits(opts.checklists, opts.subtaskId);
  const hideDesign = hidesDesignAudit(picked);

  const seen = new Set<string>();
  return [
    ...(picked ? [] : getRequiredAudits(opts.title, opts.auditorRoles)),
    ...items.map((i) => i.text),
  ].filter((text) => {
    const n = normalizeAuditName(text);
    if (!text || text.startsWith('!') || excluded.has(n) || seen.has(n)) return false;
    if (hideDesign && n === 'design audit') return false;
    if (HIDE_INSTRUCTIONS_AUDIT && n === 'instructions audit') return false;
    seen.add(n);
    return true;
  });
}

/** Design Audit stays hidden only on older tasks (no AI pick); an AI pick shows it. */
export const hidesDesignAudit = (aiPicked: string[] | null) => HIDE_DESIGN_AUDIT && !aiPicked;

export const getRequiredAudits = (taskTitle: string, auditorRoles?: string[]): string[] => {
  const audits = new Set<string>();

  // Every task must pass an Instructions Audit globally (unless hidden)
  if (!HIDE_INSTRUCTIONS_AUDIT) {
    audits.add('Instructions Audit');
  }

  // Title-based checks (requested by user)
  const title = (taskTitle || '').toLowerCase();
  if (!HIDE_DESIGN_AUDIT && title.includes('design')) audits.add('Design Audit');
  if (title.includes('ui/ux') || title.includes('ui ux')) audits.add('UI UX Audit');
  if (taskTitle.startsWith('Do a feasibility') || taskTitle.startsWith('Prepare a report') || title.includes('funnel')) {
    audits.add('Funnel Audit');
  }

  // Same title rules as the server's getRequiredAudits, so every audit it requires is shown here.
  if (/\breel\b|\breels\b|\bvideo\b|\bvideos\b|\bvsl\b|\banimation\b|\bmotion\b|\b3d\b|\bpodcast\b|\bvoiceover\b|\bproduction\b/.test(title)) {
    audits.add('Production Audit');
  }
  if (!HIDE_DESIGN_AUDIT && /graphic|sample/.test(title)) audits.add('Design Audit');
  if (/email|newsletter|social media/.test(title)) {
    if (!HIDE_DESIGN_AUDIT) audits.add('Design Audit');
    audits.add('Funnel Audit');
  }
  if (/website|page|funnel|link/.test(title)) {
    audits.add('UI UX Audit');
    if (!HIDE_DESIGN_AUDIT) audits.add('Design Audit');
    audits.add('Funnel Audit');
  }

  // Whatever auditor role was actually assigned (e.g. via the Galaxy "--Audit - <Role> -" subtask)
  // determines the required audit item directly, regardless of what the task title says.
  (auditorRoles || []).forEach((role) => {
    const r = (role || '').toLowerCase();
    if (r.includes('ui') || r.includes('ux')) audits.add('UI UX Audit');
    if (!HIDE_DESIGN_AUDIT && r.includes('design')) audits.add('Design Audit');
    if (r.includes('production') || /\bprod\b/.test(r)) audits.add('Production Audit');
    if (r.includes('funnel') || r.includes('backend')) audits.add('Funnel Audit');
  });

  // Video editing gets Production Audit, asset creation gets Design Audit: never both.
  if (audits.has('Production Audit')) audits.delete('Design Audit');

  return Array.from(audits);
};

export interface TaskAuditStatus {
  requiredAudits: string[];
  completedCount: number;
  totalCount: number;
  isComplete: boolean;
  hasRequiredAudits: boolean;
  uncheckedAudits: string[];
}

export function getTaskAuditStatus(task: any): TaskAuditStatus {
  if (!task) {
    return {
      requiredAudits: [],
      completedCount: 0,
      totalCount: 0,
      isComplete: true,
      hasRequiredAudits: false,
      uncheckedAudits: [],
    };
  }

  const isSubtask = Boolean(
    task.isSubtask ||
    task.parentTaskId ||
    (task.taskId && task.taskId !== task.id) ||
    task.subtaskId ||
    (typeof task.id === 'string' && task.id.startsWith('subtask:')) ||
    (task.checklists && task.checklists.some((c: any) => c.subtaskId === task.id))
  );

  const effectiveSubtaskId = isSubtask
    ? (task.subtaskId || (typeof task.id === 'string' ? task.id.replace(/^subtask:/, '') : task.id))
    : null;

  const auditChecklists = (task.checklists || []).filter((c: any) => {
    const isAudit = isNexusAuditChecklist(c) || (c.name || '').trim().toLowerCase() === 'audit';
    if (!isAudit) return false;
    if (isSubtask) {
      return !c.subtaskId || c.subtaskId === effectiveSubtaskId || c.subtaskId === task.id;
    }
    return !c.subtaskId;
  });

  const auditorRoles = [
    ...(task.assigneeRoleRestrictions || []),
    ...(task.subtasks || [])
      .filter((s: any) => s.title?.toLowerCase().startsWith('--audit'))
      .flatMap((s: any) => s.assigneeRoleRestrictions || []),
  ];

  const excludedAudits = new Set(
    auditChecklists.flatMap((c: any) => c.items || [])
      .filter((i: any) => (i.text || '').startsWith('!'))
      .map((i: any) => normalizeAuditName((i.text || '').slice(1)))
  );

  const activeAuditItems = auditChecklists.flatMap((c: any) => c.items || [])
    .filter((i: any) => !(i.text || '').startsWith('!'))
    .map((i: any) => i.text);

  // Audits the AI picked replace the role/title rules (saved items and exclusions still apply).
  const aiPickedAudits = getAiPickedAudits(task.checklists, effectiveSubtaskId);
  const hideDesign = hidesDesignAudit(aiPickedAudits);
  const requiredAuditItems = Array.from(
    new Set([
      ...(aiPickedAudits ? [] : getRequiredAudits(task.title || '', auditorRoles)),
      ...activeAuditItems,
    ].filter((text, i, all) => {
      const norm = normalizeAuditName(text);
      if (!text || text.startsWith('!') || excludedAudits.has(norm)) return false;
      if (hideDesign && norm === 'design audit') return false;
      if (HIDE_INSTRUCTIONS_AUDIT && norm === 'instructions audit') return false;
      return all.findIndex(t => normalizeAuditName(t) === norm) === i;
    }))
  );

  const getAuditItem = (text: string) => {
    const norm = normalizeAuditName(text);
    const matches = auditChecklists.flatMap((c: any) => c.items || []).filter((i: any) => normalizeAuditName(i.text) === norm);
    return matches.find((i: any) => i.completed) || matches.find((i: any) => i.assigneeId?.length) || matches[0];
  };

  const uncheckedAudits: string[] = [];
  let completedCount = 0;

  for (const text of requiredAuditItems) {
    const item = getAuditItem(text);
    if (item?.completed) {
      completedCount++;
    } else {
      uncheckedAudits.push(text);
    }
  }

  const totalCount = requiredAuditItems.length;
  const hasRequiredAudits = totalCount > 0;
  const isComplete = totalCount === 0 || completedCount === totalCount;

  return {
    requiredAudits: requiredAuditItems,
    completedCount,
    totalCount,
    isComplete,
    hasRequiredAudits,
    uncheckedAudits,
  };
}

export interface TaskSubtaskStatus {
  totalCount: number;
  closedCount: number;
  openCount: number;
  hasSubtasks: boolean;
  isComplete: boolean;
  openSubtasks: string[];
}

export function getTaskSubtaskStatus(task: any): TaskSubtaskStatus {
  const allSubtasks: any[] = task?.subtasks || [];
  // Exclude internal helper subtasks (e.g. "--Audit - <Role> -") from regular subtask gates
  const subtasks = allSubtasks.filter((s: any) => {
    const title = (s.title || '').trim().toLowerCase();
    return !title.startsWith('--audit');
  });

  const totalCount = subtasks.length;
  if (totalCount === 0) {
    return {
      totalCount: 0,
      closedCount: 0,
      openCount: 0,
      hasSubtasks: false,
      isComplete: true,
      openSubtasks: [],
    };
  }

  const unclosed = subtasks.filter((s: any) => {
    const st = (s.status || '').trim().toLowerCase();
    return st !== 'closed' && st !== 'done' && !s.completed;
  });

  const closedCount = totalCount - unclosed.length;
  const openCount = unclosed.length;

  return {
    totalCount,
    closedCount,
    openCount,
    hasSubtasks: true,
    isComplete: openCount === 0,
    openSubtasks: unclosed.map((s: any) => s.title || 'Untitled Subtask'),
  };
}

// ============================================================================
// Audit Hierarchy Helpers & Validation
// Level 1: UI UX Audit & Design Audit (same hierarchy)
// Level 2: Instruction Audit (cannot be done until Level 1 audits are done)
// Level 3: Funnel Audit (cannot be done until Level 1 and Instruction Audit are done)
// ============================================================================

export const isUiUxAudit = (name: string): boolean => {
  const norm = normalizeAuditName(name);
  return norm === 'ui ux audit' || norm === 'ui/ux audit';
};

export const isDesignAudit = (name: string): boolean => {
  const norm = normalizeAuditName(name);
  return norm === 'design audit';
};

export const isProductionAudit = (name: string): boolean => {
  const norm = normalizeAuditName(name);
  return norm === 'production audit';
};

export const isInstructionAudit = (name: string): boolean => {
  const norm = normalizeAuditName(name);
  return norm === 'instructions audit' || norm === 'instruction audit';
};

export const isFunnelAudit = (name: string): boolean => {
  const norm = normalizeAuditName(name);
  return norm === 'funnel audit';
};

export function resolveTargetTaskOrSubtask(task: any, subtaskId?: string): any {
  if (!task) return task;
  const cleanSubId = subtaskId ? subtaskId.replace(/^subtask:/, '') : undefined;
  if (!cleanSubId || task.id === subtaskId || task.id === cleanSubId || task.subtaskId === cleanSubId) {
    return task;
  }
  const found = (task.subtasks || []).find((s: any) => s.id === cleanSubId);
  if (found) {
    const subChecklists = (found.checklists && found.checklists.length > 0)
      ? found.checklists
      : (task.checklists || []).filter((c: any) => c.subtaskId === cleanSubId);
    return {
      ...found,
      id: cleanSubId,
      subtaskId: cleanSubId,
      isSubtask: true,
      taskId: task.id || found.taskId,
      title: found.title || '',
      assigneeRoleRestrictions: found.assigneeRoleRestrictions || [],
      checklists: subChecklists,
    };
  }
  return {
    id: cleanSubId,
    subtaskId: cleanSubId,
    isSubtask: true,
    taskId: task.id,
    title: '',
    checklists: (task.checklists || []).filter((c: any) => c.subtaskId === cleanSubId),
  };
}

/**
 * Checks if a task requires Level 1 audits (UI UX Audit or Design Audit).
 * If a task has no UI UX or Design audit, MA selecting "To Review" routes directly to Checking status.
 */
export function hasUiUxOrDesignAudit(task: any, subtaskId?: string): boolean {
  if (!task) return false;
  const targetTask = resolveTargetTaskOrSubtask(task, subtaskId);
  const status = getTaskAuditStatus(targetTask);
  return status.requiredAudits.some((a) => isUiUxAudit(a) || isDesignAudit(a) || isProductionAudit(a));
}

/**
 * Checks whether all required Level 1 audits (UI UX Audit, Design Audit, and Production Audit) are complete.
 */
export function areLevel1AuditsComplete(task: any, subtaskId?: string): boolean {
  if (!task) return true;
  const targetTask = resolveTargetTaskOrSubtask(task, subtaskId);
  const status = getTaskAuditStatus(targetTask);
  const requiredLevel1 = status.requiredAudits.filter((a) => isUiUxAudit(a) || isDesignAudit(a) || isProductionAudit(a));
  if (requiredLevel1.length === 0) return true;
  return !status.uncheckedAudits.some((a) => isUiUxAudit(a) || isDesignAudit(a) || isProductionAudit(a));
}

/**
 * Checks whether Instruction Audit is complete.
 */
export function isInstructionAuditComplete(task: any, subtaskId?: string): boolean {
  if (!task) return true;
  const targetTask = resolveTargetTaskOrSubtask(task, subtaskId);
  const status = getTaskAuditStatus(targetTask);
  const requiredInstructions = status.requiredAudits.filter(isInstructionAudit);
  if (requiredInstructions.length === 0) return true;
  return !status.uncheckedAudits.some(isInstructionAudit);
}

export interface AuditPermissionCheck {
  allowed: boolean;
  reason?: string;
  missingPrerequisites: string[];
}

/**
 * Resolves the user ID(s) who completed an audit item matching `matcher` on the target task/subtask.
 */
export function getCompletedAuditActorIds(
  matcher: (name: string) => boolean,
  task: any,
  subtaskId?: string
): { actorIds: string[]; actorName?: string } {
  if (!task) return { actorIds: [] };
  const targetTask = resolveTargetTaskOrSubtask(task, subtaskId);
  const auditChecklists = (targetTask?.checklists || []).filter(
    (c: any) => isNexusAuditChecklist(c) || (c.name || '').trim().toLowerCase() === 'audit'
  );
  const items = auditChecklists.flatMap((c: any) => c.items || []);
  const actorIds = new Set<string>();
  let actorName: string | undefined;

  for (const item of items) {
    if (!item?.completed || (item.text || '').startsWith('!')) continue;
    if (!matcher(item.text || '')) continue;
    if (item.checkedById) actorIds.add(item.checkedById);
    if (item.checkedBy?.id) actorIds.add(item.checkedBy.id);
    if (!actorName && item.checkedBy?.name) actorName = item.checkedBy.name;
    if (!item.checkedById && !item.checkedBy?.id && Array.isArray(item.assigneeId) && item.assigneeId.length === 1) {
      actorIds.add(item.assigneeId[0]);
    }
  }

  return { actorIds: Array.from(actorIds), actorName };
}

/**
 * Validates whether an audit can be completed based on the hierarchy:
 * - Level 1 (UI UX & Design): Always allowed (same hierarchy).
 * - Level 2 (Instruction): Blocked if task requires Level 1 audits and any are not yet done.
 * - Level 3 (Funnel): Blocked if Level 1 audits or Instruction Audit are not yet done.
 * - Mutual Exclusion: UI UX Auditor and Funnel Auditor on the same task must be different auditors.
 */
export function canPerformAudit(
  auditName: string,
  task: any,
  subtaskId?: string,
  actorUserId?: string | null
): AuditPermissionCheck {
  if (!task) return { allowed: true, missingPrerequisites: [] };

  const norm = normalizeAuditName(auditName);

  // Mutual exclusion: UI UX Audit and Funnel Audit must be performed by different auditors
  if (actorUserId && isUiUxAudit(norm)) {
    const funnelActors = getCompletedAuditActorIds(isFunnelAudit, task, subtaskId);
    if (funnelActors.actorIds.includes(actorUserId)) {
      return {
        allowed: false,
        reason: 'UI/UX Auditor and Funnel Auditor for the same task must be different auditors. Another UI/UX Auditor must perform this audit.',
        missingPrerequisites: ['Different UI/UX Auditor'],
      };
    }
  }

  const targetTask = resolveTargetTaskOrSubtask(task, subtaskId);
  const status = getTaskAuditStatus(targetTask);

  // Design Audit and Production Audit have no hierarchy prerequisites
  if (isDesignAudit(norm) || isProductionAudit(norm)) {
    return { allowed: true, missingPrerequisites: [] };
  }

  // UI/UX Audit cannot be checked if Design Audit is required and unchecked
  if (isUiUxAudit(norm)) {
    const missingDesign = status.uncheckedAudits.filter(isDesignAudit);
    if (missingDesign.length > 0) {
      return {
        allowed: false,
        reason: 'Cannot do UI/UX Audit: Design Audit must be completed first.',
        missingPrerequisites: missingDesign,
      };
    }
    return { allowed: true, missingPrerequisites: [] };
  }

  // Uncompleted Level 1 audits
  const missingLevel1 = status.uncheckedAudits.filter((a) => isUiUxAudit(a) || isDesignAudit(a) || isProductionAudit(a));

  const formatLevel1Label = (a: string) =>
    isUiUxAudit(a) ? 'UI/UX Audit' : isProductionAudit(a) ? 'Production Audit' : 'Design Audit';

  // Level 2: Instruction Audit
  if (isInstructionAudit(norm)) {
    if (missingLevel1.length > 0) {
      const labels = missingLevel1.map(formatLevel1Label).join(' and ');
      return {
        allowed: false,
        reason: `Cannot do Instruction Audit: ${labels} must be completed first.`,
        missingPrerequisites: missingLevel1,
      };
    }
    return { allowed: true, missingPrerequisites: [] };
  }

  // Level 3: Funnel Audit
  if (isFunnelAudit(norm)) {
    if (missingLevel1.length > 0) {
      const labels = missingLevel1.map(formatLevel1Label).join(' and ');
      return {
        allowed: false,
        reason: `Cannot do Funnel Audit: ${labels} must be completed first.`,
        missingPrerequisites: missingLevel1,
      };
    }

    const missingInstruction = status.uncheckedAudits.filter(isInstructionAudit);
    if (missingInstruction.length > 0) {
      return {
        allowed: false,
        reason: 'Cannot do Funnel Audit: Instruction Audit must be completed first.',
        missingPrerequisites: missingInstruction,
      };
    }

    if (actorUserId) {
      const uiUxActors = getCompletedAuditActorIds(isUiUxAudit, task, subtaskId);
      if (uiUxActors.actorIds.includes(actorUserId)) {
        return {
          allowed: false,
          reason: 'UI/UX Auditor and Funnel Auditor for the same task must be different auditors. Another Funnel Auditor must perform the Funnel Audit.',
          missingPrerequisites: ['Different Funnel Auditor'],
        };
      }
    }

    return { allowed: true, missingPrerequisites: [] };
  }

  return { allowed: true, missingPrerequisites: [] };
}


