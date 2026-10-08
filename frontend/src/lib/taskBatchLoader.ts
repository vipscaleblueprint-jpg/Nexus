import { tasksApi } from '@/api/tasks';

// Coalesces per-task fetches into a single POST /api/tasks/batch.
// A doc with dozens of task mentions used to fire one GET /api/tasks/:id per mention, which the
// browser's ~6-connection limit turned into a slow, sequential trickle. Every call made in the
// same tick is now grouped into one request.
type Result = { task: any; subtask?: any };
type Pending = { resolve: (r: Result) => void; reject: (e: unknown) => void };

const MAX_BATCH = 200;
const queue = new Map<string, Pending[]>();
const inflight = new Map<string, Promise<Result>>();
let scheduled = false;

async function flush() {
  scheduled = false;
  const entries = Array.from(queue.entries());
  queue.clear();

  for (let i = 0; i < entries.length; i += MAX_BATCH) {
    const chunk = entries.slice(i, i + MAX_BATCH);
    try {
      const { results } = await tasksApi.batchGetTasks(chunk.map(([id]) => id));
      chunk.forEach(([id, waiters]) => {
        const r = results?.[id];
        waiters.forEach(w => (r ? w.resolve(r) : w.reject(new Error('Task not found'))));
      });
    } catch (err) {
      chunk.forEach(([, waiters]) => waiters.forEach(w => w.reject(err)));
    }
  }
}

export function loadTask(id: string): Promise<Result> {
  const existing = inflight.get(id);
  if (existing) return existing;

  const promise = new Promise<Result>((resolve, reject) => {
    const waiters = queue.get(id) || [];
    waiters.push({ resolve, reject });
    queue.set(id, waiters);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 10);
    }
  }).finally(() => inflight.delete(id));

  inflight.set(id, promise);
  return promise;
}
