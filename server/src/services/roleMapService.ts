import { prisma } from '../config/prisma';
import { getCache, setCache } from './redisService';

export function normalizeRoleName(role: string): string {
  if (!role) return '';
  return role
    .trim()
    .toLowerCase()
    .replace(/\baudits\b/g, 'audit')
    .replace(/\bauditors\b/g, 'audit')
    .replace(/\bauditor\b/g, 'audit')
    .replace(/s\b/g, '');
}

export function matchesRole(userRole: string, targetRole: string): boolean {
  if (!userRole || !targetRole) return false;
  const u = userRole.trim().toLowerCase();
  const t = targetRole.trim().toLowerCase();
  if (u === t) return true;
  return normalizeRoleName(u) === normalizeRoleName(t);
}

export interface RoleMember {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  employmentType: string;
  starRating: number;
  systemRole: string;
  teamName: string | null;
  roles: string[];
}

export interface RoleMapEntry {
  id: string;
  name: string;
  type: 'workspace' | 'teamrole' | 'custom';
  color: string | null;
  teamId?: string | null;
  teamName?: string | null;
  memberCount: number;
  members: RoleMember[];
}

export interface RoleMapResult {
  success: boolean;
  roles: RoleMapEntry[];
  unassignedMembers: RoleMember[];
  totalRoles: number;
  totalMembers: number;
}

export async function getAggregatedRoleMap(): Promise<RoleMapResult> {
  const cached = await getCache<RoleMapResult>('role-map:data');
  if (cached) {
    return cached;
  }

  const [users, workspaceRoles, teamRoles] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        imageUrl: true,
        roles: true,
        employmentType: true,
        starRating: true,
        systemRole: true,
        teamId: true,
        team: { select: { id: true, name: true, color: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.workspaceRole.findMany({ orderBy: { name: 'asc' } }),
    (prisma as any).teamRole.findMany({
      orderBy: { name: 'asc' },
      include: { team: { select: { id: true, name: true, color: true } } },
    }),
  ]);

  const serializeMember = (u: any): RoleMember => ({
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.imageUrl || u.avatarUrl || null,
    employmentType: u.employmentType,
    starRating: u.starRating || 1,
    systemRole: u.systemRole,
    teamName: u.team?.name || null,
    roles: u.roles || [],
  });

  const serializedUsers = users.map(serializeMember);

  const matchedRoleNames = new Set<string>();
  const roleEntries: RoleMapEntry[] = [];

  // 1. Process Workspace Roles
  for (const wr of workspaceRoles) {
    matchedRoleNames.add(normalizeRoleName(wr.name));
    const members = serializedUsers.filter((u) =>
      u.roles.some((r) => matchesRole(r, wr.name))
    );
    roleEntries.push({
      id: `ws_${wr.id}`,
      name: wr.name,
      type: 'workspace',
      color: wr.color || null,
      memberCount: members.length,
      members,
    });
  }

  // 2. Process Team Roles
  for (const tr of teamRoles) {
    matchedRoleNames.add(normalizeRoleName(tr.name));
    const members = serializedUsers.filter(
      (u) =>
        u.roles.some((r) => matchesRole(r, tr.name)) ||
        (tr.teamId && u.teamName === tr.team?.name && u.roles.some((r) => matchesRole(r, tr.name)))
    );
    roleEntries.push({
      id: `tr_${tr.id}`,
      name: tr.name,
      type: 'teamrole',
      color: tr.team?.color || null,
      teamId: tr.teamId || null,
      teamName: tr.team?.name || null,
      memberCount: members.length,
      members,
    });
  }

  // 3. Process Custom Roles present in user.roles that aren't formal workspace/team roles
  const orphanRolesMap = new Map<string, { originalName: string; members: RoleMember[] }>();
  for (const u of serializedUsers) {
    for (const r of u.roles) {
      const norm = normalizeRoleName(r);
      if (!norm || matchedRoleNames.has(norm)) continue;

      if (!orphanRolesMap.has(norm)) {
        orphanRolesMap.set(norm, { originalName: r.trim(), members: [] });
      }
      const group = orphanRolesMap.get(norm)!;
      if (!group.members.some((m) => m.id === u.id)) {
        group.members.push(u);
      }
    }
  }

  for (const [norm, { originalName, members }] of orphanRolesMap.entries()) {
    roleEntries.push({
      id: `custom_${norm}`,
      name: originalName,
      type: 'custom',
      color: null,
      memberCount: members.length,
      members,
    });
  }

  // Sort role entries: those with members first, then alphabetically
  roleEntries.sort((a, b) => {
    if (a.memberCount > 0 && b.memberCount === 0) return -1;
    if (a.memberCount === 0 && b.memberCount > 0) return 1;
    return a.name.localeCompare(b.name);
  });

  // Collect unassigned active users
  const unassignedMembers = serializedUsers.filter((u) => !u.roles || u.roles.length === 0);

  const result: RoleMapResult = {
    success: true,
    roles: roleEntries,
    unassignedMembers,
    totalRoles: roleEntries.length,
    totalMembers: serializedUsers.length,
  };

  // Cache for 60 seconds
  await setCache('role-map:data', result, 60);

  return result;
}
