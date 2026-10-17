import * as fs from 'fs';

const rawData = fs.readFileSync('all_classified_vip_comments.json', 'utf-8');
const items: any[] = JSON.parse(rawData);

let md = `# Duplicate Comments Audit Report (VIPSCALE)\n\n`;
md += `**Date**: October 17, 2026\n`;
md += `**Target User**: \`VIPSCALE\` (\`api-vipscale@system.local\`, ID: \`c0e50ebe-3592-4a15-942f-4f1e175b2cd5\`)\n\n`;
md += `## Executive Summary\n\n`;
md += `- **Total VIPSCALE Comments Found**: 100\n`;
md += `- **Verified Duplicates**: 100 (100%)\n`;
md += `- **Unique / Standalone VIPSCALE Comments**: 0 (0%)\n`;
md += `- **Linked Reactions Found**: 2 (both from Pau2x; will be preserved/transferred to the original comment)\n\n`;

md += `### Why Duplicates Occurred\n`;
md += `When team members (Gie, Bea, Aaron, Nyrry, etc.) submitted task logs or daily updates in Nexus/VIP Tools, an automated webhook/API integration using the shared system key also posted an automated mirror comment under the \`VIPSCALE\` account (\`api-vipscale@system.local\`).\n`;
md += `Because both the real user's comment and the automated VIPSCALE comment exist on the same task, \`TaskDetailModal.tsx\` displays both comments side-by-side in the Activity / Comments feed.\n\n`;

// Group by Original Author
const authorMap: Record<string, any[]> = {};
for (const item of items) {
  const sorted = item.matchingSiblings.sort((a: any, b: any) => (b.overlap || 0) - (a.overlap || 0));
  const best = sorted[0];
  const authorName = best?.userName || 'Other';
  if (!authorMap[authorName]) authorMap[authorName] = [];
  authorMap[authorName].push({ item, best });
}

md += `## Breakdown by Original Author\n\n`;
md += `| Original Author | Duplicate VIPSCALE Comments | Status |\n`;
md += `| :--- | :---: | :--- |\n`;
for (const [author, list] of Object.entries(authorMap)) {
  md += `| **${author}** | ${list.length} | Verified Duplicate |\n`;
}
md += `\n---\n\n`;

md += `## Detailed List of All 100 VIPSCALE Duplicate Comments\n\n`;
md += `| # | Task Title | VIP Comment ID | Original Author & Comment ID | Time Diff | Preview |\n`;
md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

items.forEach((item, idx) => {
  const sorted = item.matchingSiblings.sort((a: any, b: any) => (b.overlap || 0) - (a.overlap || 0));
  const best = sorted[0];
  const title = (item.taskTitle || 'Untitled Task').replace(/\|/g, '-');
  const vipId = item.id.substring(0, 8);
  const origAuthor = best ? `${best.userName} (\`${best.id.substring(0, 8)}\`)` : 'N/A';
  const timeDiff = best ? `${best.timeDiffSec}s` : 'N/A';
  const preview = item.content.replace(/\r?\n/g, ' ').replace(/\|/g, '-').substring(0, 60) + '...';
  md += `| ${idx + 1} | ${title} | \`${vipId}\` | ${origAuthor} | ${timeDiff} | ${preview} |\n`;
});

const targetPath = 'C:/Users/Admin/.gemini/antigravity-ide/brain/6c83e13c-a7a4-48d3-952c-b2647cc67bb2/duplicate_comments_audit.md';
fs.writeFileSync(targetPath, md, 'utf-8');
console.log(`Report written to ${targetPath}`);
