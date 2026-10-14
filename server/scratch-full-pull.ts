import 'dotenv/config';
import { runClickUpSync, ClickUpSyncSummary } from './src/services/clickupSyncService';
import { prisma } from './src/config/prisma';

const log = (...a: any[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_ROUNDS = 4;

(async () => {
  let listIds: string[] | undefined;
  const totals = { tasksCreated: 0, tasksUpdated: 0, subtasks: 0, comments: 0, attachments: 0 };
  let last: ClickUpSyncSummary | null = null;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    log(`=== Round ${round}: full pull of ${listIds ? listIds.length + ' list(s) with problems' : 'all mapped lists'} ===`);
    let live: ClickUpSyncSummary | null = null;
    let reported = 0;
    const ticker = setInterval(() => {
      if (!live) return;
      for (const r of live.listResults.slice(reported)) {
        log(`  ${r.name}: checked ${r.checked}, created ${r.created}, updated ${r.updated}, subtasks ${r.subtasks}, retried ${r.retried}, failed ${r.failed}`);
      }
      reported = live.listResults.length;
      log(`  ...now on: ${live.currentList ?? '-'} (${reported}/${live.lists} lists, comments ${live.comments})`);
    }, 30_000);
    try {
      last = await runClickUpSync({ full: true, includeClosed: true, nexusListIds: listIds, onProgress: (s) => (live = s) });
    } catch (err: any) {
      clearInterval(ticker);
      log(`Pull crashed: ${err.message}. Waiting 60s and retrying.`);
      await sleep(60_000);
      continue;
    }
    clearInterval(ticker);
    for (const r of last.listResults.slice(reported)) {
      log(`  ${r.name}: checked ${r.checked}, created ${r.created}, updated ${r.updated}, subtasks ${r.subtasks}, retried ${r.retried}, failed ${r.failed}`);
    }
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += (last as any)[k];
    log(`Round ${round} done: lists ${last.lists}, errors ${last.errors.length}`);
    last.errors.forEach((e) => log('  ERROR', e));

    const badNames = new Set(last.listResults.filter((r) => r.failed > 0).map((r) => r.name));
    if (badNames.size === 0) break;
    const lists = await prisma.list.findMany({ where: { name: { in: [...badNames] } }, select: { id: true } });
    listIds = lists.map((l) => l.id);
    if (round < MAX_ROUNDS) {
      log(`${badNames.size} list(s) had failures: ${[...badNames].join(', ')}. Waiting 60s before re-pulling them.`);
      await sleep(60_000);
    }
  }
  log('=== FINAL ===', JSON.stringify(totals), 'unmatched users:', JSON.stringify(last?.unmatchedUsers ?? []));
  log('Remaining failures:', JSON.stringify(last?.listResults.filter((r) => r.failed > 0) ?? []));
  await prisma.$disconnect();
  process.exit(0);
})();
