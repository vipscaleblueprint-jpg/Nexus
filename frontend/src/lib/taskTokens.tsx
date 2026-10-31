import React from 'react';
import { tasksApi } from '@/api';

export const CustomCircleDotted = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <circle cx="12" cy="12" r="9" strokeDasharray="1 6" />
  </svg>
);

export const CustomCircleDot = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
  </svg>
);

export const ALL_STATUSES = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'PENDING',
  'IN PROGRESS',
  'REVISION',
  'WAITING',
  'IN REVIEW',
  'CHECKING',
  'CRM',
  'ON-HOLD',
  'CLOSED',
  'KYC',
  'PIN BOARD',
];

export const isClosedStatus = (status: any): boolean => {
  if (!status) return false;
  const name = (typeof status === 'string' ? status : (status.name || status.status || status.title || '')).trim().toUpperCase();
  const group = (typeof status === 'object' && status.groupName ? status.groupName.trim().toLowerCase() : '');
  return name === 'CLOSED' || name === 'DONE' || name === 'COMPLETED' || group === 'closed' || group === 'closed task';
};

export const sortStatusesWithClosedAndKycAtEnd = (statuses: any[]) => {
  const moveToEnd = ['ON-HOLD', 'KYC', 'PIN BOARD', 'PIN_BOARD', 'PINBOARD', 'CLOSED'];
  const nonEnd = statuses.filter(s => !moveToEnd.includes((typeof s === 'string' ? s : (s.name || s.status || s.title || '')).toUpperCase().trim()));
  const ends = statuses.filter(s => moveToEnd.includes((typeof s === 'string' ? s : (s.name || s.status || s.title || '')).toUpperCase().trim())).sort((a, b) => {
    const orderMap: Record<string, number> = {
      'ON-HOLD': 1,
      'KYC': 2,
      'PIN BOARD': 3,
      'PIN_BOARD': 3,
      'PINBOARD': 3,
      'CLOSED': 4,
    };
    const aName = (typeof a === 'string' ? a : (a.name || a.status || a.title || '')).toUpperCase().trim();
    const bName = (typeof b === 'string' ? b : (b.name || b.status || b.title || '')).toUpperCase().trim();
    return (orderMap[aName] || 99) - (orderMap[bName] || 99);
  });
  return [...nonEnd, ...ends];
};

// ---------------------------------------------------------------------------
// Module-level in-memory cache for task activities & comments.
// Lives outside the component so it persists across modal open/close cycles
// within the same browser session. Cleared on page refresh.
// TTL: 60 seconds — stale entries trigger a silent background refresh.
// ---------------------------------------------------------------------------
export interface ActivityCacheEntry {
  activities: any[];
  comments: any[];
  timestamp: number;
}
export const activityCache = new Map<string, ActivityCacheEntry>();
export const ACTIVITY_CACHE_TTL_MS = 60_000; // 60 seconds

// Exported so KanbanCard can prime the cache on hover (prefetch)
export function prefetchTaskActivities(taskId: string): void {
  const cached = activityCache.get(taskId);
  const cacheAge = cached ? Date.now() - cached.timestamp : Infinity;
  if (cacheAge < ACTIVITY_CACHE_TTL_MS) return; // already fresh, skip

  // Fire-and-forget — result stored in cache so modal opens with data ready
  Promise.all([
    tasksApi.getActivities(taskId).catch(() => null),
    tasksApi.getComments(taskId).catch(() => null),
  ]).then(([actRes, commentRes]) => {
    if (actRes?.activities && commentRes?.comments) {
      activityCache.set(taskId, {
        activities: actRes.activities,
        comments: commentRes.comments,
        timestamp: Date.now(),
      });
    }
  }).catch(() => {/* prefetch errors are silent */});
}

// Exported so SubtasksSection can prime the subtask cache on hover (prefetch)
export function prefetchSubtaskActivities(parentTaskId: string, subtaskId: string, subtaskTitle?: string): void {
  const cacheKey = `subtask:${subtaskId}`;
  const cached = activityCache.get(cacheKey);
  const cacheAge = cached ? Date.now() - cached.timestamp : Infinity;
  if (cacheAge < ACTIVITY_CACHE_TTL_MS) return; // already fresh, skip

  Promise.all([
    tasksApi.getActivities(parentTaskId).catch(() => null),
    tasksApi.getComments(parentTaskId, subtaskId).catch(() => null),
  ]).then(([actRes, commentRes]) => {
    if (actRes?.activities && commentRes?.comments) {
      const currentTitle = subtaskTitle || '';
      const filtered = actRes.activities.filter(
        (a: any) => a.subtaskId === subtaskId || (a.subtaskTitle && currentTitle && a.subtaskTitle.toLowerCase() === currentTitle.toLowerCase())
      );
      activityCache.set(cacheKey, {
        activities: filtered,
        comments: commentRes.comments,
        timestamp: Date.now(),
      });
    }
  }).catch(() => {/* prefetch errors are silent */});
}

export const STATUS_COLORS: Record<string, string> = {
  'KYC': 'bg-[#3A8F55] text-white',
  'PIN BOARD': 'bg-[#1F8A6E] text-white',
  'DAILY': 'bg-[#2F7BD0] text-white',
  'WEEKLY': 'bg-[#2F7BD0] text-white',
  'MONTHLY': 'bg-[#2F7BD0] text-white',
  'PENDING': 'bg-[#D29A2A] text-white',
  'IN PROGRESS': 'bg-[#D04A7C] text-white',
  'REVISION': 'bg-[#5B6BD6] text-white',
  'WAITING': 'bg-[#D9534F] text-white',
  'IN REVIEW': 'bg-[#D97B3A] text-white',
  'CHECKING': 'bg-[#A35DB8] text-white',
  'CRM': 'bg-[#22A3AE] text-white',
  'CLOSED': 'bg-[#2FA37A] text-white',
  'ON-HOLD': 'bg-[#8A8F98] text-white',

  // Fallback for capitalized formats
  'Kyc': 'bg-[#3A8F55] text-white',
  'Pin Board': 'bg-[#1F8A6E] text-white',
  'Daily': 'bg-[#2F7BD0] text-white',
  'Weekly': 'bg-[#2F7BD0] text-white',
  'Monthly': 'bg-[#2F7BD0] text-white',
  'Pending': 'bg-[#D29A2A] text-white',
  'In Progress': 'bg-[#D04A7C] text-white',
  'Revision': 'bg-[#5B6BD6] text-white',
  'Waiting': 'bg-[#D9534F] text-white',
  'In Review': 'bg-[#D97B3A] text-white',
  'Checking': 'bg-[#A35DB8] text-white',
  'Crm': 'bg-[#22A3AE] text-white',
  'Closed': 'bg-[#2FA37A] text-white',
  'On-Hold': 'bg-[#8A8F98] text-white',
};

export function getAssigneeAvatarColor(name: string) {
  const colors = [
    'bg-orange-500',
    'bg-blue-600',
    'bg-emerald-600',
    'bg-amber-500',
    'bg-violet-600',
    'bg-rose-600',
    'bg-cyan-600',
    'bg-indigo-600',
    'bg-teal-600',
    'bg-fuchsia-600',
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = (name || '').charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Role restrictions can arrive in any casing (Galaxy sends "DEVELOPER", the team role is "Developer"),
// or variations ("Instruction Audits" vs "Instruction Auditor"), so every comparison goes through matchesRole.
export const roleKey = (role: string) => (role || '').trim().toLowerCase();

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

export function hasRole(roles: string[], name: string): boolean {
  return (roles || []).some((r) => matchesRole(r, name));
}

export function withoutRole(roles: string[], name: string): string[] {
  return (roles || []).filter((r) => !matchesRole(r, name));
}

/** One entry per role regardless of casing, spelled like its TeamRole when there is one. */
export function normalizeRoles(roles: string[], teams?: any[]): string[] {
  const canonical = new Map<string, string>();
  (teams || []).forEach((team: any) =>
    (team.teamRoles || []).forEach((tr: any) => {
      canonical.set(roleKey(tr.name), tr.name);
      canonical.set(normalizeRoleName(tr.name), tr.name);
    })
  );
  const out = new Map<string, string>();
  roles.forEach((r) => {
    const key = normalizeRoleName(r) || roleKey(r);
    if (!out.has(key)) {
      out.set(key, canonical.get(key) ?? canonical.get(roleKey(r)) ?? r);
    }
  });
  return [...out.values()];
}

export function resolveUsersFromRoleRestrictions(roles?: string[], users?: any[], teams?: any[]): any[] {
  if (!roles || roles.length === 0) return [];
  const teamNameToTeamId = new Map<string, string>();
  (teams || []).forEach((team: any) => {
    if (team?.name && team?.id) {
      teamNameToTeamId.set(team.name.toLowerCase().trim(), team.id);
    }
  });

  return (users || []).filter((u: any) => {
    const userRoles = (u.roles || []) as string[];
    const userTeamId = u.teamId || u.team?.id;
    return roles.some((role: string) => {
      // 1. Direct role match on user's assigned roles
      if (userRoles.some((ur: string) => matchesRole(ur, role))) return true;
      // 2. Generic systemRole match (e.g. role is "ADMIN" and user is ADMIN)
      if (u.systemRole && matchesRole(u.systemRole, role)) return true;
      // 3. Whole-team match (only if the role matches the entire team's name, e.g. "Dev Team")
      const matchedTeamId = teamNameToTeamId.get(role.toLowerCase().trim());
      if (matchedTeamId && userTeamId === matchedTeamId) return true;
      return false;
    });
  });
}
