import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL y ADMIN_PASSWORD son obligatorios');
  }
  const hash = await argon2.hash(password);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { password: hash, role: Role.ADMIN },
    create: { email, password: hash, name: 'Admin', role: Role.ADMIN },
    select: { id: true, email: true, role: true },
  });
  console.log('Admin listo:', admin);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
