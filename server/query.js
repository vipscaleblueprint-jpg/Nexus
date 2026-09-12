const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const task = await prisma.task.findMany({ where: { title: 'Testing shi' } });
  console.log(task);
}
main().catch(console.error).finally(() => prisma.$disconnect());
