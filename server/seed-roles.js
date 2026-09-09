const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ROLE_COLORS = {
  PM: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  DESIGNER: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  TECH: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  CRM: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  AUDITOR: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  ADMIN: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
};

async function seedRoles() {
  const rolesToCreate = ['PM', 'DESIGNER', 'TECH', 'CRM', 'AUDITOR', 'ADMIN'];

  console.log('Seeding WorkspaceRoles...');

  for (const roleName of rolesToCreate) {
    // Check if it exists
    const existing = await prisma.workspaceRole.findUnique({
      where: { name: roleName }
    });

    if (!existing) {
      await prisma.workspaceRole.create({
        data: {
          name: roleName,
          color: ROLE_COLORS[roleName] || null
        }
      });
      console.log(`Created role: ${roleName}`);
    } else {
      console.log(`Role already exists: ${roleName}`);
    }
  }

  console.log('Done seeding.');
  await prisma.$disconnect();
}

seedRoles().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
