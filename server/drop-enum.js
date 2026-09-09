const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Dropping RoleType enum...');
  try {
    await prisma.$executeRawUnsafe(`DROP TYPE "RoleType";`);
    console.log('Enum dropped successfully.');
  } catch (e) {
    console.error('Error dropping enum:', e);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
