/**
 * One-time backfill of TaskNotification.subtaskId for notifications created before the column existed.
 *
 *   npx tsx scripts/backfill-notification-subtask.ts          # dry run: report what would change
 *   npx tsx scripts/backfill-notification-subtask.ts --apply  # write the changes
 *
 * Resolution order per notification (first hit wins):
 *   1. Title names the subtask: "... on/to/from subtask <title>" (longest subtask title wins)
 *   2. Comment notifications (MENTION/COMMENT/REPLY/REACTION): the subtask comment they point at,
 *      matched the same way getNotifications matches them (author/reactor, preview text, 24h window)
 *   3. CHECKLIST_ITEM_ASSIGNED: the quoted item text belongs to exactly one subtask checklist
 * Notifications that resolve to nothing stay NULL (they open the parent task, as before).
 */
import '../src/config/env';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Copy of src/utils/mentionNotification.ts#toNotificationPreview — importing that module pulls in
// src/server.ts (for `io`) and would boot the whole server.
function toNotificationPreview(content: string, maxLength = 100): string {
  const text = (content || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|li|div|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const truncated = text.length > maxLength ? `${text.substring(0, maxLength)}…` : text;
  return truncated.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const APPLY = process.argv.includes('--apply');
const COMMENT_TYPES = new Set(['MENTION', 'COMMENT', 'REPLY', 'REACTION']);
const DAY_MS = 24 * 60 * 60 * 1000;

// Lowercase, drop leading dashes on every word run ("--Audit" -> "audit"), collapse whitespace
const normName = (s: string) => s.toLowerCase().replace(/(^|\s)-+/g, '$1').replace(/\s+/g, ' ').trim();

async function main() {
  const notifs = await prisma.taskNotification.findMany({
    where: { subtaskId: null, taskId: { not: null } },
    select: { id: true, taskId: true, userId: true, actorId: true, type: true, title: true, content: true, createdAt: true },
  });
  const taskIds = Array.from(new Set(notifs.map(n => n.taskId as string)));
  console.log(`${notifs.length} notifications without subtaskId across ${taskIds.length} tasks`);
  if (notifs.length === 0) return;

  const [subtasks, subtaskComments, subtaskItems] = await Promise.all([
    prisma.subtask.findMany({ where: { taskId: { in: taskIds } }, select: { id: true, taskId: true, title: true } }),
    prisma.taskComment.findMany({
      where: { taskId: { in: taskIds }, subtaskId: { not: null } },
      select: {
        taskId: true, subtaskId: true, userId: true, content: true, parentCommentId: true, createdAt: true,
        reactions: { select: { userId: true } },
      },
    }),
    prisma.checklistItem.findMany({
      where: { checklist: { subtaskId: { not: null }, subtask: { taskId: { in: taskIds } } } },
      select: { text: true, checklist: { select: { subtaskId: true, subtask: { select: { taskId: true } } } } },
    }),
  ]);

  const group = <T,>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = key(r);
      const list = m.get(k);
      if (list) list.push(r);
      else m.set(k, [r]);
    }
    return m;
  };
  const subtasksByTask = group(subtasks, s => s.taskId);
  const commentsByTask = group(subtaskComments, c => c.taskId);
  const itemsByTask = group(subtaskItems, i => i.checklist.subtask!.taskId);

  const updates = new Map<string, string[]>(); // subtaskId -> notification ids
  const counts = { title: 0, comment: 0, checklist: 0, unresolved: 0 };

  for (const n of notifs) {
    const taskId = n.taskId as string;
    const title = (n.title || '').toLowerCase();
    const type = (n.type || '').toUpperCase();
    let resolved: string | null = null;

    // 1. Subtask named in the title. Old titles use several shapes — `on subtask X`,
    // `changed subtask "X" status`, `assigned to a subtask: X`, `auditing on "X"` — and the leading
    // "--" on subtask names isn't always kept, so compare dash-stripped names anywhere in the title.
    // Only this task's subtasks are candidates; the longest name wins ("Edit video thumbnail" over "Edit video").
    const normTitle = normName(title);
    let best: { id: string; name: string } | null = null;
    // Only titles that say "subtask": task-level titles can contain a subtask's name inside the task title
    for (const s of title.includes('subtask') ? subtasksByTask.get(taskId) || [] : []) {
      const name = normName(s.title || '');
      if (name.length < 3) continue;
      if (normTitle.includes(name) && (!best || name.length > best.name.length)) best = { id: s.id, name };
    }
    if (best) { resolved = best.id; counts.title++; }

    // 2. Comment notifications pointing at a subtask comment
    if (!resolved && (COMMENT_TYPES.has(type) || title.includes('comment') || title.includes('replied'))) {
      const preview = n.content?.trim();
      const nTime = n.createdAt.getTime();
      const match = (commentsByTask.get(taskId) || []).find(c => {
        if (type === 'REACTION') {
          if (c.userId !== n.userId) return false;
          if (n.actorId && !c.reactions.some(r => r.userId === n.actorId)) return false;
        } else {
          if (n.actorId && c.userId !== n.actorId) return false;
          // Reactions can be added long after the comment; everything else is created with it
          if (Math.abs(nTime - c.createdAt.getTime()) > DAY_MS) return false;
        }
        if (type === 'REPLY' && !c.parentCommentId) return false;
        if (preview) {
          const cPreview = toNotificationPreview(c.content);
          const ok = cPreview === preview || (preview.endsWith('…') && cPreview.startsWith(preview.slice(0, -1)));
          if (!ok) return false;
        }
        return true;
      });
      if (match?.subtaskId) { resolved = match.subtaskId; counts.comment++; }
    }

    // 3. Checklist item assignment on a subtask checklist (only when unambiguous)
    if (!resolved && type === 'CHECKLIST_ITEM_ASSIGNED') {
      const quoted = (n.title || '').match(/"([^"]+)"/)?.[1]?.trim().toLowerCase();
      if (quoted) {
        const ids = new Set(
          (itemsByTask.get(taskId) || [])
            .filter(i => i.text.trim().toLowerCase() === quoted)
            .map(i => i.checklist.subtaskId as string)
        );
        if (ids.size === 1) { resolved = Array.from(ids)[0]; counts.checklist++; }
      }
    }

    if (resolved) {
      const list = updates.get(resolved);
      if (list) list.push(n.id);
      else updates.set(resolved, [n.id]);
    } else if (title.includes('subtask')) {
      counts.unresolved++;
    }
  }

  const total = counts.title + counts.comment + counts.checklist;
  console.log(`Resolved ${total}: ${counts.title} by title, ${counts.comment} by comment, ${counts.checklist} by checklist item`);
  console.log(`Unresolved notifications that mention a subtask (renamed/deleted subtasks): ${counts.unresolved}`);

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to save.');
    return;
  }

  let written = 0;
  for (const [subtaskId, ids] of updates) {
    const res = await prisma.taskNotification.updateMany({
      where: { id: { in: ids }, subtaskId: null },
      data: { subtaskId },
    });
    written += res.count;
  }
  console.log(`\nUpdated ${written} notifications.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
