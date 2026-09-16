const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tasks = await prisma.task.findMany({ select: { id: true, description: true } });
  const tasksWithAttachment = tasks.filter(t => t.description && t.description.includes('attachment-block'));
  console.log("Tasks with attachment-block:");
  console.log(JSON.stringify(tasksWithAttachment, null, 2));

  const subtasks = await prisma.subtask.findMany({ select: { id: true, description: true } });
  const subtasksWithAttachment = subtasks.filter(t => t.description && t.description.includes('attachment-block'));
  console.log("Subtasks with attachment-block:");
  console.log(JSON.stringify(subtasksWithAttachment, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
