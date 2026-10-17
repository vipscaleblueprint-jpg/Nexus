import { randomUUID } from 'crypto';

type Block = { id: string; type: string; content: string; [key: string]: any };

// Old editors wrote a full JSON copy of each mentioned task into `data-task-data` (most of a journal page's
// size). Current editors neither write nor need it, so it is dropped on save and on load.
const MENTION_SNAPSHOT_ATTR = /\s+data-task-data=\\?"[^"]*"/g;

export function stripMentionSnapshots(content: string): string {
  if (!content || !content.includes('data-task-data=')) return content;
  const stripped = content.replace(MENTION_SNAPSHOT_ATTR, '');
  // Block-JSON pages must stay valid JSON; leave anything the pattern would break untouched
  if (content.trimStart().startsWith('[')) {
    try {
      JSON.parse(stripped);
    } catch {
      return content;
    }
  }
  return stripped;
}

const MENTION_TAG = /<span\b[^>]*\bdata-type="mention"[^>]*>/g;

/** Ids of the tasks (not subtasks or status columns) mentioned anywhere on a page. */
export function taskMentionIds(content: string | null | undefined): Set<string> {
  let html = content || '';
  try {
    const blocks = JSON.parse(html);
    if (Array.isArray(blocks)) html = blocks.map((b: any) => String(b?.content ?? '')).join('\n');
  } catch {
    // not block JSON (legacy markdown page): scan the raw text
  }
  const ids = new Set<string>();
  for (const [tag] of html.matchAll(MENTION_TAG)) {
    const id = tag.match(/\bdata-id="([^"]+)"/)?.[1];
    const type = tag.match(/\bdata-mention-type="([^"]*)"/)?.[1] || 'task';
    if (id && type === 'task') ids.add(id);
  }
  return ids;
}

const isEmptyBlock = (b: any) =>
  b?.type === 'text' && /^(<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>)?$/i.test(String(b.content ?? '').trim());
// Sections of the journal day page are delimited by h2/h3 headings (client names; older pages also have "New Tasks")
const isSectionHeading = (b: any) => b?.type === 'text' && /^<h[23]/i.test(String(b.content ?? ''));
const findHeading = (blocks: Block[], name: string) =>
  blocks.findIndex((b) =>
    b?.type === 'text' &&
    /<h[1-6]/i.test(b.content || '') &&
    b.content.replace(/<[^>]+>/g, '').trim().toLowerCase() === name.toLowerCase());

let spacerSeq = 0;
const spacerBlock = (tag: string): Block => ({ id: `blk-space-${Date.now()}-${++spacerSeq}-${tag}`, type: 'text', content: '<p></p>' });

/**
 * Puts `block` at the end of the section under `headerIndex`. The section's trailing blank line is taken
 * over when there is one (a single blank stays as the spacer below the new line, extra blanks are used up);
 * otherwise a blank spacer is added after it. Subtask lines are later inserted between the task and that
 * spacer.
 */
function appendToSection(blocks: Block[], headerIndex: number, block: Block, tag: string) {
  let end = headerIndex + 1;
  while (end < blocks.length && !isSectionHeading(blocks[end])) end++;
  let firstBlank = end;
  while (firstBlank > headerIndex + 1 && isEmptyBlock(blocks[firstBlank - 1])) firstBlank--;

  const trailingBlanks = end - firstBlank;
  if (trailingBlanks >= 2) {
    blocks.splice(firstBlank, 1, block);
  } else {
    blocks.splice(firstBlank, 0, block);
    if (trailingBlanks === 0) blocks.splice(firstBlank + 1, 0, spacerBlock(tag));
  }
}

// Orange pill after a new task's line on today's journal page: the editor's Badge mark in its Orange preset
// (frontend extensions/Badge.ts). Each rollover rebuilds the task lines from the tasks, so it stays on that day.
export const NEW_TASK_BADGE = '<span data-badge="#f57c00" style="background-color: #f57c00; color: #ffffff">NEW TASK ADDED</span>';
// Also matches the badge once the editor has re-saved it (it rewrites the inline colours), with the space before it
const NEW_TASK_BADGE_HTML = /\s*<span\b[^>]*\bdata-badge\b[^>]*>\s*NEW TASK ADDED\s*<\/span>/gi;

/** Drops NEW TASK ADDED badges from blocks carried onto another day's page. */
export function stripNewTaskBadges(blocks: Block[]): Block[] {
  return blocks.map((b) => (typeof b?.content === 'string' ? { ...b, content: b.content.replace(NEW_TASK_BADGE_HTML, '') } : b));
}

/**
 * Appends a task line to the journal day page under its client's heading. A missing client heading is created
 * after the other clients (above the "New Tasks" heading older pages still have). Mutates `blocks`.
 */
export function appendTaskToJournal(blocks: Block[], clientName: string, taskBlock: Block) {
  const tag = clientName.replace(/\s+/g, '');

  let clientIndex = findHeading(blocks, clientName);
  if (clientIndex === -1) {
    const newTasksIndex = findHeading(blocks, 'new tasks');
    clientIndex = newTasksIndex === -1 ? blocks.length : newTasksIndex;
    blocks.splice(clientIndex, 0, { id: `blk-h-${Date.now()}-${tag}`, type: 'text', content: `<h2>${clientName}</h2>` });
  }
  appendToSection(blocks, clientIndex, taskBlock, tag);
}

/**
 * An editor saves its whole copy of the page, so blocks added to the stored page after it loaded (tasks the
 * server appends to the journal, blocks from other users) would be wiped by its next save. Keep every stored
 * block the save neither contains nor lists as deleted, after its nearest stored predecessor.
 */
export function keepUnseenBlocks(storedContent: string | undefined, incomingContent: string, deletedBlockIds: string[]) {
  let stored: any[];
  let incoming: any[];
  try {
    stored = JSON.parse(storedContent || '');
    incoming = JSON.parse(incomingContent);
  } catch {
    return incomingContent; // not block JSON (legacy markdown page)
  }
  if (!Array.isArray(stored) || !Array.isArray(incoming)) return incomingContent;

  const incomingIds = new Set(incoming.map((b) => b?.id));
  const deleted = new Set(deletedBlockIds);
  const isKept = (b: any) => b?.id && !incomingIds.has(b.id) && !deleted.has(b.id);
  if (!stored.some(isKept)) return incomingContent;

  const result = [...incoming];
  stored.forEach((block, i) => {
    if (!isKept(block)) return;
    let insertAt = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = result.findIndex((b) => b?.id === stored[j]?.id);
      if (idx !== -1) {
        insertAt = idx + 1;
        break;
      }
    }
    result.splice(insertAt, 0, block);
  });
  return JSON.stringify(result);
}

/**
 * Clones an array of blocks while assigning fresh unique IDs to avoid collisions across pages.
 */
export function cloneBlocksWithNewIds(blocks: Block[], prefix = 'blk-prio'): Block[] {
  const timestamp = Date.now();
  return blocks.map((b, idx) => ({
    ...b,
    id: `${prefix}-${timestamp}-${idx}-${randomUUID().slice(0, 8)}`,
  }));
}

/**
 * Extracts the "Priorities for Today" header and content blocks from a page's block list.
 * The section is bounded by the Priorities header (inclusive) and the next section heading (exclusive).
 */
export function extractPrioritiesSection(blocks: Block[]): {
  headerBlock?: Block;
  contentBlocks: Block[];
  startIndex: number;
  endIndex: number;
} {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { contentBlocks: [], startIndex: -1, endIndex: -1 };
  }

  const startIndex = blocks.findIndex(
    (b) => b?.type === 'text' && /priorities\s+(for\s+today)?/i.test(b.content || '')
  );

  if (startIndex === -1) {
    return { contentBlocks: [], startIndex: -1, endIndex: -1 };
  }

  let endIndex = startIndex + 1;
  while (endIndex < blocks.length) {
    const b = blocks[endIndex];
    if (b?.type === 'text' && /^<h[1-6]/i.test(b.content || '')) {
      break;
    }
    endIndex++;
  }

  return {
    headerBlock: blocks[startIndex],
    contentBlocks: blocks.slice(startIndex + 1, endIndex),
    startIndex,
    endIndex,
  };
}

/**
 * Checks whether the priorities section contains custom content written or designed by the user,
 * rather than being empty or containing only "<p>No priorities</p>".
 */
export function hasCustomPriorities(blocks: Block[]): boolean {
  if (!Array.isArray(blocks) || blocks.length === 0) return false;
  return blocks.some((b) => {
    const stripped = (b?.content || '').replace(/<[^>]+>/g, '').trim().toLowerCase();
    return stripped !== '' && stripped !== 'no priorities';
  });
}

