/**
 * Nexus's own Audit checklist (Instructions / Design / UI UX / Funnel, shown in the
 * Audit section) vs. a ClickUp checklist that happens to be named "Audit". The two
 * share a name, so the items decide: Nexus's only ever holds the four audit items.
 */
const NEXUS_AUDIT_ITEMS = new Set(['instructions audit', 'design audit', 'ui ux audit', 'funnel audit']);

export interface ChecklistLike {
  name: string;
  externalId?: string | null;
  items?: { text: string; completed?: boolean; assigneeId?: string | null }[] | null;
  subtaskId?: string | null;
}

export function isNexusAuditChecklist(c: ChecklistLike): boolean {
  if (!c || !c.name) return false;
  if (c.name.trim().toLowerCase() !== 'audit') return false;
  const items = c.items ?? [];
  // Empty: Nexus's own unless it came from ClickUp.
  if (items.length === 0) return !c.externalId;
  return items.every((i) => NEXUS_AUDIT_ITEMS.has((i.text || '').trim().toLowerCase()));
}

export const getRequiredAudits = (taskTitle: string, auditorRoles?: string[]): string[] => {
  const audits = new Set<string>();

  // Every task must pass an Instructions Audit globally
  audits.add('Instructions Audit');

  // Title-based checks (requested by user)
  const title = (taskTitle || '').toLowerCase();
  if (title.includes('design')) audits.add('Design Audit');
  if (title.includes('ui/ux') || title.includes('ui ux')) audits.add('UI UX Audit');
  if (taskTitle.startsWith('Do a feasibility') || taskTitle.startsWith('Prepare a report') || title.includes('funnel')) {
    audits.add('Funnel Audit');
  }

  // Same title rules as the server's getRequiredAudits, so every audit it requires is shown here.
  if (/graphic|reel|video|sample/.test(title)) audits.add('Design Audit');
  if (/email|newsletter|social media/.test(title)) {
    audits.add('Design Audit');
    audits.add('Funnel Audit');
  }
  if (/website|page|funnel|link/.test(title)) {
    audits.add('UI UX Audit');
    audits.add('Design Audit');
    audits.add('Funnel Audit');
  }

  // Whatever auditor role was actually assigned (e.g. via the Galaxy "--Audit - <Role> -" subtask)
  // determines the required audit item directly, regardless of what the task title says.
  (auditorRoles || []).forEach((role) => {
    const r = (role || '').toLowerCase();
    if (r.includes('ui') || r.includes('ux')) audits.add('UI UX Audit');
    if (r.includes('design')) audits.add('Design Audit');
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

  const requiredAuditItems = Array.from(
    new Set([
      ...getRequiredAudits(task.title || '', auditorRoles),
      ...auditChecklists.flatMap((c: any) => c.items?.map((i: any) => i.text) || []),
    ].filter((text, i, all) => all.findIndex(t => t.toLowerCase() === text.toLowerCase()) === i))
  );

  const getAuditItem = (text: string) => {
    const matches = auditChecklists.flatMap((c: any) => c.items || []).filter((i: any) => (i.text || '').toLowerCase() === text.toLowerCase());
    return matches.find((i: any) => i.assigneeId || i.completed) || matches[0];
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
  const subtasks: any[] = task?.subtasks || [];
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

