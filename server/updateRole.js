const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.user.update({
    where: { email: 'nyrrya.vipscaleph@gmail.com' },
    data: { secondaryRole: null }
  });
  console.log("Role updated!");
}

main().finally(() => prisma.$disconnect());
