const redis = require('ioredis');
const client = new redis(process.env.REDIS_URL || 'redis://localhost:6379');
async function main() {
  const keys = await client.keys('cache:spaces:*');
  const keys2 = await client.keys('cache:dashboard:*');
  const keys3 = await client.keys('cache:tasks:*');
  const all = [...keys, ...keys2, ...keys3];
  if (all.length > 0) {
    await client.del(...all);
    console.log('Flushed keys:', all);
  } else {
    console.log('No matching cache keys found');
  }
  client.disconnect();
}
main().catch(console.error);
