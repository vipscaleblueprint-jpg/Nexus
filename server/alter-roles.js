const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Altering primaryRole, secondaryRole, tertiaryRole, minorRole to varchar...');
  
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ALTER COLUMN "primaryRole" TYPE text USING "primaryRole"::text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ALTER COLUMN "secondaryRole" TYPE text USING "secondaryRole"::text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ALTER COLUMN "tertiaryRole" TYPE text USING "tertiaryRole"::text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ALTER COLUMN "minorRole" TYPE text USING "minorRole"::text;`);
    console.log('Columns successfully altered to text type.');
  } catch (e) {
    console.error('Error altering columns:', e);
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
