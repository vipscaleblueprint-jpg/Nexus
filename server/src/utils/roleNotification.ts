import { prisma } from '../config/prisma';
import { io } from '../server';
import { isNexusAuditChecklist } from './auditChecklist';

// Normalizes status strings for flexible matching (case-insensitive, trims & strips spaces/hyphens/underscores)
export function normalizeStatusKey(status: string): string {
  return (status || '').toLowerCase().replace(/[\s\-_]+/g, '');
}

export type StatusRoleCategory = 'AUDITOR' | 'PM' | 'CRM' | null;

export function getStatusRoleCategory(status: string): StatusRoleCategory {
  const key = normalizeStatusKey(status);
  // Match "In Review", "InReview", "Review"
  if (key === 'inreview' || key === 'review') {
    return 'AUDITOR';
  }
  // Match "In Checking", "InChecking", "Checking"
  if (key === 'inchecking' || key === 'checking') {
    return 'PM';
  }
  // Match "CRM", "Client Relationship Manager"
  if (key === 'crm' || key === 'clientrelationshipmanager') {
    return 'CRM';
  }
  return null;
}

function userHasRole(userRoles: string[], pattern: RegExp): boolean {
  return (userRoles || []).some((r) => pattern.test((r || '').trim()));
}

/**
 * Finds user IDs matching target roles, scoped to team first, with fallback to workspace-wide.
 * Always includes Admins if includeAdmins is true.
 */
export async function findUsersByRoleCategory(
  category: StatusRoleCategory,
  options: {
    teamId?: string | null;
    excludeUserId?: string | null;
    includeAdmins?: boolean;
  } = {}
): Promise<string[]> {
  const { teamId, excludeUserId, includeAdmins = true } = options;
  if (!category && !includeAdmins) return [];

  // Patterns for matching user roles
  let rolePattern: RegExp | null = null;
  if (category === 'AUDITOR') {
    rolePattern = /auditor/i;
  } else if (category === 'PM') {
    rolePattern = /project\s*manager|^pm$/i;
  } else if (category === 'CRM') {
    rolePattern = /crm|client\s*relationship\s*manager/i;
  }

  // Fetch all active users with their roles, systemRole, and teamId
  const allUsers = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, roles: true, systemRole: true, teamId: true },
  });

  const recipientIds = new Set<string>();

  // 1. Team-scoped matching if teamId is provided
  if (teamId && rolePattern) {
    const teamMatches = allUsers.filter(
      (u) => u.teamId === teamId && userHasRole(u.roles, rolePattern!)
    );
    if (teamMatches.length > 0) {
      teamMatches.forEach((u) => recipientIds.add(u.id));
    }
  }

  // 2. Fallback to workspace-wide if no team matches were found (or no teamId)
  if (recipientIds.size === 0 && rolePattern) {
    const workspaceMatches = allUsers.filter((u) => userHasRole(u.roles, rolePattern!));
    workspaceMatches.forEach((u) => recipientIds.add(u.id));
  }

  // 3. Always include Admins
  if (includeAdmins) {
    const admins = allUsers.filter(
      (u) =>
        u.systemRole === 'ADMIN' ||
        (u.roles || []).some((r) => r.trim().toUpperCase() === 'ADMIN')
    );
    admins.forEach((u) => recipientIds.add(u.id));
  }

  // 4. Exclude acting user
  if (excludeUserId) {
    recipientIds.delete(excludeUserId);
  }

  return Array.from(recipientIds);
}

/**
 * Returns recipients for a status change:
 * Relevant role recipients (scoped to team -> workspace fallback) + Admins + existing task assignees,
 * excluding the actor.
 */
export async function getStatusChangeRecipients(
  newStatus: string,
  task: {
    id: string;
    teamId?: string | null;
    assigneeId?: string | null;
    assignees?: { id: string }[];
  },
  actingUserId?: string | null
): Promise<string[]> {
  const category = getStatusRoleCategory(newStatus);
  const recipientIds = new Set<string>();

  // Role category matches + Admins
  if (category) {
    const roleUsers = await findUsersByRoleCategory(category, {
      teamId: task.teamId,
      excludeUserId: actingUserId,
      includeAdmins: true,
    });
    roleUsers.forEach((id) => recipientIds.add(id));
  }

  // Also include task assignees
  if (task.assigneeId) recipientIds.add(task.assigneeId);
  if (task.assignees && Array.isArray(task.assignees)) {
    task.assignees.forEach((a) => recipientIds.add(a.id));
  }

  if (actingUserId) {
    recipientIds.delete(actingUserId);
  }

  return Array.from(recipientIds);
}

/**
 * Returns recipients for a checklist / audit check:
 * PMs + Auditors + Admins (scoped to team first if teamId present, fallback workspace-wide),
 * plus task assignees, excluding acting user.
 */
export async function getChecklistCheckRecipients(
  task: {
    id: string;
    teamId?: string | null;
    assigneeId?: string | null;
    assignees?: { id: string }[];
  },
  actingUserId?: string | null
): Promise<string[]> {
  const recipientIds = new Set<string>();

  // PMs
  const pms = await findUsersByRoleCategory('PM', {
    teamId: task.teamId,
    excludeUserId: actingUserId,
    includeAdmins: true,
  });
  pms.forEach((id) => recipientIds.add(id));

  // Auditors
  const auditors = await findUsersByRoleCategory('AUDITOR', {
    teamId: task.teamId,
    excludeUserId: actingUserId,
    includeAdmins: true,
  });
  auditors.forEach((id) => recipientIds.add(id));

  // Task assignees
  if (task.assigneeId) recipientIds.add(task.assigneeId);
  if (task.assignees && Array.isArray(task.assignees)) {
    task.assignees.forEach((a) => recipientIds.add(a.id));
  }

  if (actingUserId) {
    recipientIds.delete(actingUserId);
  }

  return Array.from(recipientIds);
}

/**
 * Helper to determine whether a checklist item is an audit item.
 */
export function isAuditItem(
  checklistName: string,
  itemText: string,
  checklistExternalId?: string | null
): boolean {
  if (isNexusAuditChecklist({ name: checklistName, externalId: checklistExternalId, items: [{ text: itemText }] })) {
    return true;
  }
  const lowerText = (itemText || '').trim().toLowerCase();
  const lowerName = (checklistName || '').trim().toLowerCase();
  return (
    lowerName === 'audit' ||
    lowerText.includes('audit') ||
    lowerText === 'funnel audit' ||
    lowerText === 'design audit' ||
    lowerText === 'ui ux audit' ||
    lowerText === 'instructions audit'
  );
}

/**
 * Format audit check action title and activity message:
 * e.g., "Blessie has checked funnel auditing" / "Aaron has checked checklistname"
 */
export function formatChecklistNotificationTitle(
  actorName: string,
  itemName: string,
  taskTitle: string,
  isAudit: boolean
): string {
  const lower = itemName.trim().toLowerCase();
  if (isAudit) {
    if (lower.includes('funnel')) {
      return `${actorName} has checked funnel auditing on "${taskTitle}"`;
    }
    if (lower.includes('design')) {
      return `${actorName} has checked design auditing on "${taskTitle}"`;
    }
    if (lower.includes('ui') && lower.includes('ux')) {
      return `${actorName} has checked UI/UX auditing on "${taskTitle}"`;
    }
    if (lower.includes('instructions')) {
      return `${actorName} has checked instructions auditing on "${taskTitle}"`;
    }
    return `${actorName} has checked ${itemName} on "${taskTitle}"`;
  }
  return `${actorName} has checked ${itemName} on "${taskTitle}"`;
}
