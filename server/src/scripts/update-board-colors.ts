import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { invalidateCache } from '../services/redisService';

const prisma = new PrismaClient();

const TARGET_GROUPS = [
  'Client Details',
  'CLIENT DETAILS',
  'Recurring',
  'RECURRING',
  'Workflow & Progress',
  'WORKFLOW & PROGRESS',
];

const TARGET_STATUS_NAMES = [
  'KYC',
  'PIN BOARD',
  'Pin Board',
  'DAILY',
  'Daily',
  'WEEKLY',
  'Weekly',
  'MONTHLY',
  'Monthly',
  'PENDING',
  'Pending',
  'IN PROGRESS',
  'In Progress',
  'REVISION',
  'Revision',
  'ON-HOLD',
  'On-Hold',
];

async function updateBoardColors() {
  console.log('Fetching statuses to update to grey (#8A8F98)...');

  const result = await prisma.listStatus.updateMany({
    where: {
      OR: [
        { groupName: { in: TARGET_GROUPS } },
        { name: { in: TARGET_STATUS_NAMES } }
      ]
    },
    data: {
      color: '#8A8F98'
    }
  });

  console.log(`Updated ${result.count} list statuses to grey (#8A8F98).`);

  try {
    await invalidateCache('spaces:all', 'dashboard:all', 'lists:all', 'tasks:all');
    console.log('Redis cache invalidated successfully.');
  } catch (err: any) {
    console.warn('Cache invalidation warning (proceeding):', err.message);
  }
}

updateBoardColors()
  .catch((err) => {
    console.error('Error updating board colors:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
