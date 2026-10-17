import * as fs from 'fs';

const rawData = fs.readFileSync('all_classified_vip_comments.json', 'utf-8');
const items: any[] = JSON.parse(rawData);

console.log(`Verifying ${items.length} items...`);

const report: any[] = [];

for (const item of items) {
  // Sort matching siblings by overlap desc, then timeDiffSec asc
  const sortedMatches = item.matchingSiblings.sort((a: any, b: any) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return a.timeDiffSec - b.timeDiffSec;
  });

  const best = sortedMatches[0];

  report.push({
    index: item.index,
    vipCommentId: item.id,
    taskId: item.taskId,
    taskTitle: item.taskTitle,
    vipCreatedAt: item.createdAt,
    vipSnippet: item.content.replace(/\r?\n/g, ' ').substring(0, 100) + '...',
    originalCommentId: best.id,
    originalAuthor: `${best.userName} (${best.userEmail})`,
    originalCreatedAt: best.createdAt,
    timeDiffSec: best.timeDiffSec,
    overlapPercent: best.overlap,
    originalSnippet: best.contentSnippet.replace(/\r?\n/g, ' ') + '...'
  });
}

fs.writeFileSync('full_duplicate_audit_report.json', JSON.stringify(report, null, 2), 'utf-8');

console.log('--- FIRST 10 ITEMS ---');
console.log(JSON.stringify(report.slice(0, 10), null, 2));

console.log('\n--- LAST 10 ITEMS ---');
console.log(JSON.stringify(report.slice(-10), null, 2));

// Check any with low overlap (< 60%)
const lowOverlap = report.filter(r => r.overlapPercent < 60);
console.log(`\nItems with overlap < 60%: ${lowOverlap.length}`);
if (lowOverlap.length > 0) {
  console.log(JSON.stringify(lowOverlap, null, 2));
}
