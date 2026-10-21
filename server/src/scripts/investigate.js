const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Searching comments ---');
  const comments = await prisma.taskComment.findMany({
    where: {
      OR: [
        { user: { name: { contains: 'Nyrr', mode: 'insensitive' } } },
        { content: { contains: 'Nyrr', mode: 'insensitive' } },
        { content: { contains: 'MA' } },
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
  console.log('Count found:', comments.length);
  for (const c of comments) {
    console.log('--- Comment ---');
    console.log('ID:', c.id);
    console.log('Task:', c.task ? c.task.title : 'none', 'Status:', c.task ? c.task.status : 'none', 'ExternalId:', c.task ? c.task.externalId : 'none');
    console.log('User:', c.user ? c.user.name : 'none');
    console.log('CreatedAt:', c.createdAt);
    console.log('Content:', c.content);
    console.log('Attachments:', JSON.stringify(c.attachments));
  }
}
main().then(() => prisma['']());
