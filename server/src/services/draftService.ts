import { redis, isRedisReady } from './redisService';
import { createLogger, errMsg } from '../config/logger';

const log = createLogger('draftService');

export interface TaskDraft {
  id: string; // e.g. `task:${taskId}` or `task:${taskId}:sub:${subtaskId}`
  taskId: string;
  taskTitle: string;
  subtaskId?: string | null;
  subtaskTitle?: string | null;
  comment?: string;
  description?: string;
  type: 'comment' | 'task';
  updatedAt: string;
  userId: string;
}

// In-Memory Fallback Map: userId -> Map<draftId, TaskDraft>
const inMemoryDrafts = new Map<string, Map<string, TaskDraft>>();

const DRAFT_TTL_SECONDS = 30 * 24 * 3600; // 30 days

export function getDraftKey(userId: string): string {
  return `drafts:user:${userId}`;
}

export async function saveDraft(userId: string, draft: TaskDraft): Promise<TaskDraft> {
  const normalizedDraft: TaskDraft = {
    ...draft,
    userId,
    updatedAt: new Date().toISOString(),
  };

  // 1. In-memory fallback
  if (!inMemoryDrafts.has(userId)) {
    inMemoryDrafts.set(userId, new Map());
  }
  inMemoryDrafts.get(userId)!.set(normalizedDraft.id, normalizedDraft);

  // 2. Redis Hash persistence
  if (isRedisReady()) {
    try {
      const key = getDraftKey(userId);
      await redis
        .multi()
        .hset(key, normalizedDraft.id, JSON.stringify(normalizedDraft))
        .expire(key, DRAFT_TTL_SECONDS)
        .exec();
    } catch (err) {
      log.warn({ err }, `saveDraft failed in Redis, using in-memory: ${errMsg(err)}`);
    }
  }

  return normalizedDraft;
}

export async function getUserDrafts(userId: string): Promise<TaskDraft[]> {
  if (isRedisReady()) {
    try {
      const key = getDraftKey(userId);
      const rawMap = await redis.hgetall(key);
      if (rawMap && Object.keys(rawMap).length > 0) {
        const drafts: TaskDraft[] = [];
        for (const raw of Object.values(rawMap)) {
          try {
            drafts.push(JSON.parse(raw));
          } catch {
            // ignore malformed entries
          }
        }
        drafts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return drafts;
      }
    } catch (err) {
      log.warn({ err }, `getUserDrafts failed in Redis, falling back to in-memory: ${errMsg(err)}`);
    }
  }

  const userMap = inMemoryDrafts.get(userId);
  if (!userMap) return [];
  const drafts = Array.from(userMap.values());
  drafts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return drafts;
}

export async function deleteDraft(userId: string, draftId: string): Promise<boolean> {
  // 1. In-memory
  const userMap = inMemoryDrafts.get(userId);
  if (userMap) {
    userMap.delete(draftId);
  }

  // 2. Redis
  if (isRedisReady()) {
    try {
      const key = getDraftKey(userId);
      await redis.hdel(key, draftId);
    } catch (err) {
      log.warn({ err }, `deleteDraft failed in Redis: ${errMsg(err)}`);
    }
  }
  return true;
}

export async function deleteDraftByTask(
  userId: string,
  taskId: string,
  subtaskId?: string | null
): Promise<number> {
  const drafts = await getUserDrafts(userId);
  let removedCount = 0;

  for (const draft of drafts) {
    const matchesTask = draft.taskId === taskId;
    const matchesSubtask = subtaskId !== undefined
      ? (subtaskId ? draft.subtaskId === subtaskId : !draft.subtaskId)
      : true;
    if (matchesTask && matchesSubtask) {
      await deleteDraft(userId, draft.id);
      removedCount++;
    }
  }

  return removedCount;
}

