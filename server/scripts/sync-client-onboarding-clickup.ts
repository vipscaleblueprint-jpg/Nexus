import { prisma } from '../src/config/prisma';
import {
  createClickUpTask,
  createClickUpChecklist,
  createClickUpChecklistItem,
  getClickUpListTasks,
  mapNexusStatusToClickUp,
  mapNexusPriorityToClickUp,
  resolveClickUpListId,
} from '../src/services/clickupService';

async function syncClientToClickUp(clientName: string, clickUpListId: string) {
  console.log(`\n========================================`);
  console.log(`Syncing client "${clientName}" -> ClickUp List ${clickUpListId}`);
  console.log(`========================================`);

  // 1. Find Nexus list
  const nexusList = await prisma.list.findFirst({
    where: { name: { equals: clientName, mode: 'insensitive' } },
    include: {
      tasks: {
        include: {
          checklists: {
            include: { items: true },
          },
        },
      },
    },
  });

  if (!nexusList) {
    console.error(`Nexus list for "${clientName}" not found.`);
    return;
  }

  // Ensure clickUpListId is set on Nexus list
  if (nexusList.clickUpListId !== clickUpListId) {
    await prisma.list.update({
      where: { id: nexusList.id },
      data: { clickUpListId },
    });
    console.log(`Updated Nexus list ${nexusList.id} clickUpListId -> ${clickUpListId}`);
  }

  // 2. Fetch existing tasks in ClickUp
  console.log(`Fetching existing tasks in ClickUp list ${clickUpListId}...`);
  const cuRes = await getClickUpListTasks(clickUpListId, 0, true);
  const cuTasks = cuRes?.tasks || [];
  const cuTaskMap = new Map<string, any>();
  for (const t of cuTasks) {
    if (t.name) {
      cuTaskMap.set(t.name.trim().toLowerCase(), t);
    }
  }
  console.log(`Found ${cuTasks.length} existing tasks in ClickUp list.`);

  // 3. Loop over Nexus tasks
  for (const task of nexusList.tasks) {
    const normTitle = task.title.trim().toLowerCase();
    let cuTask = cuTaskMap.get(normTitle);

    if (cuTask) {
      console.log(`[EXISTS IN CLICKUP] "${task.title}" (ClickUp ID: ${cuTask.id})`);
      if (task.externalId !== cuTask.id) {
        await prisma.task.update({
          where: { id: task.id },
          data: { externalId: cuTask.id },
        });
        console.log(`  -> Linked Nexus task ${task.id} externalId -> ${cuTask.id}`);
      }
      continue;
    }

    // Task does not exist in ClickUp -> create it!
    console.log(`[CREATING IN CLICKUP] "${task.title}"...`);
    try {
      const cuPayload = {
        name: task.title,
        description: task.description || undefined,
        status: mapNexusStatusToClickUp(task.status),
        priority: mapNexusPriorityToClickUp(task.priority),
      };

      const created = await createClickUpTask(clickUpListId, cuPayload);
      if (created && created.id) {
        console.log(`  -> Created in ClickUp! ID: ${created.id} URL: ${created.url}`);
        await prisma.task.update({
          where: { id: task.id },
          data: { externalId: created.id },
        });

        // Sync checklists
        if (task.checklists && task.checklists.length > 0) {
          for (const cl of task.checklists) {
            try {
              const clId = await createClickUpChecklist(created.id, cl.name);
              if (clId && cl.items && cl.items.length > 0) {
                for (const item of cl.items) {
                  await createClickUpChecklistItem(clId, item.text);
                }
              }
              console.log(`  -> Synced checklist "${cl.name}" (${cl.items.length} items)`);
            } catch (clErr) {
              console.error(`  -> Failed to create checklist "${cl.name}":`, clErr);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`  -> Error creating ClickUp task "${task.title}":`, err?.message || err);
    }
  }

  console.log(`Finished syncing "${clientName}".`);
}

async function main() {
  // Sync Mason first
  await syncClientToClickUp('Mason', '1100300000012635');

  console.log('\nAll done!');
}

main().finally(() => prisma.$disconnect());
