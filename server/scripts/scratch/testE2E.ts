import { PrismaClient } from '@prisma/client';
import { createLaunchRecord, formatLaunchRecordToItem } from '../../src/services/launchMapService';

const prisma = new PrismaClient();

async function testE2E() {
  console.log('Testing LaunchRecord direct creation...');

  const list = await prisma.list.findFirst({ select: { id: true, name: true } });
  if (!list) {
    throw new Error('No list found in DB');
  }

  const tasksBefore = await prisma.task.count();

  const launch = await createLaunchRecord({
    title: 'Automated E2E Test Launch',
    listId: list.id,
    startDate: new Date('2026-12-01T12:00:00+08:00'),
    startTime: '09:00 PM',
    endDate: new Date('2026-12-02T12:00:00+08:00'),
    endTime: '10:00 PM',
    timezone: 'Asia/Manila',
    isMilestone: true,
    details: 'Scheduled Time: 09:00 PM | End: 2026-12-02 10:00 PM (Asia/Manila)',
    notes: 'End Date: 2026-12-02 10:00 PM',
  });

  console.log('Created LaunchRecord ID:', launch.id);

  const tasksAfter = await prisma.task.count();
  console.log(`Tasks before: ${tasksBefore}, Tasks after: ${tasksAfter}`);
  if (tasksBefore !== tasksAfter) {
    throw new Error('FAILED: A Nexus task was created instead of a pure LaunchRecord!');
  }

  const fetched = await prisma.launchRecord.findUnique({
    where: { id: launch.id },
    include: { list: true }
  });
  console.log('Fetched from LaunchRecord table:', fetched?.title, '| Client:', fetched?.list?.name);

  const item = formatLaunchRecordToItem(fetched);
  console.log('Formatted item effectiveLaunchDate:', item.effectiveLaunchDate, '| isLaunchDate:', item.isLaunchDate);

  await prisma.launchRecord.delete({ where: { id: launch.id } });
  console.log('Cleaned up test LaunchRecord. Verification 100% SUCCESS!');
}

testE2E()
  .catch((e) => {
    console.error('Test failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
