import { Task, WorkspaceRole, User } from '@/lib/types';
import { isNexusAuditChecklist } from '@/lib/auditChecklist';

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

export const RESTRICTED_GATE_STATUSES = ['in review', 'inreview', 'in-review', 'checking', 'closed', 'crm'];

/**
 * Validates whether a task can transition to a restricted status.
 * Requires all subtasks to be Closed, and all Audit checklist items to be completed.
 */
export function canTransitionTaskStatus(
  task: any,
  newStatus: string
): { allowed: boolean; reason?: string } {
  if (!task || !newStatus) return { allowed: true };

  const currentStatusNorm = (task.status || '').trim().toLowerCase();
  const targetStatusNorm = newStatus.trim().toLowerCase();

  // If status is not changing, allow
  if (currentStatusNorm === targetStatusNorm) return { allowed: true };

  if (RESTRICTED_GATE_STATUSES.includes(targetStatusNorm)) {
    // 1. Subtasks check: all subtasks must be closed
    if (task.subtasks && task.subtasks.length > 0) {
      const hasUnclosedSubtasks = task.subtasks.some((st: any) => {
        const s = (st.status || '').trim().toLowerCase();
        return s !== 'closed' && !st.completed;
      });
      if (hasUnclosedSubtasks) {
        return {
          allowed: false,
          reason: `Cannot move task to ${newStatus} until all subtasks are Closed.`,
        };
      }
    }

    // 2. Audit checklist check: Nexus Audit checklist must be fully completed
    if (task.checklists && task.checklists.length > 0) {
      const auditChecklists = task.checklists.filter((c: any) => isNexusAuditChecklist(c));
      for (const c of auditChecklists) {
        if (c.items && c.items.length > 0 && c.items.some((i: any) => !i.completed)) {
          return {
            allowed: false,
            reason: `Cannot move to ${newStatus}: Audit checklist "${c.name}" is not fully completed.`,
          };
        }
      }
    }
  }

  return { allowed: true };
}
