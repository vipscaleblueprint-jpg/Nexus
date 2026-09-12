import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  console.log('Cleaning up broken daily rollover pages...');
  const deleted = await prisma.page.deleteMany({
    where: {
      title: { in: ['September 8, 2026', 'September 9, 2026'] }
    }
  });
  
  // also delete today's page if it matches formatter
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Singapore',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  const todayTitle = formatter.format(new Date());
  const deletedToday = await prisma.page.deleteMany({
    where: { title: todayTitle }
  });
  
  console.log(`Deleted ${deleted.count} historical pages and ${deletedToday.count} today pages.`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
