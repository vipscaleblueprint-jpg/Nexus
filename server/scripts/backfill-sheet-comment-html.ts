/**
 * Converts sheet comments saved as plain text ("👤 Leo | 📅 … | ✏️ …\n\n<message>") to the
 * one-<p>-per-line HTML the sheets endpoint now stores, so their line breaks show in Nexus.
 *
 *   npx tsx scripts/backfill-sheet-comment-html.ts           # dry run: lists what would change
 *   npx tsx scripts/backfill-sheet-comment-html.ts --apply   # writes the changes
 */
import '../src/config/env';
import { PrismaClient } from '@prisma/client';
import { plainTextToCommentHtml } from '../src/utils/commentHtml';
import { invalidateCache, redis } from '../src/services/redisService';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const candidates = await prisma.taskComment.findMany({
    where: { content: { startsWith: '👤 ', contains: ' | 📅' } },
    select: { id: true, taskId: true, content: true },
  });
  // Already-converted comments start with "<p>", so only plain-text ones are left here; skip any with HTML.
  const legacy = candidates.filter((c) => !/<[a-z][^>]*>/i.test(c.content));

  for (const c of legacy) {
    console.log(`${c.id}  ${c.content.split('\n')[0].slice(0, 90)}`);
    if (!apply) continue;
    await prisma.taskComment.update({ where: { id: c.id }, data: { content: plainTextToCommentHtml(c.content) } });
  }

  const taskIds = Array.from(new Set(legacy.map((c) => c.taskId)));
  if (apply && taskIds.length) await invalidateCache(...taskIds.map((id) => `task:${id}`));

  console.log(`\n${legacy.length} plain-text sheet comment(s) on ${taskIds.length} task(s) ${apply ? 'converted' : 'would be converted (dry run; pass --apply to write)'}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
