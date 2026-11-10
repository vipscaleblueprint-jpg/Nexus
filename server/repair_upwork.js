require('dotenv').config({ path: __dirname + '/.env' });
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function repair() {
  console.log('1. Repairing 56d7be64-0edd-4e72-8ab6-f24114d2b2b5...');
  const rec1 = await prisma.taskMapRecord.findUnique({
    where: { taskId: '56d7be64-0edd-4e72-8ab6-f24114d2b2b5' }
  });
  if (rec1 && rec1.pmReviews) {
    let revs = rec1.pmReviews;
    if (typeof revs === 'string') {
      try { revs = JSON.parse(revs); } catch { revs = []; }
    }
    const updated = (revs || []).map(r => {
      if (r.type === 'SHEET_PROGRESS') {
        return { ...r, timeOut: r.timeOut || '02:20 PM', isUpwork: false };
      }
      if (r.type === 'UPWORK_SESSION') {
        return { ...r, active: false, stoppedAt: r.stoppedAt || new Date().toISOString() };
      }
      return r;
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "TaskMapRecord" SET "pmReviews" = $1::jsonb, "updatedAt" = NOW() WHERE "taskId" = $2`,
      JSON.stringify(updated),
      '56d7be64-0edd-4e72-8ab6-f24114d2b2b5'
    );
    console.log('56d7be64 updated successfully.');
  }

  console.log('2. Repairing c538761f-cc7f-4fd3-baa1-2cc3a5705c7b...');
  const rec2 = await prisma.taskMapRecord.findUnique({
    where: { taskId: 'c538761f-cc7f-4fd3-baa1-2cc3a5705c7b' }
  });
  if (rec2 && rec2.pmReviews) {
    let revs = rec2.pmReviews;
    if (typeof revs === 'string') {
      try { revs = JSON.parse(revs); } catch { revs = []; }
    }
    const updated = (revs || []).map(r => {
      if (r.type === 'SHEET_PROGRESS') {
        return { ...r, timeOut: r.timeOut || '07:08 PM', isUpwork: false };
      }
      if (r.type === 'UPWORK_SESSION') {
        return { ...r, active: false, stoppedAt: r.stoppedAt || new Date().toISOString() };
      }
      return r;
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "TaskMapRecord" SET "pmReviews" = $1::jsonb, "updatedAt" = NOW() WHERE "taskId" = $2`,
      JSON.stringify(updated),
      'c538761f-cc7f-4fd3-baa1-2cc3a5705c7b'
    );
    console.log('c538761f updated successfully.');
  }

  console.log('3. Cleaning Redis task_map:upwork_active...');
  await redis.del('task_map:upwork_active');
  console.log('task_map:upwork_active deleted.');

  await prisma['$disconnect']();
  await redis.quit();
  console.log('Repair complete!');
}

repair().catch(console.error);

