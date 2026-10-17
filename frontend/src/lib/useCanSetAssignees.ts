import { useEffect } from 'react';
import { authApi } from '@/api';
import { useAppStore } from '@/lib/store';
import { isProjectManagerOrAdmin, getAssignDeniedMessage } from '@/lib/permissions';

// currentUser.roles is only fetched once per session, so a user promoted to Project Manager after
// logging in would stay locked out. When the cached roles say "not a PM", re-read them from the DB.
const RECHECK_INTERVAL_MS = 30_000;
let recheckInFlight = false;
let lastRecheckAt = 0;

function recheckRolesFromDb() {
  // Every board card mounts this hook — share one request and throttle repeats
  if (recheckInFlight || Date.now() - lastRecheckAt < RECHECK_INTERVAL_MS) return;
  recheckInFlight = true;
  authApi
    .getMe()
    .then(({ user }) => {
      const { currentUser, setCurrentUser } = useAppStore.getState();
      if (!user || !currentUser || user.id !== currentUser.id) return;
      const rolesChanged =
        user.systemRole !== currentUser.systemRole ||
        JSON.stringify(user.roles || []) !== JSON.stringify(currentUser.roles || []);
      // Only replace currentUser when something changed, so nothing keyed on it re-runs needlessly
      if (rolesChanged) setCurrentUser({ ...currentUser, systemRole: user.systemRole, roles: user.roles || [] });
    })
    .catch(() => { })
    .finally(() => {
      recheckInFlight = false;
      lastRecheckAt = Date.now();
    });
}

/** Whether the current user can set Team Role and Assignees (Project Managers and Admins only). */
export function useCanSetAssignees(): boolean {
  const userId = useAppStore((s) => s.currentUser?.id);
  const allowed = useAppStore((s) => isProjectManagerOrAdmin(s.currentUser));

  useEffect(() => {
    if (userId && !allowed) recheckRolesFromDb();
  }, [userId, allowed]);

  return allowed;
}

let rolesRequested = false;

/** "You can't change this. Only <PM role as written in the DB> and Admins can…" */
export function useAssignDeniedMessage(): string {
  // Select the string itself so cards only re-render if the message text actually changes
  const message = useAppStore((s) => getAssignDeniedMessage(s.workspaceRoles));

  useEffect(() => {
    // The Priorities page doesn't load workspace roles itself; loadRoles shares one request
    if (rolesRequested) return;
    rolesRequested = true;
    const { hydrateRolesFromCache, loadRoles } = useAppStore.getState();
    hydrateRolesFromCache();
    loadRoles();
  }, []);

  return message;
}
