import { spacesApi } from '@/api/spaces';

// Shared, de-duplicated cache of list statuses.
// Many components (task rows in live blocks, task mentions, the task modal) need a list's
// statuses. Fetching per-instance caused N identical full-list requests (tasks included)
// that re-fired on every store update. This keeps one in-flight request per list and
// remembers the result — including "no statuses" — so it is never re-requested in a loop.
const statusCache = new Map<string, any[]>();
const inflight = new Map<string, Promise<any[]>>();

export function fetchListStatuses(listId: string): Promise<any[]> {
  const cached = statusCache.get(listId);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(listId);
  if (pending) return pending;

  const request = spacesApi.getList(listId, true)
    .then(res => {
      const statuses = res?.list?.statuses || [];
      statusCache.set(listId, statuses);
      return statuses;
    })
    .finally(() => inflight.delete(listId));

  inflight.set(listId, request);
  return request;
}
