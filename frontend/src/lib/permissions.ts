import { Task, WorkspaceRole, User } from '@/lib/types';
import { isNexusAuditChecklist, getTaskAuditStatus, getTaskSubtaskStatus } from '@/lib/auditChecklist';

export function canUserMoveTask(
  task: Task | null | undefined,
  listStatuses: any[] = [],
  currentUser: User | null | undefined,
  workspaceRoles: WorkspaceRole[] = []
): { allowed: boolean; reason?: string } {
  if (!task) return { allowed: true };
  if (!currentUser) return { allowed: false, reason: 'Please sign in to move tasks.' };


  // Normalize task status for comparison
  const taskStatusNorm = (task.status || '').trim().toUpperCase();

  // Find source status rules case-insensitively
  const sourceStatusRule = listStatuses.find(
    (s: any) => (s.name || '').trim().toUpperCase() === taskStatusNorm
  );

  if (!sourceStatusRule || !sourceStatusRule.allowedRoles || sourceStatusRule.allowedRoles.length === 0) {
    return { allowed: true }; // Column is open to everyone
  }

  // Resolve allowed roles to names
  const allowedNames = sourceStatusRule.allowedRoles.map((r: string) => {
    const match = workspaceRoles.find(
      (wr) => wr.id === r || wr.name.toUpperCase() === r.toUpperCase()
    );
    return match ? match.name.toUpperCase() : r.toUpperCase();
  });

  // Extract all roles assigned to current user
  const userRoles = (currentUser.roles || [])
    .filter(Boolean)
    .map((r: string) => r.trim().toUpperCase());

  // Check if user has any of the allowed roles (by name or ID)
  const hasAccess = allowedNames.some((r: string) => userRoles.includes(r));
  if (!hasAccess) {
    return {
      allowed: false,
      reason: `Tasks in "${task.status}" can only be moved by: ${allowedNames.join(', ')}.`,
    };
  }

  return { allowed: true };
}

/**
 * Checks whether the current user is allowed to EDIT a specific task.
 * This is controlled by `task.teamAssignAccessRole`:
 *   - If unset → everyone can edit
 *   - If set to a role name → only users holding that role (or Admins) can edit
 */
export function canUserEditTask(
  task: Task | null | undefined,
  currentUser: User | null | undefined
): { allowed: boolean; reason?: string } {
  if (!task) return { allowed: true };
  const t = task as any;
  if (!t.teamAssignAccessRole) return { allowed: true };
  if (!currentUser) return { allowed: false, reason: 'Please sign in.' };

  const required = t.teamAssignAccessRole.trim().toUpperCase();
  const userRoles = (currentUser.roles || [])
    .filter(Boolean).map((r: string) => r.trim().toUpperCase());

  if (userRoles.includes(required)) return { allowed: true };

  return {
    allowed: false,
    reason: `Only users with the "${t.teamAssignAccessRole}" role can edit this task.`,
  };
}

const PROJECT_MANAGER_OR_SENIOR_ROLE = /project\s*manager|^pm$|\bsenior\b/i;

/**
 * Only Project Managers, Seniors, and Admins can set a task's Team Role and Assignees.
 * Same PM/Senior match as the server (server/src/utils/assignPermission.ts).
 */
export function isProjectManagerOrAdmin(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.systemRole === 'ADMIN') return true;
  return (user.roles || []).some((r) => PROJECT_MANAGER_OR_SENIOR_ROLE.test((r || '').trim()));
}

/**
 * Message shown to users who can't set Team Role / Assignees, naming the PM/Senior role(s) exactly as they are
 * written in the WorkspaceRole table. Same text as the server (server/src/utils/assignPermission.ts).
 */
export function getAssignDeniedMessage(workspaceRoles: { name: string }[] = []): string {
  const privilegedRoles = workspaceRoles.map((r) => r.name).filter((n) => PROJECT_MANAGER_OR_SENIOR_ROLE.test((n || '').trim()));
  const label = privilegedRoles.length > 0 ? privilegedRoles.join(' or ') : 'Project Manager, Senior';
  return `You can't change this. Only ${label} and Admins can set Team Role and Assignees.`;
}

/** Entering In Review only needs every subtask Closed — auditing happens during review. */
export const IN_REVIEW_STATUSES = ['in review', 'inreview', 'in-review'];
/** Post-review statuses need every subtask Closed AND every required audit checked. */
export const COMPLETION_GATE_STATUSES = ['checking', 'closed', 'crm', 'done', 'completed'];
/** Every status that has any gate (kept for existing imports). */
export const RESTRICTED_GATE_STATUSES = [...IN_REVIEW_STATUSES, ...COMPLETION_GATE_STATUSES];

export interface TransitionCheckResult {
  allowed: boolean;
  reason?: string;
  uncheckedAudits: string[];
  openSubtasks: string[];
  targetStatus: string;
}

/**
 * Validates whether a task can transition to a restricted status.
 * - In Review: all subtasks must be Closed (no subtasks = allowed). Audits are NOT required yet.
 * - Checking / CRM / Closed / Done / Completed: all subtasks Closed AND all required audits checked.
 */
export function canTransitionTaskStatus(
  task: any,
  newStatus: string
): TransitionCheckResult {
  if (!task || !newStatus) {
    return { allowed: true, uncheckedAudits: [], openSubtasks: [], targetStatus: newStatus || '' };
  }

  const currentStatusNorm = (task.status || '').trim().toLowerCase();
  const targetStatusNorm = newStatus.trim().toLowerCase();

  // If status is not changing, allow
  if (currentStatusNorm === targetStatusNorm) {
    return { allowed: true, uncheckedAudits: [], openSubtasks: [], targetStatus: newStatus };
  }

  if (RESTRICTED_GATE_STATUSES.includes(targetStatusNorm)) {
    const needsAudits = COMPLETION_GATE_STATUSES.includes(targetStatusNorm);
    const subtaskStatus = getTaskSubtaskStatus(task);
    const auditStatus = needsAudits ? getTaskAuditStatus(task) : null;

    const subtasksIncomplete = !subtaskStatus.isComplete;
    const auditsIncomplete = !!auditStatus && !auditStatus.isComplete;

    if (subtasksIncomplete || auditsIncomplete) {
      let reason = '';
      if (subtasksIncomplete && auditsIncomplete) {
        reason = `Cannot move to ${newStatus}: ${subtaskStatus.openCount} subtask(s) still open and Audits need checking (${auditStatus!.completedCount}/${auditStatus!.totalCount} completed).`;
      } else if (subtasksIncomplete) {
        reason = `Cannot move to ${newStatus}: All subtasks must be Closed first (${subtaskStatus.openCount} open).`;
      } else {
        reason = `Cannot move to ${newStatus}: All Audits must be checked first (${auditStatus!.completedCount}/${auditStatus!.totalCount} completed). Needs check: ${auditStatus!.uncheckedAudits.join(', ')}.`;
      }

      return {
        allowed: false,
        reason,
        uncheckedAudits: auditsIncomplete ? auditStatus!.uncheckedAudits : [],
        openSubtasks: subtaskStatus.openSubtasks,
        targetStatus: newStatus,
      };
    }
  }

  return {
    allowed: true,
    uncheckedAudits: [],
    openSubtasks: [],
    targetStatus: newStatus,
  };
}

