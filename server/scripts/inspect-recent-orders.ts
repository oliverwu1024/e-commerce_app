import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

(async () => {
  const orders = await prisma.order.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 5,
    select: {
      id: true,
      status: true,
      paymentMethod: true,
      paymentSessionState: true,
      amount: true,
      updatedAt: true,
      listing: { select: { title: true, status: true } },
      seller: { select: { username: true, sellerType: true } },
    },
  });
  console.log(JSON.stringify(orders, null, 2));
  await prisma.$disconnect();
})();
