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
  { id: 'Design Audit', label: 'Design Audit', role: 'Designer', description: 'Review visual aesthetics, assets & layouts' },
  { id: 'Funnel Audit', label: 'Funnel Audit', role: 'Funnel/Backend', description: 'Review funnel flow, tracking & backend setup' },
];

export const normalizeAuditName = (name: string) => {
  const clean = (name || '').trim().toLowerCase();
  const replaced = clean.replace(/[\/\-_]/g, ' ').replace(/\s+/g, ' ');
  if (replaced === 'instruction audit') return 'instructions audit';
  return replaced;
};

const NEXUS_AUDIT_ITEMS = new Set([
  'instructions audit',
  'instruction audit',
  'design audit',
  'ui ux audit',
  'funnel audit',
]);

export interface ChecklistLike {
  name: string;
  externalId?: string | null;
  items?: { text: string; completed?: boolean; assigneeId?: string[] }[] | null;
  subtaskId?: string | null;
}

export function isNexusAuditChecklist(c: ChecklistLike): boolean {
  if (!c || !c.name) return false;
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

// TEMPORARY TOGGLE: Hide Design Audit per user request until process is finalized. Set to false to restore.
export const HIDE_DESIGN_AUDIT = true;

// Which auditor role (User.roles) audits each item. Mirrors server/src/services/auditAutoAssign.ts.
const AUDIT_ROLE_MATCHERS: Record<string, (role: string) => boolean> = {
  'instructions audit': (r) => r.includes('instruction'),
  'ui ux audit': (r) => /ui\s*\/?\s*ux/.test(r),
  'design audit': (r) => r.includes('design'),
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
 * Audits the Galaxy AI picked for a task, saved as its Audit checklist with this externalId
 * marker (Nexus-only, never a ClickUp id). Mirrors server/src/utils/auditChecklist.ts.
 */
export const isAiAuditChecklist = (c: ChecklistLike | null | undefined) =>
  !!c?.externalId?.startsWith('ai-audit:');

/** The audits the AI picked for this task, or null when it has none (title rules apply). */
export function getAiPickedAudits(checklists: ChecklistLike[] | null | undefined): string[] | null {
  const picked = (checklists ?? []).find((c) => !c.subtaskId && isAiAuditChecklist(c) && isNexusAuditChecklist(c));
  return picked ? (picked.items ?? []).map((i) => i.text) : null;
}

export const getRequiredAudits = (taskTitle: string, auditorRoles?: string[]): string[] => {
  const audits = new Set<string>();

  // Every task must pass an Instructions Audit globally
  audits.add('Instructions Audit');

  // Title-based checks (requested by user)
  const title = (taskTitle || '').toLowerCase();
  if (!HIDE_DESIGN_AUDIT && title.includes('design')) audits.add('Design Audit');
  if (title.includes('ui/ux') || title.includes('ui ux')) audits.add('UI UX Audit');
  if (taskTitle.startsWith('Do a feasibility') || taskTitle.startsWith('Prepare a report') || title.includes('funnel')) {
    audits.add('Funnel Audit');
  }

  // Same title rules as the server's getRequiredAudits, so every audit it requires is shown here.
  if (!HIDE_DESIGN_AUDIT && /graphic|reel|video|sample/.test(title)) audits.add('Design Audit');
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
    if (r.includes('funnel') || r.includes('backend')) audits.add('Funnel Audit');
  });

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
    task.parentTaskId ||
    (task.taskId && task.taskId !== task.id) ||
    task.subtaskId ||
    (task.checklists && task.checklists.some((c: any) => c.subtaskId === task.id))
  );

  const auditChecklists = (task.checklists || []).filter((c: any) => {
    if (!isNexusAuditChecklist(c)) return false;
    if (isSubtask) {
      return !c.subtaskId || c.subtaskId === task.id;
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

  // Audits the Galaxy AI picked replace the role/title rules (saved items and exclusions still apply).
  const aiPickedAudits = isSubtask ? null : getAiPickedAudits(task.checklists);
  const requiredAuditItems = Array.from(
    new Set([
      ...(aiPickedAudits ? [] : getRequiredAudits(task.title || '', auditorRoles)),
      ...activeAuditItems,
    ].filter((text, i, all) => {
      const norm = normalizeAuditName(text);
      if (!text || text.startsWith('!') || excludedAudits.has(norm)) return false;
      if (HIDE_DESIGN_AUDIT && norm === 'design audit') return false;
      return all.findIndex(t => normalizeAuditName(t) === norm) === i;
    }))
  );

  const getAuditItem = (text: string) => {
    const norm = normalizeAuditName(text);
    const matches = auditChecklists.flatMap((c: any) => c.items || []).filter((i: any) => normalizeAuditName(i.text) === norm);
    return matches.find((i: any) => i.assigneeId?.length || i.completed) || matches[0];
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
  if (!subtaskId || task.id === subtaskId || task.subtaskId === subtaskId) {
    return task;
  }
  const found = (task.subtasks || []).find((s: any) => s.id === subtaskId);
  if (found) {
    const subChecklists = (found.checklists && found.checklists.length > 0)
      ? found.checklists
      : (task.checklists || []).filter((c: any) => c.subtaskId === subtaskId);
    return {
      ...found,
      id: subtaskId,
      taskId: task.id || found.taskId,
      title: found.title || '',
      assigneeRoleRestrictions: found.assigneeRoleRestrictions || [],
      checklists: subChecklists,
    };
  }
  return {
    id: subtaskId,
    taskId: task.id,
    title: '',
    checklists: (task.checklists || []).filter((c: any) => c.subtaskId === subtaskId),
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
  return status.requiredAudits.some((a) => isUiUxAudit(a) || isDesignAudit(a));
}

/**
 * Checks whether all required Level 1 audits (UI UX Audit and Design Audit) are complete.
 */
export function areLevel1AuditsComplete(task: any, subtaskId?: string): boolean {
  if (!task) return true;
  const targetTask = resolveTargetTaskOrSubtask(task, subtaskId);
  const status = getTaskAuditStatus(targetTask);
  const requiredLevel1 = status.requiredAudits.filter((a) => isUiUxAudit(a) || isDesignAudit(a));
  if (requiredLevel1.length === 0) return true;
  return !status.uncheckedAudits.some((a) => isUiUxAudit(a) || isDesignAudit(a));
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
 * Validates whether an audit can be completed based on the hierarchy:
 * - Level 1 (UI UX & Design): Always allowed (same hierarchy).
 * - Level 2 (Instruction): Blocked if task requires Level 1 audits and any are not yet done.
 * - Level 3 (Funnel): Blocked if Level 1 audits or Instruction Audit are not yet done.
 */
export function canPerformAudit(auditName: string, task: any, subtaskId?: string): AuditPermissionCheck {
  if (!task) return { allowed: true, missingPrerequisites: [] };

  const norm = normalizeAuditName(auditName);

  // Level 1 audits have no prerequisites
  if (isUiUxAudit(norm) || isDesignAudit(norm)) {
    return { allowed: true, missingPrerequisites: [] };
  }

  const targetTask = resolveTargetTaskOrSubtask(task, subtaskId);
  const status = getTaskAuditStatus(targetTask);

  // Uncompleted Level 1 audits
  const missingLevel1 = status.uncheckedAudits.filter((a) => isUiUxAudit(a) || isDesignAudit(a));

  // Level 2: Instruction Audit
  if (isInstructionAudit(norm)) {
    if (missingLevel1.length > 0) {
      const labels = missingLevel1.map((a) => (isUiUxAudit(a) ? 'UI/UX Audit' : 'Design Audit')).join(' and ');
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
      const labels = missingLevel1.map((a) => (isUiUxAudit(a) ? 'UI/UX Audit' : 'Design Audit')).join(' and ');
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

    return { allowed: true, missingPrerequisites: [] };
  }

  return { allowed: true, missingPrerequisites: [] };
}


