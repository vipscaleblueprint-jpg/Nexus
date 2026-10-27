import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { invalidateCache } from '../services/redisService';

const prisma = new PrismaClient();

const STATUS_COLOR_REVERT_MAP: Record<string, string> = {
  KYC: '#3A8F55',
  Kyc: '#3A8F55',
  'PIN BOARD': '#1F8A6E',
  'Pin Board': '#1F8A6E',
  PIN_BOARD: '#1F8A6E',
  DAILY: '#2F7BD0',
  Daily: '#2F7BD0',
  WEEKLY: '#2F7BD0',
  Weekly: '#2F7BD0',
  MONTHLY: '#2F7BD0',
  Monthly: '#2F7BD0',
  PENDING: '#D29A2A',
  Pending: '#D29A2A',
  'IN PROGRESS': '#D04A7C',
  'In Progress': '#D04A7C',
  IN_PROGRESS: '#D04A7C',
  REVISION: '#5B6BD6',
  Revision: '#5B6BD6',
  'ON-HOLD': '#8A8F98',
  'On-Hold': '#8A8F98',
  ON_HOLD: '#8A8F98',
  WAITING: '#D9534F',
  Waiting: '#D9534F',
  'IN REVIEW': '#D97B3A',
  'In Review': '#D97B3A',
  CHECKING: '#A35DB8',
  Checking: '#A35DB8',
  CRM: '#22A3AE',
  Crm: '#22A3AE',
  CLOSED: '#2FA37A',
  Closed: '#2FA37A',
};

async function revertStatusColors() {
  console.log('Reverting status colors in the database to their original colors...');

  let totalUpdated = 0;
  for (const [name, color] of Object.entries(STATUS_COLOR_REVERT_MAP)) {
    const res = await prisma.listStatus.updateMany({
      where: {
        name: { equals: name, mode: 'insensitive' }
      },
      data: { color }
    });
    if (res.count > 0) {
      console.log(`Reverted ${name} -> ${color} (${res.count} updated)`);
      totalUpdated += res.count;
    }
  }

  console.log(`Total statuses reverted: ${totalUpdated}`);

  try {
    await invalidateCache('spaces:all', 'dashboard:all', 'lists:all', 'tasks:all');
    console.log('Redis cache invalidated successfully.');
  } catch (err: any) {
    console.warn('Cache invalidation error (proceeding):', err.message);
  }
}

revertStatusColors()
  .catch((err) => {
    console.error('Error reverting status colors:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
