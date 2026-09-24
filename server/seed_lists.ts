import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const defaultGroupedStatuses = [
  { name: 'PIN BOARD', color: 'blue', groupName: 'CLIENT DETAILS', order: 1 },
  { name: 'DAILY', color: 'purple', groupName: 'RECURRING', order: 0 },
  { name: 'WEEKLY', color: 'blue', groupName: 'RECURRING', order: 1 },
  { name: 'MONTHLY', color: 'purple', groupName: 'RECURRING', order: 2 },
  { name: 'PENDING', color: 'orange', groupName: 'WORKFLOW & PROGRESS', order: 0 },
  { name: 'IN PROGRESS', color: 'blue', groupName: 'WORKFLOW & PROGRESS', order: 1 },
  { name: 'REVISION', color: 'rose', groupName: 'WORKFLOW & PROGRESS', order: 2 },
  { name: 'ON-HOLD', color: 'zinc', groupName: 'WORKFLOW & PROGRESS', order: 3 },
  { name: 'CLOSED', color: 'emerald', groupName: 'WORKFLOW & PROGRESS', order: 4 },
  { name: 'WAITING', color: 'orange', groupName: 'MANAGEMENT', order: 0 },
  { name: 'IN REVIEW', color: 'purple', groupName: 'MANAGEMENT', order: 1 },
  { name: 'CHECKING', color: 'teal', groupName: 'MANAGEMENT', order: 2 },
  { name: 'CRM', color: 'emerald', groupName: 'MANAGEMENT', order: 3 },
];

async function main() {
  console.log('Fetching all clients (lists)...');
  const lists = await prisma.list.findMany({
    include: { statuses: true }
  });

  for (const list of lists) {
    console.log(`Processing list (client): ${list.name}`);

    // Create the dynamic client details status
    const dynamicStatusName = (list.name || 'CLIENT').toUpperCase();
    const dynamicStatus = { name: dynamicStatusName, color: 'teal', groupName: 'CLIENT DETAILS', order: 0 };
    
    const allStatusesToSeed = [dynamicStatus, ...defaultGroupedStatuses];

    // Update List's customGroups order so the KanbanBoard renders them
    await prisma.list.update({
      where: { id: list.id },
      data: {
        customGroups: ['CLIENT DETAILS', 'RECURRING', 'WORKFLOW & PROGRESS', 'MANAGEMENT']
      }
    });

    for (const st of allStatusesToSeed) {
      const existing = list.statuses.find(s => s.name.toUpperCase() === st.name.toUpperCase());

      if (!existing) {
        // Create missing status
        await prisma.listStatus.create({
          data: {
            name: st.name,
            color: st.color,
            groupName: st.groupName,
            order: st.order,
            listId: list.id
          }
        });
        console.log(`  - Created status: ${st.name} [${st.groupName}]`);
      } else if (!existing.groupName) {
        // Update existing status that has no groupName
        await prisma.listStatus.update({
          where: { id: existing.id },
          data: { groupName: st.groupName, order: st.order, color: st.color }
        });
        console.log(`  - Updated existing status to group: ${st.name} -> [${st.groupName}]`);
      }
    }
  }

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
