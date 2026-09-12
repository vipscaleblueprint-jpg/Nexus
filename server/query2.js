const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const task = await prisma.task.findUnique({ where: { id: '80d7b906-58c3-4558-b267-44fad9399faa' }, include: { list: true } });
  console.log(task);
}
main().catch(console.error).finally(() => prisma.$disconnect());
