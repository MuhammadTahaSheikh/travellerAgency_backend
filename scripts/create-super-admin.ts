import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL || 'tahasheikh682@gmail.com';
  const password = process.env.SUPER_ADMIN_PASSWORD || 'Pakistan@123';

  const superAdminRole = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  if (!superAdminRole) {
    throw new Error('SUPER_ADMIN role not found. Run npm run db:seed first.');
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      firstName: 'Taha',
      lastName: 'Sheikh',
      roleId: superAdminRole.id,
      isActive: true,
      inviteToken: null,
      inviteExpiresAt: null,
      passwordSetAt: new Date(),
    },
    create: {
      email,
      password: hashedPassword,
      firstName: 'Taha',
      lastName: 'Sheikh',
      roleId: superAdminRole.id,
      passwordSetAt: new Date(),
    },
    include: { role: true },
  });

  console.log(`Super admin ready: ${user.email} (${user.role.name})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
