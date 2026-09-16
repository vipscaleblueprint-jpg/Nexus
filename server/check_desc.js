const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tasks = await prisma.task.findMany({ 
    select: { id: true, title: true, description: true },
    where: { description: { not: null, not: '' } } 
  });
  console.log("Last 5 task descriptions:");
  console.log(JSON.stringify(tasks.slice(-5), null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
