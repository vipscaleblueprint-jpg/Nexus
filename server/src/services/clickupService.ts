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

const MAX_RATE_LIMIT_RETRIES = 3;

/** How long to wait after a 429 — until X-RateLimit-Reset (unix seconds), clamped to 1–60s. */
function rateLimitDelayMs(res: Response): number {
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (!reset) return 10_000;
  return Math.min(Math.max(reset * 1000 - Date.now(), 1000), 60_000);
}

async function clickupFetch(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('ClickUp API key not configured (Clickup_API_KEY)');
  }

  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`${CLICKUP_API_BASE}${path}`, {
        ...options,
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
    } catch (err) {
      // Network-level failure ("fetch failed"): back off and try again.
      if (attempt >= MAX_RATE_LIMIT_RETRIES) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      continue;
    }
    if (res.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) break;
    await new Promise((resolve) => setTimeout(resolve, rateLimitDelayMs(res)));
  }

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

function htmlToClickupMarkdown(html: string | undefined): string | undefined {
  if (!html) return html;
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<p>/gi, '')
    .replace(/<\/p>/gi, '')
    .replace(/<li>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<strong>/gi, '**')
    .replace(/<\/strong>/gi, '**')
    .replace(/<em>/gi, '*')
    .replace(/<\/em>/gi, '*')
    .replace(/<[^>]+>/g, '') // strip any other tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarkdownToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * Converts a ClickUp markdown_description into the HTML the Nexus description
 * editor stores. Covers what ClickUp/n8n descriptions use: headings, bullet and
 * numbered lists, rules, bold/italic/code/links and plain paragraphs.
 */
export function clickupMarkdownToHtml(markdown: string | undefined | null): string {
  if (!markdown) return '';
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.map(inlineMarkdownToHtml).join('<br>')}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const rawLine of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(heading[1].length, 3);
      out.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      closeList();
      out.push('<hr>');
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const item = bullet ?? numbered;
    if (item) {
      flushParagraph();
      const type = bullet ? 'ul' : 'ol';
      if (list !== type) {
        closeList();
        out.push(`<${type}>`);
        list = type;
      }
      // ClickUp checklist bullets ("- [ ] x") read as plain list items here.
      out.push(`<li>${inlineMarkdownToHtml(item[1].replace(/^\[[ xX]\]\s+/, ''))}</li>`);
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  return out.join('');
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
    priority?: number | null; // 1=urgent 2=high 3=normal 4=low
    due_date?: number; // unix ms
    start_date?: number;
    assignees?: number[];
  }
): Promise<any> {
  const finalPayload: any = { ...payload };
  if (payload.description !== undefined) {
    let md = htmlToClickupMarkdown(payload.description);
    if (!md || md.trim() === '') md = ' ';
    finalPayload.markdown_description = md;
    delete finalPayload.description;
  }
  return clickupFetch(`/list/${listId}/task`, {
    method: 'POST',
    body: JSON.stringify(finalPayload),
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
    priority?: number | null;
    due_date?: number | null;
    start_date?: number | null;
    /** ClickUp user ids to add to / remove from the task's assignees */
    assignees?: { add: number[]; rem: number[] };
  }
): Promise<any> {
  const finalPayload: any = { ...payload };
  if (payload.description !== undefined) {
    let md = htmlToClickupMarkdown(payload.description);
    if (!md || md.trim() === '') md = ' ';
    finalPayload.markdown_content = md;
    delete finalPayload.description;
  }
  return clickupFetch(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(finalPayload),
  });
}

export async function deleteClickUpTask(taskId: string): Promise<any> {
  const id = extractClickUpTaskId(taskId);
  return clickupFetch(`/task/${id}`, {
    method: 'DELETE',
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
export async function deleteClickUpComment(commentId: string): Promise<any> {
  return clickupFetch(`/comment/${commentId}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Checklist Operations
// ---------------------------------------------------------------------------

/**
 * Fetches a full ClickUp task object (which includes its checklists array).
 * Use this to discover existing checklist IDs by name.
 */
export async function getClickUpTask(taskId: string): Promise<any> {
  const id = extractClickUpTaskId(taskId);
  return clickupFetch(`/task/${id}?include_subtasks=true&include_markdown_description=true`);
}

/**
 * One page (up to 100) of a list's tasks, subtasks and closed tasks included.
 * Response: { tasks: [...], last_page: boolean }
 */
export async function getClickUpListTasks(
  listId: string,
  page: number,
  includeClosed = true,
  /** Only tasks updated after this time (unix ms). */
  updatedSince?: number
): Promise<any> {
  const since = updatedSince ? `&date_updated_gt=${updatedSince}` : '';
  return clickupFetch(
    `/list/${listId}/task?page=${page}&subtasks=true&include_closed=${includeClosed}&archived=false${since}`
  );
}

/**
 * Up to 25 comments on a task, newest first. Pass the oldest comment seen so far
 * as `start` to get the next older page. Response: { comments: [...] }
 */
export async function getClickUpTaskComments(
  taskId: string,
  start?: { date: string; id: string }
): Promise<any> {
  const id = extractClickUpTaskId(taskId);
  const qs = start ? `?start=${start.date}&start_id=${start.id}` : '';
  return clickupFetch(`/task/${id}/comment${qs}`);
}

/** Threaded replies of a comment. Response: { comments: [...] } */
export async function getClickUpCommentReplies(commentId: string): Promise<any> {
  return clickupFetch(`/comment/${commentId}/reply`);
}

/**
 * Given a Nexus taskExternalId and a checklist name, find the ClickUp checklist ID.
 * Looks up the task in ClickUp and finds the first checklist matching the name.
 */
export async function findClickUpChecklistByName(
  taskExternalId: string,
  checklistName: string
): Promise<string | null> {
  try {
    const task = await getClickUpTask(taskExternalId);
    const checklists: any[] = task?.checklists ?? [];
    const match = checklists.find(
      (c: any) => (c.name || '').toLowerCase() === checklistName.toLowerCase()
    );
    return match?.id ?? null;
  } catch (err) {
    console.error('[ClickUp] findClickUpChecklistByName error:', err);
    return null;
  }
}

/**
 * Given a Nexus parent task externalId and a subtask title, find the ClickUp subtask ID.
 * Looks up the parent task in ClickUp and finds the first subtask matching the name.
 */
export async function findClickUpSubtaskByName(
  parentTaskExternalId: string,
  subtaskTitle: string
): Promise<string | null> {
  try {
    const task = await getClickUpTask(parentTaskExternalId);
    const subtasks: any[] = task?.subtasks ?? [];
    const match = subtasks.find(
      (s: any) => (s.name || '').toLowerCase() === subtaskTitle.toLowerCase()
    );
    return match?.id ?? null;
  } catch (err) {
    console.error('[ClickUp] findClickUpSubtaskByName error:', err);
    return null;
  }
}

/** Creates a checklist on a ClickUp task. Returns the ClickUp checklist id or null. */
export async function createClickUpChecklist(taskId: string, name: string): Promise<string | null> {
  const result = await clickupFetch(`/task/${taskId}/checklist`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  // ClickUp v2 returns: { checklist: { id, name, orderindex, resolved, unresolved, items: [] } }
  return result?.checklist?.id ?? null;
}

/** Renames a ClickUp checklist. */
export async function updateClickUpChecklist(checklistId: string, name: string): Promise<any> {
  return clickupFetch(`/checklist/${checklistId}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

/** Deletes a ClickUp checklist. */
export async function deleteClickUpChecklist(checklistId: string): Promise<any> {
  return clickupFetch(`/checklist/${checklistId}`, { method: 'DELETE' });
}

/**
 * Creates an item inside a ClickUp checklist.
 * Returns the new checklist_item id or null.
 * ClickUp v2 POST /checklist/:id/checklist_item returns the full updated checklist object:
 * { checklist: { id, name, items: [{ id, name, ... }] } }
 */
export async function createClickUpChecklistItem(
  checklistId: string,
  name: string
): Promise<string | null> {
  const result = await clickupFetch(`/checklist/${checklistId}/checklist_item`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  // Find the newly created item — it will be the last one with matching name
  const items: any[] = result?.checklist?.items ?? [];
  // Find last item matching name (most recently added)
  const match = [...items].reverse().find((i: any) => i.name === name);
  return match?.id ?? items[items.length - 1]?.id ?? null;
}

/** Updates a checklist item (name, resolved/unresolved). */
export async function updateClickUpChecklistItem(
  checklistId: string,
  itemId: string,
  payload: { name?: string; resolved?: boolean }
): Promise<any> {
  return clickupFetch(`/checklist/${checklistId}/checklist_item/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/** Deletes a checklist item. */
export async function deleteClickUpChecklistItem(
  checklistId: string,
  itemId: string
): Promise<any> {
  return clickupFetch(`/checklist/${checklistId}/checklist_item/${itemId}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Subtask Operations (ClickUp subtasks are tasks with a parent)
// ---------------------------------------------------------------------------

/** Creates a subtask under a ClickUp parent task. */
export async function createClickUpSubtask(
  listId: string,
  parentTaskId: string,
  payload: { name: string; description?: string; status?: string; priority?: number | null; assignees?: number[] }
): Promise<any> {
  const finalPayload: any = { ...payload, parent: parentTaskId };
  if (payload.description !== undefined) {
    let md = htmlToClickupMarkdown(payload.description);
    if (!md || md.trim() === '') md = ' ';
    finalPayload.markdown_description = md;
    delete finalPayload.description;
  }
  return clickupFetch(`/list/${listId}/task`, {
    method: 'POST',
    body: JSON.stringify(finalPayload),
  });
}

// ---------------------------------------------------------------------------
// Safe wrappers for Checklists (fire-and-forget)
// ---------------------------------------------------------------------------

export async function safeCreateClickUpChecklist(
  clickUpTaskId: string | null | undefined,
  name: string
): Promise<string | null> {
  if (!clickUpTaskId || !getApiKey()) return null;
  try {
    const id = extractClickUpTaskId(clickUpTaskId);
    // createClickUpChecklist now returns the id directly (string | null)
    return await createClickUpChecklist(id, name);
  } catch (err) {
    console.error('[ClickUp] safeCreateClickUpChecklist error:', err);
    return null;
  }
}

export async function safeUpdateClickUpChecklist(
  clickUpChecklistId: string | null | undefined,
  name: string
): Promise<void> {
  if (!clickUpChecklistId || !getApiKey()) return;
  try {
    await updateClickUpChecklist(clickUpChecklistId, name);
  } catch (err) {
    console.error('[ClickUp] safeUpdateClickUpChecklist error:', err);
  }
}

export async function safeDeleteClickUpChecklist(
  clickUpChecklistId: string | null | undefined
): Promise<void> {
  if (!clickUpChecklistId || !getApiKey()) return;
  try {
    await deleteClickUpChecklist(clickUpChecklistId);
  } catch (err) {
    console.error('[ClickUp] safeDeleteClickUpChecklist error:', err);
  }
}

export async function safeCreateClickUpChecklistItem(
  clickUpChecklistId: string | null | undefined,
  name: string
): Promise<string | null> {
  if (!clickUpChecklistId || !getApiKey()) return null;
  try {
    // createClickUpChecklistItem now returns the item id directly (string | null)
    return await createClickUpChecklistItem(clickUpChecklistId, name);
  } catch (err) {
    console.error('[ClickUp] safeCreateClickUpChecklistItem error:', err);
    return null;
  }
}

export async function safeUpdateClickUpChecklistItem(
  clickUpChecklistId: string | null | undefined,
  clickUpItemId: string | null | undefined,
  payload: { name?: string; resolved?: boolean }
): Promise<void> {
  if (!clickUpChecklistId || !clickUpItemId || !getApiKey()) return;
  try {
    await updateClickUpChecklistItem(clickUpChecklistId, clickUpItemId, payload);
  } catch (err) {
    console.error('[ClickUp] safeUpdateClickUpChecklistItem error:', err);
  }
}

export async function safeDeleteClickUpChecklistItem(
  clickUpChecklistId: string | null | undefined,
  clickUpItemId: string | null | undefined
): Promise<void> {
  if (!clickUpChecklistId || !clickUpItemId || !getApiKey()) return;
  try {
    await deleteClickUpChecklistItem(clickUpChecklistId, clickUpItemId);
  } catch (err) {
    console.error('[ClickUp] safeDeleteClickUpChecklistItem error:', err);
  }
}

export async function safeCreateClickUpSubtask(
  clickUpListId: string | null | undefined,
  clickUpParentTaskId: string | null | undefined,
  payload: Parameters<typeof createClickUpSubtask>[2]
): Promise<string | null> {
  if (!clickUpListId || !clickUpParentTaskId || !getApiKey()) return null;
  try {
    const parentId = extractClickUpTaskId(clickUpParentTaskId);
    const result = await createClickUpSubtask(clickUpListId, parentId, payload);
    return result?.id ?? null;
  } catch (err) {
    console.error('[ClickUp] safeCreateClickUpSubtask error:', err);
    return null;
  }
}


export async function safeDeleteClickUpTask(
  clickUpTaskId: string | null | undefined
): Promise<void> {
  if (!clickUpTaskId || !getApiKey()) return;
  try {
    await deleteClickUpTask(clickUpTaskId);
  } catch (err) {
    console.error('[ClickUp] safeDeleteClickUpTask error:', err);
  }
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
export function mapNexusPriorityToClickUp(nexusPriority: string | null | undefined): number | null {
  if (!nexusPriority) return null;
  switch (nexusPriority.toUpperCase()) {
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
 * The ClickUp list a Nexus list is mapped to: the clickUpListId column, or the
 * legacy "cu:<id>" value older mappings wrote into List.externalId.
 */
export function resolveClickUpListId(
  list: { clickUpListId?: string | null; externalId?: string | null } | null | undefined
): string | null {
  if (list?.clickUpListId) return list.clickUpListId;
  return list?.externalId?.startsWith('cu:') ? list.externalId.slice(3) : null;
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

// ---------------------------------------------------------------------------
// Assignees — Nexus users and ClickUp members are matched by email, the same way the
// inbound ClickUp → Nexus sync matches them.
// ---------------------------------------------------------------------------

const MEMBER_CACHE_TTL_MS = 10 * 60 * 1000;
let memberCache: { at: number; byEmail: Map<string, number> } | null = null;

/** Lowercase email → ClickUp user id, across every workspace the API key can see. Cached. */
async function getClickUpMemberIdsByEmail(forceRefresh = false): Promise<Map<string, number>> {
  if (!forceRefresh && memberCache && Date.now() - memberCache.at < MEMBER_CACHE_TTL_MS) {
    return memberCache.byEmail;
  }
  const data = await getWorkspaces();
  const byEmail = new Map<string, number>();
  for (const team of data?.teams ?? []) {
    for (const member of team?.members ?? []) {
      const user = member?.user;
      const email = typeof user?.email === 'string' ? user.email.toLowerCase() : '';
      if (email && typeof user.id === 'number') byEmail.set(email, user.id);
    }
  }
  memberCache = { at: Date.now(), byEmail };
  return byEmail;
}

const normalizeEmails = (emails: Array<string | null | undefined>) =>
  Array.from(new Set(emails.filter((e): e is string => typeof e === 'string' && !!e.trim()).map((e) => e.trim().toLowerCase())));

/**
 * Maps Nexus user emails to ClickUp user ids. Emails with no ClickUp member are skipped
 * (and logged) rather than failing the whole sync. Never throws.
 */
export async function resolveClickUpAssigneeIds(emails: Array<string | null | undefined>): Promise<number[]> {
  const wanted = normalizeEmails(emails);
  if (wanted.length === 0 || !getApiKey()) return [];
  try {
    let byEmail = await getClickUpMemberIdsByEmail();
    // Someone may have joined ClickUp since the cache was filled — refresh once (at most every minute)
    if (wanted.some((e) => !byEmail.has(e)) && memberCache && Date.now() - memberCache.at > 60_000) {
      byEmail = await getClickUpMemberIdsByEmail(true);
    }
    const missing = wanted.filter((e) => !byEmail.has(e));
    if (missing.length > 0) {
      console.warn(`[ClickUp] Not assigned in ClickUp — no ClickUp member with email: ${missing.join(', ')}`);
    }
    return wanted.map((e) => byEmail.get(e)).filter((id): id is number => id !== undefined);
  } catch (err) {
    console.error('[ClickUp] resolveClickUpAssigneeIds error:', err);
    return [];
  }
}

/**
 * Pushes a Nexus assignee change to an existing ClickUp task (or subtask).
 * Adds every current Nexus assignee ClickUp is missing (which also heals assignments made before
 * this sync existed) and removes only the people Nexus removed — ClickUp-only assignees are kept.
 */
export async function safeSyncClickUpAssignees(
  clickUpTaskId: string | null | undefined,
  previousEmails: Array<string | null | undefined>,
  nextEmails: Array<string | null | undefined>
): Promise<void> {
  if (!clickUpTaskId || !getApiKey()) return;
  try {
    const id = extractClickUpTaskId(clickUpTaskId);
    const next = normalizeEmails(nextEmails);
    const removedEmails = normalizeEmails(previousEmails).filter((e) => !next.includes(e));

    const [cuTask, nextIds, removedIds] = await Promise.all([
      getClickUpTask(id),
      resolveClickUpAssigneeIds(next),
      resolveClickUpAssigneeIds(removedEmails),
    ]);
    const current = new Set<number>((cuTask?.assignees ?? []).map((a: any) => Number(a?.id)).filter((n: number) => !isNaN(n)));

    const add = nextIds.filter((uid) => !current.has(uid));
    const rem = removedIds.filter((uid) => current.has(uid) && !nextIds.includes(uid));
    if (add.length === 0 && rem.length === 0) return;

    await updateClickUpTask(id, { assignees: { add, rem } });
    console.log(`[ClickUp] Assignees synced for ${id}: +${add.length} / -${rem.length}`);
  } catch (err) {
    console.error('[ClickUp] safeSyncClickUpAssignees error:', err);
  }
}

/**
 * Safely posts a comment to ClickUp.
 */
export async function safeCreateClickUpComment(
  clickUpTaskId: string | null | undefined,
  commentText: string
): Promise<string | null> {
  if (!clickUpTaskId || !getApiKey()) return null;
  try {
    // Normalise: support both full URL and bare ID
    const id = extractClickUpTaskId(clickUpTaskId);
    const res = await createClickUpComment(id, commentText);
    return res?.id || null;
  } catch (err) {
    console.error('[ClickUp] safeCreateClickUpComment error:', err);
    return null;
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
