require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log('Running test generation...');
  const activeTasks = await prisma.task.findMany({
    where: { status: { not: 'Closed' } },
    include: { list: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' }
  });

  const clients = {};
  for (const task of activeTasks) {
    if (task.list) {
      if (!clients[task.list.name]) clients[task.list.name] = [];
      clients[task.list.name].push(task);
    }
  }

  const sortedClientNames = Object.keys(clients).sort();
  const tiptapNodes = [];

  for (const clientName of sortedClientNames) {
    const clientTasks = clients[clientName];
    if (clientTasks.length === 0) continue;

    tiptapNodes.push({
      id: lk-h-\-\,
      type: 'text',
      content: <h3>\</h3>
    });

    for (const task of clientTasks) {
      tiptapNodes.push({
        id: lk-t-\-\,
        type: 'text',
        content: <p><span data-type="mention" data-id="\" data-label="\" data-mention-type="task">@\</span></p>
      });
    }
  }

  const prioritiesHeader = {
    id: lk-\-prio-head,
    type: 'text',
    content: <h2>?? Priorities for Today</h2>
  };

  const noPrioritiesText = {
    id: lk-\-noprio,
    type: 'text',
    content: <p>No priorities</p>
  };

  const activeClientHeader = {
    id: lk-\-client-head,
    type: 'text',
    content: <h2>?? ACTIVE CLIENT</h2>
  };

  const newTasksHeader = {
    id: lk-\-new-tasks,
    type: 'text',
    content: <h3>New Tasks</h3>
  };

  const docBlocks = [
    prioritiesHeader,
    noPrioritiesText,
    activeClientHeader,
    ...tiptapNodes,
    newTasksHeader
  ];

  const contentString = JSON.stringify(docBlocks);

  const docs = await prisma.doc.findMany({ where: { isDailyRollover: true } });
  for (const doc of docs) {
    const tz = doc.rolloverTimezone || 'Asia/Singapore';
    const dateObj = new Date('2026-09-17T00:00:00Z');
    
    const monthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', year: 'numeric' });
    const monthTitle = monthFormatter.format(dateObj);
    const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', day: 'numeric', year: 'numeric' });
    const dayTitle = dayFormatter.format(dateObj);

    let monthPage = await prisma.page.findFirst({ where: { docId: doc.id, title: monthTitle, parentPageId: null } });
    if (!monthPage) {
      monthPage = await prisma.page.create({ data: { title: monthTitle, content: JSON.stringify([{ id: 'blk-m-' + Date.now(), type: 'text', content: '' }]), docId: doc.id } });
    }

    const existingDayPage = await prisma.page.findFirst({ where: { docId: doc.id, title: dayTitle, parentPageId: monthPage.id } });
    
    if (existingDayPage) {
      console.log('Deleting existing ' + dayTitle);
      await prisma.page.delete({ where: { id: existingDayPage.id } });
    }
    
    await prisma.page.create({ data: { title: dayTitle, content: contentString, docId: doc.id, parentPageId: monthPage.id } });
    console.log('Created ' + dayTitle);
  }
}
run().catch(console.error).finally(() => process.exit(0));
