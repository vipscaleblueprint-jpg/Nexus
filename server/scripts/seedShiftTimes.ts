import { prisma } from '../src/config/prisma';
import { importShiftTimesFromSheet } from '../src/services/shiftTimeSync';

async function main() {
  const result = await importShiftTimesFromSheet({ updatedBy: 'seed-script', pushToTools: false });
  console.log('Seeded UserShiftTime from Google Sheet Column X:', JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error('Failed to seed shift times:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
