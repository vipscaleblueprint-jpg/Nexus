/**
 * clickupService.ts
 *
 * Centralised wrapper for the ClickUp v2 REST API.
 * All methods are designed to be called asynchronously and must never
 * throw — callers fire-and-forget so that a ClickUp failure never
 * degrades the Nexus API response time.
 */

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

function getApiKey(): string | null {
  return process.env.Clickup_API_KEY || process.env.CLICKUP_API_KEY || null;
}

async function clickupFetch(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('ClickUp API key not configured (Clickup_API_KEY)');
  }

  const res = await fetch(`${CLICKUP_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ClickUp API error ${res.status}: ${body}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Workspace / Auth
// ---------------------------------------------------------------------------

/** Returns the authenticated user & their teams (workspaces). */
export async function getAuthorizedUser(): Promise<any> {
  return clickupFetch('/user');
}

/** Returns all workspaces (teams) for the API key owner. */
export async function getWorkspaces(): Promise<any> {
  return clickupFetch('/team');
}

/** Returns all spaces inside a workspace. */
export async function getSpaces(teamId: string): Promise<any> {
  return clickupFetch(`/team/${teamId}/space?archived=false`);
}

/** Returns all folders inside a space. */
export async function getFolders(spaceId: string): Promise<any> {
  return clickupFetch(`/space/${spaceId}/folder?archived=false`);
}

/** Returns all lists inside a folder. */
export async function getListsInFolder(folderId: string): Promise<any> {
  return clickupFetch(`/folder/${folderId}/list?archived=false`);
}

/** Returns all folderless lists inside a space. */
export async function getFolderlessLists(spaceId: string): Promise<any> {
  return clickupFetch(`/space/${spaceId}/list?archived=false`);
}

// ---------------------------------------------------------------------------
// Task Operations
// ---------------------------------------------------------------------------

/**
 * Creates a task in a ClickUp list.
 * Returns the created task (which contains the ClickUp task id).
 */
export async function createClickUpTask(
  listId: string,
  payload: {
    name: string;
    description?: string;
    status?: string;
    priority?: number; // 1=urgent 2=high 3=normal 4=low
    due_date?: number; // unix ms
    start_date?: number;
    assignees?: number[];
  }
): Promise<any> {
  return clickupFetch(`/list/${listId}/task`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Updates an existing ClickUp task.
 * Only fields that are defined in `payload` will be sent.
 */
export async function updateClickUpTask(
  taskId: string,
  payload: {
    name?: string;
    description?: string;
    status?: string;
    priority?: number;
    due_date?: number | null;
    start_date?: number | null;
  }
): Promise<any> {
  return clickupFetch(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/**
 * Posts a comment on a ClickUp task.
 */
export async function createClickUpComment(
  taskId: string,
  commentText: string,
  notify_all = false
): Promise<any> {
  return clickupFetch(`/task/${taskId}/comment`, {
    method: 'POST',
    body: JSON.stringify({ comment_text: commentText, notify_all }),
  });
}

/**
 * Returns a single ClickUp task.
 */
export async function getClickUpTask(taskId: string): Promise<any> {
  return clickupFetch(`/task/${taskId}`);
}

// ---------------------------------------------------------------------------
// Status helper
// ---------------------------------------------------------------------------

/**
 * Maps a Nexus status string to a ClickUp-friendly status name.
 * ClickUp statuses must already exist in the target list; this just normalises
 * the casing to lower-case (ClickUp is case-insensitive for status names).
 */
export function mapNexusStatusToClickUp(nexusStatus: string): string {
  return nexusStatus.toLowerCase();
}

/**
 * Maps a Nexus priority to a ClickUp numeric priority.
 * ClickUp: 1=urgent, 2=high, 3=normal, 4=low
 */
export function mapNexusPriorityToClickUp(nexusPriority: string): number {
  switch (nexusPriority?.toUpperCase()) {
    case 'URGENT': return 1;
    case 'HIGH': return 2;
    case 'MEDIUM': return 3;
    case 'LOW': return 4;
    default: return 3;
  }
}

// ---------------------------------------------------------------------------
// Safe wrappers (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Extracts the bare ClickUp task ID from either a raw ID string or a full URL.
 * e.g. 'https://app.clickup.com/t/z8py7ac5gx' → 'z8py7ac5gx'
 *      'z8py7ac5gx'                            → 'z8py7ac5gx'
 */
export function extractClickUpTaskId(value: string): string {
  if (!value) return value;
  // If it looks like a URL, extract the last path segment
  if (value.startsWith('http')) {
    const parts = value.split('/');
    return parts[parts.length - 1] || value;
  }
  return value;
}

/**
 * Safely syncs a task creation to ClickUp.
 * Returns the ClickUp task id or null if sync failed / not configured.
 */
export async function safeCreateClickUpTask(
  listId: string | null | undefined,
  payload: Parameters<typeof createClickUpTask>[1]
): Promise<string | null> {
  if (!listId || !getApiKey()) return null;
  try {
    const result = await createClickUpTask(listId, payload);
    return result?.id ?? null;
  } catch (err) {
    console.error('[ClickUp] safeCreateClickUpTask error:', err);
    return null;
  }
}

/**
 * Safely syncs a task update to ClickUp.
 */
export async function safeUpdateClickUpTask(
  clickUpTaskId: string | null | undefined,
  payload: Parameters<typeof updateClickUpTask>[1]
): Promise<void> {
  if (!clickUpTaskId || !getApiKey()) return;
  try {
    // Normalise: support both full URL and bare ID
    const id = extractClickUpTaskId(clickUpTaskId);
    await updateClickUpTask(id, payload);
  } catch (err) {
    console.error('[ClickUp] safeUpdateClickUpTask error:', err);
  }
}

/**
 * Safely posts a comment to ClickUp.
 */
export async function safeCreateClickUpComment(
  clickUpTaskId: string | null | undefined,
  commentText: string
): Promise<void> {
  if (!clickUpTaskId || !getApiKey()) return;
  try {
    // Normalise: support both full URL and bare ID
    const id = extractClickUpTaskId(clickUpTaskId);
    await createClickUpComment(id, commentText);
  } catch (err) {
    console.error('[ClickUp] safeCreateClickUpComment error:', err);
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testConnection(): Promise<{ ok: boolean; user?: any; error?: string }> {
  try {
    const data = await getAuthorizedUser();
    return { ok: true, user: data?.user };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
