import * as fs from 'fs';

const rawData = fs.readFileSync('vipscale_comments_analysis.json', 'utf-8');
const items: any[] = JSON.parse(rawData);

const target = items.find(i => i.vipComment.taskId === '4b447c22-c0e0-411c-80ea-976c300fd0d9');
if (target) {
  console.log('Task:', target.vipComment.taskTitle);
  console.log('VIP Comments on this task:');
  const vipOnThis = items.filter(i => i.vipComment.taskId === '4b447c22-c0e0-411c-80ea-976c300fd0d9');
  for (const v of vipOnThis) {
    console.log(`[VIPSCALE ${v.vipComment.id}] at ${v.vipComment.createdAt}:`);
    console.log(v.vipComment.content);
    console.log('------------------');
  }

  console.log('\nRecent siblings (last 10):');
  for (const s of target.siblings.slice(-10)) {
    console.log(`[${s.userName} (${s.id})] at ${s.createdAt}:`);
    console.log(s.content);
    console.log('---');
  }
}
