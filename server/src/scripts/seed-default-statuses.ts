import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_STATUSES: { name: string; color: string; groupName: string | null }[] = [
  { name: 'KYC', color: '#3A8F55', groupName: 'Client Details' },
  { name: 'Pin Board', color: '#1F8A6E', groupName: 'Client Details' },
  { name: 'Daily', color: '#2F7BD0', groupName: 'Recurring' },
  { name: 'Weekly', color: '#2F7BD0', groupName: 'Recurring' },
  { name: 'Monthly', color: '#2F7BD0', groupName: 'Recurring' },
  { name: 'Pending', color: '#D29A2A', groupName: 'Workflow & Progress' },
  { name: 'In Progress', color: '#D04A7C', groupName: 'Workflow & Progress' },
  { name: 'Revision', color: '#5B6BD6', groupName: 'Workflow & Progress' },
  { name: 'Waiting', color: '#D9534F', groupName: 'Workflow & Progress' },
  { name: 'In Review', color: '#D97B3A', groupName: 'Workflow & Progress' },
  { name: 'Checking', color: '#A35DB8', groupName: 'Workflow & Progress' },
  { name: 'On-Hold', color: '#8A8F98', groupName: 'Workflow & Progress' },
  { name: 'CRM', color: '#22A3AE', groupName: 'Management' },
  { name: 'Closed', color: '#2FA37A', groupName: 'Workflow & Progress' },
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
