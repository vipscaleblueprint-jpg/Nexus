import { prisma } from '../config/prisma';

// Same PM/Senior match as findUsersByRoleCategory('PM') and the frontend's isProjectManagerOrAdmin
const PROJECT_MANAGER_OR_SENIOR_ROLE = /project\s*manager|^pm$|\bsenior\b/i;

/**
 * Names the PM/Senior role(s) exactly as they are written in the WorkspaceRole table.
 * Same text as the frontend's getAssignDeniedMessage.
 */
export async function getAssignDeniedMessage(): Promise<string> {
  const roles = await prisma.workspaceRole.findMany({ select: { name: true } }).catch(() => []);
  const privilegedRoles = roles.map((r) => r.name).filter((n) => PROJECT_MANAGER_OR_SENIOR_ROLE.test((n || '').trim()));
  const label = privilegedRoles.length > 0 ? privilegedRoles.join(' or ') : 'Project Manager, Senior';
  return `You can't change this. Only ${label} and Admins can set Team Role and Assignees.`;
}

/**
 * Only Project Managers, Seniors, and Admins can set a task's Team Role (assigneeRoleRestrictions) and Assignees.
 * Reads roles from the DB, not the JWT, so a role change applies immediately.
 */
export async function canUserSetAssignees(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { systemRole: true, roles: true, isActive: true },
  });
  if (!user?.isActive) return false;
  if (user.systemRole === 'ADMIN') return true;
  return (user.roles || []).some((r) => PROJECT_MANAGER_OR_SENIOR_ROLE.test((r || '').trim()));
}
