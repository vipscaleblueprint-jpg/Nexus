import { prisma } from '../config/prisma';

// Same PM match as findUsersByRoleCategory('PM') and the frontend's isProjectManagerOrAdmin
const PROJECT_MANAGER_ROLE = /project\s*manager|^pm$/i;

/**
 * Names the PM role(s) exactly as they are written in the WorkspaceRole table.
 * Same text as the frontend's getAssignDeniedMessage.
 */
export async function getAssignDeniedMessage(): Promise<string> {
  const roles = await prisma.workspaceRole.findMany({ select: { name: true } }).catch(() => []);
  const pmRoles = roles.map((r) => r.name).filter((n) => PROJECT_MANAGER_ROLE.test((n || '').trim()));
  const label = pmRoles.length > 0 ? pmRoles.join(' or ') : 'Project Manager';
  return `You can't change this. Only ${label} and Admins can set Team Role and Assignees.`;
}

/**
 * Only Project Managers and Admins can set a task's Team Role (assigneeRoleRestrictions) and Assignees.
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
  return (user.roles || []).some((r) => PROJECT_MANAGER_ROLE.test((r || '').trim()));
}
