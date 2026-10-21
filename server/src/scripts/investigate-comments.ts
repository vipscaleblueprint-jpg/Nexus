import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('--- Nyrry comments ---');
  const nyrryComments = await prisma.taskComment.findMany({
    where: {
      OR: [
        { user: { name: { contains: 'Nyrr', mode: 'insensitive' } } },
        { content: { contains: 'Nyrr', mode: 'insensitive' } },
        { content: { contains: 'MA NAME' } },
        { content: { contains: '[[' } },
      ]
    },
    include: {
      user: { select: { name: true, email: true } },
      attachments: true,
      task: { select: { id: true, title: true, status: true, externalId: true } },
    },
    take: 20,
    orderBy: { createdAt: 'desc' }
  });
  console.log('Count found:', nyrryComments.length);
  for (const c of nyrryComments) {
    console.log(JSON.stringify({
      id: c.id,
      task: c.task?.title,
      externalId: c.externalId,
      user: c.user?.name,
      createdAt: c.createdAt,
      content: c.content,
      attachments: c.attachments,
    }, null, 2));
  }
}
main().finally(() => prisma.());
