import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function main() {
  await prisma.$connect();

  // Find Gie's user
  const gie = await prisma.user.findFirst({
    where: { name: { contains: 'gie', mode: 'insensitive' } }
  });
  console.log('Gie user:', gie?.id, gie?.name, gie?.email);

  // Find all comments by VIPSCALE (api-vipscale@system.local)
  const vipscaleComments = await prisma.taskComment.findMany({
    where: { userId: 'c0e50ebe-3592-4a15-942f-4f1e175b2cd5' },
    include: {
      task: { select: { id: true, title: true } },
      subtask: { select: { id: true, title: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`Total VIPSCALE comments: ${vipscaleComments.length}`);

  // Find which of these tasks also have comments by Gie
  for (const vc of vipscaleComments) {
    const siblings = await prisma.taskComment.findMany({
      where: {
        taskId: vc.taskId,
        subtaskId: vc.subtaskId,
        id: { not: vc.id }
      },
      include: {
        user: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    const hasGie = siblings.some(s => s.user.id === gie?.id || s.user.name.toLowerCase().includes('gie'));
    if (hasGie) {
      console.log(`\n=================== TASK WITH GIE & VIPSCALE ===================`);
      console.log(`Task ID: ${vc.taskId} | Title: ${vc.task?.title}`);
      console.log(`Subtask ID: ${vc.subtaskId} | Title: ${vc.subtask?.title}`);
      console.log(`\nVIPSCALE Comment (${vc.id}) created at ${vc.createdAt}:`);
      console.log(vc.content);
      console.log(`\nSibling comments on this task:`);
      for (const s of siblings) {
        console.log(`--- [${s.user.name} (${s.user.email})] ID: ${s.id} at ${s.createdAt}:`);
        console.log(s.content);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
