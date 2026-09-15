import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_STATUSES: { name: string; color: string; groupName: string | null }[] = [
  { name: 'KYC', color: 'cyan', groupName: 'Client Details' },
  { name: 'Pin Board', color: 'blue', groupName: 'Client Details' },
  { name: 'Daily', color: 'purple', groupName: 'Recurring' },
  { name: 'Weekly', color: 'indigo', groupName: 'Recurring' },
  { name: 'Monthly', color: 'violet', groupName: 'Recurring' },
  { name: 'Pending', color: 'amber', groupName: 'Workflow & Progress' },
  { name: 'In Progress', color: 'blue', groupName: 'Workflow & Progress' },
  { name: 'Revision', color: 'rose', groupName: 'Workflow & Progress' },
  { name: 'Waiting', color: 'orange', groupName: 'Workflow & Progress' },
  { name: 'In Review', color: 'purple', groupName: 'Workflow & Progress' },
  { name: 'Checking', color: 'teal', groupName: 'Workflow & Progress' },
  { name: 'On-Hold', color: 'zinc', groupName: 'Workflow & Progress' },
  { name: 'Closed', color: 'emerald', groupName: 'Workflow & Progress' },
];

async function main() {
  const lists = await prisma.list.findMany({ select: { id: true, name: true } });
  console.log(`Found ${lists.length} list(s). Seeding default statuses...`);

  for (const list of lists) {
    console.log(`\nProcessing list: ${list.name} (${list.id})`);
    const existing = await prisma.listStatus.findMany({
      where: { listId: list.id },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((s: any) => s.name.toLowerCase()));

    for (const status of DEFAULT_STATUSES) {
      if (!existingNames.has(status.name.toLowerCase())) {
        await prisma.listStatus.create({
          data: {
            name: status.name,
            color: status.color,
            groupName: status.groupName,
            allowedRoles: [],
            listId: list.id,
          },
        });
        console.log(`  Created: ${status.name} (${status.groupName})`);
      } else {
        console.log(`  Skipped (exists): ${status.name}`);
      }
    }
  }

  console.log('\nDone!');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
