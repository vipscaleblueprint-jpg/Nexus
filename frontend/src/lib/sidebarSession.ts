// The sidebar starts each login (or new tab) with folders collapsed, except Client Dashboard. This
// sessionStorage flag records that this tab already did that reset, so a reload keeps what the user opened.
export const SIDEBAR_SESSION_KEY = 'nexus-sidebar-session';

/** Make the next sidebar mount start fresh. Called from the login page. */
export function resetSidebarSession() {
  try {
    sessionStorage.removeItem(SIDEBAR_SESSION_KEY);
  } catch {
    // Storage unavailable: the sidebar just keeps its remembered state.
  }
}
