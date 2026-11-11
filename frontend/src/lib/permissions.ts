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
 * Checks if a user has any Auditor or Audit specialization role or flag.
 */
export function isAuditorUser(user: any): boolean {
  if (!user) return false;
  if (user.isAudit) return true;
  const roles = user.roles || [];
  return roles.some((r: string) => typeof r === 'string' && /audit/i.test(r.trim()));
}

/**
 * Checks if a user has a CRM role.
 */
export function isCrmUser(user: any): boolean {
  if (!user) return false;
  const roles = user.roles || [];
  return roles.some((r: string) => typeof r === 'string' && /crm|client\s*relationship/i.test(r.trim()));
}

/**
 * Checks if a user is allowed to access the CRM board (Admins and CRM role holders).
 */
export function hasCrmAccess(user: any): boolean {
  if (!user) return false;
  if (user.systemRole === 'ADMIN') return true;
  return isCrmUser(user);
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

/** Entering In Review only needs every subtask Closed — UI/UX and Design auditing happens during review. */
export const IN_REVIEW_STATUSES = ['in review', 'inreview', 'in-review', 'review', 'under review', 'for review'];
/** Checking involves Instruction Audit and Funnel Audit — requires subtasks Closed and Level 1 audits (UI UX & Design) completed. */
export const CHECKING_STATUSES = ['checking', 'in checking', 'inchecking'];
/** Post-review completion statuses need every subtask Closed AND all required audits checked. */
export const COMPLETION_GATE_STATUSES = ['closed', 'crm', 'done', 'completed'];
/** Every status that has any gate (kept for existing imports). */
export const RESTRICTED_GATE_STATUSES = [...IN_REVIEW_STATUSES, ...CHECKING_STATUSES, ...COMPLETION_GATE_STATUSES];

export function normalizeStatus(status?: string | null): string {
  return (status || '').trim().toLowerCase();
}

export function isReviewStatus(status?: string | null): boolean {
  const norm = normalizeStatus(status);
  return IN_REVIEW_STATUSES.includes(norm);
}

export function isCheckingStatus(status?: string | null): boolean {
  const norm = normalizeStatus(status);
  return CHECKING_STATUSES.includes(norm);
}

export function isCompletionStatus(status?: string | null): boolean {
  const norm = normalizeStatus(status);
  return COMPLETION_GATE_STATUSES.includes(norm);
}

export interface TransitionCheckResult {
  allowed: boolean;
  reason?: string;
  uncheckedAudits: string[];
  openSubtasks: string[];
  targetStatus: string;
}

/**
 * Validates whether a task can transition to a restricted status.
 * - In Review: all subtasks must be Closed (no subtasks = allowed). UI/UX and Design auditing happens during review.
 * - Checking: all subtasks Closed AND required Level 1 audits (UI UX & Design) completed. Instruction & Funnel audits happen during checking.
 * - CRM / Closed / Done / Completed: all subtasks Closed AND ALL required audits checked.
 */
export function canTransitionTaskStatus(
  task: any,
  newStatus: string
): TransitionCheckResult {
  if (!task || !newStatus) {
    return { allowed: true, uncheckedAudits: [], openSubtasks: [], targetStatus: newStatus || '' };
  }

  const currentStatusNorm = normalizeStatus(task.status);
  const targetStatusNorm = normalizeStatus(newStatus);

  // If status is not changing, allow
  if (currentStatusNorm === targetStatusNorm) {
    return { allowed: true, uncheckedAudits: [], openSubtasks: [], targetStatus: newStatus };
  }

  const isReview = isReviewStatus(targetStatusNorm);
  const isChecking = isCheckingStatus(targetStatusNorm);
  const isCompletion = isCompletionStatus(targetStatusNorm);

  if (isReview || isChecking || isCompletion) {
    const subtaskStatus = getTaskSubtaskStatus(task);
    if (!subtaskStatus.isComplete) {
      return {
        allowed: false,
        reason: `Cannot move to ${newStatus}: All subtasks must be Closed first (${subtaskStatus.openCount} open).`,
        uncheckedAudits: [],
        openSubtasks: subtaskStatus.openSubtasks,
        targetStatus: newStatus,
      };
    }

    // In Review explicitly does NOT need audits. Audits happen during review.
    if (isReview) {
      return { allowed: true, uncheckedAudits: [], openSubtasks: [], targetStatus: newStatus };
    }

    // Checking involves Funnel Audit & Instruction Audit.
    // It requires Level 1 audits (UI UX Audit and Design Audit) to be completed first.
    if (isChecking) {
      const auditStatus = getTaskAuditStatus(task);
      const incompleteLevel1 = auditStatus.uncheckedAudits.filter((a) => {
        const norm = (a || '').toLowerCase();
        return norm.includes('ui') || norm.includes('ux') || norm.includes('design');
      });

      if (incompleteLevel1.length > 0) {
        return {
          allowed: false,
          reason: `Cannot move to Checking: UI/UX and Design audits must be completed first (${incompleteLevel1.join(', ')}).`,
          uncheckedAudits: incompleteLevel1,
          openSubtasks: [],
          targetStatus: newStatus,
        };
      }

      return { allowed: true, uncheckedAudits: [], openSubtasks: [], targetStatus: newStatus };
    }

    // Completion gate statuses: ALL required audits must be completed
    if (isCompletion) {
      const auditStatus = getTaskAuditStatus(task);
      if (!auditStatus.isComplete) {
        return {
          allowed: false,
          reason: `Cannot move to ${newStatus}: All Audits must be checked first (${auditStatus.completedCount}/${auditStatus.totalCount} completed). Needs check: ${auditStatus.uncheckedAudits.join(', ')}.`,
          uncheckedAudits: auditStatus.uncheckedAudits,
          openSubtasks: [],
          targetStatus: newStatus,
        };
      }
    }
  }

  return {
    allowed: true,
    uncheckedAudits: [],
    openSubtasks: [],
    targetStatus: newStatus,
  };
}

/**
 * Checks whether the current user is Aaron (owner/admin) based on database identity.
 */
export function isAaronUser(user?: User | null | { id?: string; name?: string; email?: string }): boolean {
  if (!user) return false;
  const name = (user.name || '').toLowerCase().trim();
  const email = (user.email || '').toLowerCase().trim();
  return (
    name === 'aaron' ||
    name.includes('aaron') ||
    email.includes('aaron') ||
    user.id === 'bc74d7a0-e1e0-4a18-bf59-4e733fa25c92'
  );
}


