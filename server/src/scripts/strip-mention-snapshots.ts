/**
 * One-time cleanup: removes the `data-task-data="…"` snapshot that task mentions used to embed in
 * saved doc HTML (the full task incl. subtasks, comments and checklists, repeated per mention).
 * The editor no longer writes it, so only existing Page and PageVersion rows need stripping.
 *
 * Dry run (default, read-only — reports what would change):
 *   npx tsx src/scripts/strip-mention-snapshots.ts
 * Apply (back up the database first):
 *   npx tsx src/scripts/strip-mention-snapshots.ts --apply
 *
 * Rows are updated with raw SQL so `updatedAt` (shown as "last modified") is left untouched.
 */
import { prisma } from '../config/prisma';

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 20; // journal pages can be several MB each
const MARKER = 'data-task-data';

// Matches ` data-task-data="…"` in plain HTML and ` data-task-data=\"…\"` inside JSON-encoded block
// content. Attribute values never contain a raw `"` (the serializer escapes them as &quot;), so the
// match stops at the closing quote and leaves the surrounding string balanced.
const ATTR_PATTERN = /\s+data-task-data=\\?"[^"]*"/g;

function isJson(value: string) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/** Returns the stripped content, or null if stripping would leave it malformed. */
function strip(content: string): string | null {
  const stripped = content.replace(ATTR_PATTERN, '');
  if (isJson(content) && !isJson(stripped)) return null;
  return stripped;
}

type Table = 'Page' | 'PageVersion';

async function fetchBatch(table: Table, afterId: string) {
  const where = { content: { contains: MARKER }, id: { gt: afterId } };
  const args = { where, orderBy: { id: 'asc' as const }, take: BATCH_SIZE, select: { id: true, content: true } };
  return table === 'Page' ? prisma.page.findMany(args) : prisma.pageVersion.findMany(args);
}

async function writeRow(table: Table, id: string, content: string) {
  if (table === 'Page') {
    await prisma.$executeRaw`UPDATE "Page" SET "content" = ${content} WHERE "id" = ${id}`;
  } else {
    await prisma.$executeRaw`UPDATE "PageVersion" SET "content" = ${content} WHERE "id" = ${id}`;
  }
}

async function processTable(table: Table) {
  let afterId = '';
  let rows = 0;
  let skipped = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (;;) {
    const batch = await fetchBatch(table, afterId);
    if (batch.length === 0) break;

    for (const row of batch) {
      afterId = row.id;
      const stripped = strip(row.content);
      if (stripped === null) {
        skipped++;
        console.warn(`  [${table}] ${row.id}: skipped, stripping would break its JSON`);
        continue;
      }
      if (stripped === row.content) continue;

      rows++;
      bytesBefore += Buffer.byteLength(row.content);
      bytesAfter += Buffer.byteLength(stripped);
      if (APPLY) await writeRow(table, row.id, stripped);
    }
  }

  const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
  console.log(
    `${table}: ${rows} row(s) ${APPLY ? 'cleaned' : 'would be cleaned'}, ` +
      `${mb(bytesBefore)} MB -> ${mb(bytesAfter)} MB` +
      (skipped ? `, ${skipped} skipped` : ''),
  );
}

async function main() {
  console.log(APPLY ? 'APPLY mode: rows will be updated.' : 'DRY RUN: nothing will be written (pass --apply to update).');
  await processTable('Page');
  await processTable('PageVersion');
}

main()
  .catch((err) => {
    console.error('strip-mention-snapshots failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
