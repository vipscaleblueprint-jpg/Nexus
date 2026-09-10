import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const count = await prisma.page.count();
  console.log('Total pages:', count);
  const nullTitleCount = await prisma.page.count({ where: { title: 'Untitled Page' } });
  console.log('Untitled pages:', nullTitleCount);
}

run().finally(() => prisma.$disconnect());
