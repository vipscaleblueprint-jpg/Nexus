import { prisma } from '../config/prisma';

type Orderable = { position: number | null; createdAt: Date | string };

// Board order: an explicit position wins, otherwise the task sorts by creation time.
// Using the createdAt epoch as the fallback lets positioned tasks interleave with legacy ones.
export const taskSortKey = (t: Orderable) => t.position ?? new Date(t.createdAt).getTime();

export const compareTaskOrder = (a: Orderable, b: Orderable) => taskSortKey(a) - taskSortKey(b);

// Position that slots a new task directly after `afterTaskId` within its list.
// Returns null when the anchor is the last task, since creation time already puts the new task last.
export async function getPositionAfter(listId: string, afterTaskId: string): Promise<number | null> {
  const tasks = await prisma.task.findMany({
    where: { listId },
    select: { id: true, position: true, createdAt: true },
  });
  const anchor = tasks.find((t) => t.id === afterTaskId);
  if (!anchor) return null;

  const anchorKey = taskSortKey(anchor);
  let nextKey = Infinity;
  for (const t of tasks) {
    const key = taskSortKey(t);
    if (t.id !== afterTaskId && key > anchorKey && key < nextKey) nextKey = key;
  }
  return nextKey === Infinity ? null : (anchorKey + nextKey) / 2;
}
