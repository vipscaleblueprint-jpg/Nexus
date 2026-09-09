import { Task, WorkspaceRole, User } from '@/lib/types';

export function canUserMoveTask(
  task: Task | null | undefined,
  listStatuses: any[] = [],
  currentUser: User | null | undefined,
  workspaceRoles: WorkspaceRole[] = []
): { allowed: boolean; reason?: string } {
  if (!task) return { allowed: true };
  if (!currentUser) return { allowed: false, reason: 'Please sign in to move tasks.' };

  // Admins always have access to move any task from any column
  const isAdmin =
    currentUser.systemRole === 'ADMIN' ||
    currentUser.primaryRole?.trim().toUpperCase() === 'ADMIN';

  if (isAdmin) {
    return { allowed: true };
  }

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
  const rawRoles = [
    currentUser.primaryRole,
    currentUser.secondaryRole,
    currentUser.tertiaryRole,
    currentUser.minorRole,
    ...((currentUser as any).roles || []),
  ];

  const userRoles = rawRoles
    .filter(Boolean)
    .map((r: string) => r.trim().toUpperCase());

  // Check if user has any of the allowed roles (by name or ID)
  const hasAccess = allowedNames.some((r: string) => userRoles.includes(r));
  if (!hasAccess) {
    return {
      allowed: false,
      reason: `Tasks in "${task.status}" can only be moved by: ${allowedNames.join(', ')}. Admins also have full access.`,
    };
  }

  return { allowed: true };
}
