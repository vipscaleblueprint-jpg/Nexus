import { prisma } from '../config/prisma';

/**
 * Page content is always written whole: the editor and the journal auto-append both read the page, change it and
 * write it back, so two writers racing would silently drop one change (e.g. a task appended while someone saves).
 * Writes are made conditional on the page's updatedAt still being the one the writer read; on a mismatch the writer
 * re-reads and re-applies its change. The uncontended case costs the same single UPDATE as before (no transaction or
 * row lock held across the ~190 ms round trips to the database).
 *
 * The new updatedAt is always later than the one it replaces, so a client revalidating with ?since= can never miss
 * a write that landed in the same millisecond as the one it has cached.
 */

const MAX_ATTEMPTS = 5;

/** Writes `data` if the page is unchanged since `expected` was read. Returns the new updatedAt, or null on a conflict. */
export async function writePageIfUnchanged(
  pageId: string,
  expected: Date,
  data: { content: string; title?: string },
): Promise<Date | null> {
  const updatedAt = new Date(Math.max(Date.now(), expected.getTime() + 1));
  const { count } = await prisma.page.updateMany({
    where: { id: pageId, updatedAt: expected },
    data: { ...data, updatedAt },
  });
  return count > 0 ? updatedAt : null;
}

type Block = { id: string; type: string; content: string; [key: string]: any };

/**
 * Applies `mutate` to the page's blocks and saves them, re-reading and retrying if the page changed meanwhile.
 * `snapshot` (the page as the caller already read it) saves the first read. `mutate` gets a fresh array on every
 * attempt and returns false when there is nothing to change. Returns whether the page was written.
 */
export async function updatePageBlocks(
  snapshot: { id: string; content: string; updatedAt: Date },
  mutate: (blocks: Block[]) => boolean | void,
): Promise<boolean> {
  let page: { content: string; updatedAt: Date } | null = snapshot;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      page = await prisma.page.findUnique({ where: { id: snapshot.id }, select: { content: true, updatedAt: true } });
    }
    if (!page) return false;

    let blocks: unknown;
    try {
      blocks = JSON.parse(page.content);
    } catch {
      return false; // not block JSON (legacy markdown page): never overwrite it
    }
    if (!Array.isArray(blocks)) return false;
    if (mutate(blocks) === false) return false;

    if (await writePageIfUnchanged(snapshot.id, page.updatedAt, { content: JSON.stringify(blocks) })) return true;
  }
  throw new Error(`Page ${snapshot.id} kept changing during ${MAX_ATTEMPTS} attempts; update skipped`);
}
