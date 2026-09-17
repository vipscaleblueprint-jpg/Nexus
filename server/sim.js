const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
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
      id: `blk-h-${Date.now()}-${clientName.replace(/\s+/g, '')}`,
      type: 'text',
      content: `<h3>${clientName}</h3>`
    });

    for (const task of clientTasks) {
      tiptapNodes.push({
        id: `blk-t-${Date.now()}-${task.id}`,
        type: 'text',
        content: `<p><span data-type="mention" data-id="${task.id}" data-label="${task.title}" data-mention-type="task">@${task.title}</span></p>`
      });
    }
  }

  const prioritiesHeader = {
    id: `blk-${Date.now()}-prio-head`,
    type: 'text',
    content: `<h2>🚨 Priorities for Today</h2>`
  };

  const activeClientHeader = {
    id: `blk-${Date.now()}-active-client`,
    type: 'text',
    content: `<h2>💼 Active Client Tasks</h2>`
  };

  const newTasksHeader = {
    id: `blk-${Date.now()}-new-tasks`,
    type: 'text',
    content: `<h3>New Tasks</h3>`
  };

  const docBlocks = [
    prioritiesHeader,
    { id: `blk-${Date.now()}-empty1`, type: 'text', content: '<p></p>' },
    activeClientHeader,
    ...tiptapNodes,
    newTasksHeader
  ];

  const contentString = JSON.stringify(docBlocks);

  const docs = await prisma.doc.findMany({
    where: { isDailyRollover: true },
  });

  for (const doc of docs) {
    const dateObj = new Date('2026-09-18T00:00:00+08:00');
    const tz = doc.rolloverTimezone || 'Asia/Singapore';
    
    const monthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', year: 'numeric' });
    const monthTitle = monthFormatter.format(dateObj);

    const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', day: 'numeric', year: 'numeric' });
    const dayTitle = dayFormatter.format(dateObj);

    let monthPage = await prisma.page.findFirst({
      where: { docId: doc.id, title: monthTitle, parentPageId: null }
    });

    if (!monthPage) {
      monthPage = await prisma.page.create({
        data: {
          title: monthTitle,
          content: JSON.stringify([{ id: `blk-m-${Date.now()}`, type: 'text', content: '' }]),
          docId: doc.id,
        }
      });
    }

    const existingDayPage = await prisma.page.findFirst({
      where: { docId: doc.id, title: dayTitle, parentPageId: monthPage.id }
    });

    if (!existingDayPage) {
      await prisma.page.create({
        data: {
          title: dayTitle,
          content: contentString,
          docId: doc.id,
          parentPageId: monthPage.id
        }
      });
      console.log(`Created auto-generated Day Subpage ${dayTitle} in Doc ${doc.id}`);
    } else {
      console.log(`Page ${dayTitle} already exists!`);
    }
  }
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
