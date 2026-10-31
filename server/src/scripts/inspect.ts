import { prisma } from '../config/prisma';

async function main() {
  const list = await prisma.list.findUnique({
    where: { id: 'a59d9362-2a8f-4206-965c-bf89bd747be3' },
    include: { statuses: true }
  });
  console.log('LIST STATUSES:', list?.statuses.map(s => ({ id: s.id, name: s.name, color: s.color, groupName: s.groupName })));
}

main().finally(() => prisma.$disconnect());
