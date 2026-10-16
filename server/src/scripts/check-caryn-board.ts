import { prisma } from '../config/prisma';

async function main() {
  const lists = await prisma.list.findMany({
    where: {
      name: {
        contains: 'Caryn',
        mode: 'insensitive'
      }
    },
    include: {
      statuses: {
        orderBy: { order: 'asc' }
      },
      folder: true,
      space: true,
      tasks: {
        select: {
          id: true,
          title: true,
          status: true,
          position: true
        }
      }
    }
  });

  console.log(`Found ${lists.length} lists matching 'Caryn':\n`);
  for (const list of lists) {
    console.log(`====================================================`);
    console.log(`List: "${list.name}" (ID: ${list.id})`);
    console.log(`Space: "${list.space?.name}" | Folder: "${list.folder?.name}"`);
    console.log(`customGroups (${list.customGroups.length}):`, JSON.stringify(list.customGroups));
    console.log(`\nStatuses in DB (${list.statuses.length}):`);
    for (const s of list.statuses) {
      console.log(`  - ID: ${s.id} | Name: "${s.name}" | groupName: "${s.groupName}" | color: "${s.color}" | order: ${s.order}`);
    }

    const taskCounts: Record<string, number> = {};
    for (const t of list.tasks) {
      taskCounts[t.status] = (taskCounts[t.status] || 0) + 1;
    }
    console.log(`\nTask Status Counts (${list.tasks.length} total tasks):`);
    for (const [st, count] of Object.entries(taskCounts)) {
      console.log(`  - "${st}": ${count}`);
    }

    const pendingTasks = list.tasks.filter(t => t.status.toLowerCase().includes('pending'));
    console.log(`\nSample tasks with pending status (${pendingTasks.length}):`);
    for (const pt of pendingTasks.slice(0, 10)) {
      console.log(`  - [${pt.status}] "${pt.title}"`);
    }
  }

  // Also check if there's any other list or template in the same folder to see what groups/statuses they have
  if (lists.length > 0 && lists[0].folderId) {
    const siblingLists = await prisma.list.findMany({
      where: {
        folderId: lists[0].folderId,
        id: { not: lists[0].id }
      },
      take: 2,
      include: {
        statuses: { orderBy: { order: 'asc' } }
      }
    });
    console.log(`\n================ Sibling Lists in same Folder ================`);
    for (const sib of siblingLists) {
      console.log(`Sibling: "${sib.name}" | customGroups:`, JSON.stringify(sib.customGroups));
      console.log(`Statuses:`);
      sib.statuses.forEach(s => console.log(`  - "${s.name}" -> group: "${s.groupName}"`));
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
