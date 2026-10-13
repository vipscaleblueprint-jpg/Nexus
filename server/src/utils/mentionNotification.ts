import { prisma } from '../config/prisma';
import { io } from '../server';

// Comment editors encode user mentions as <a href="mention://<userId>">@Name</a>
const MENTION_HREF_RE = /mention:\/\/([A-Za-z0-9_-]+)/g;

export function extractMentionedUserIds(content: string): string[] {
  const ids = new Set<string>();
  for (const match of (content || '').matchAll(MENTION_HREF_RE)) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

/**
 * Plain-text preview for notification bodies. Notification content is rendered as HTML
 * by the bell and Activity page, so storing truncated raw comment HTML would leave
 * broken tags and dead mention:// anchors.
 */
export function toNotificationPreview(content: string, maxLength = 100): string {
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
  // Re-escape since consumers inject this with dangerouslySetInnerHTML
  return truncated.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Creates MENTION notifications for the given users and pings their personal socket room
 * so the bell count and Activity page update live. Ignores the actor, unknown and inactive users.
 * Returns the IDs that were actually notified.
 */
export async function notifyMentionedUsers(params: {
  userIds: string[];
  actorId: string;
  actorName?: string | null;
  taskId: string;
  content: string;
  isSubtask?: boolean;
}): Promise<string[]> {
  const { userIds, actorId, actorName, taskId, content, isSubtask } = params;
  const candidates = Array.from(new Set(userIds)).filter(id => id && id !== actorId);
  if (candidates.length === 0) return [];

  const validUsers = await prisma.user.findMany({
    where: { id: { in: candidates }, isActive: true },
    select: { id: true },
  });
  const recipients = validUsers.map(u => u.id);
  if (recipients.length === 0) return [];

  const where = isSubtask ? 'a subtask comment' : 'a comment';
  await prisma.taskNotification.createMany({
    data: recipients.map(id => ({
      userId: id,
      actorId,
      taskId,
      type: 'MENTION',
      title: `${actorName || 'Someone'} mentioned you in ${where}`,
      content: toNotificationPreview(content),
    })),
  });
  recipients.forEach(id => {
    io.to(`user:${id}`).emit('notification_received');
  });
  return recipients;
}
