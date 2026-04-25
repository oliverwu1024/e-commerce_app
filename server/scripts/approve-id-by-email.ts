// One-off admin helper: flip a user's idVerification to APPROVED.
// Use when a Stripe Identity verification succeeded at Stripe but the
// webhook never reached your server (e.g., listener wasn't running yet).
// Usage: npx tsx scripts/approve-id-by-email.ts <email>

import 'dotenv/config';
import prisma from '../src/lib/prisma.js';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npx tsx scripts/approve-id-by-email.ts <email>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, username: true, idVerification: true },
  });
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      idVerification: 'APPROVED',
      idRejectionReason: null,
      idVerificationSessionId: null,
    },
  });
  console.log(`Approved ${user.username} (was ${user.idVerification}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
