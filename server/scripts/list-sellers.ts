import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

(async () => {
  const users = await prisma.user.findMany({
    where: { OR: [{ sellerType: 'BUSINESS' }, { role: 'ADMIN' }] },
    select: {
      email: true,
      username: true,
      name: true,
      role: true,
      sellerType: true,
      businessName: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  console.table(users);
  await prisma.$disconnect();
})();
