// One-shot announcement send for the connected-accounts cutover (2026-04-25).
// Reads active sellers from prod DB, sends each a personalised email via the
// platform's existing sendMail (Resend in production / Mailtrap in dev).
//
// Safe-by-default: prints what it WILL do and exits unless `--send` is passed.
// Re-runnable: appends each successful send to a JSON log so re-runs skip
// already-sent addresses. Failed sends are NOT logged → next run retries them.
//
// Usage:
//   # Dry run (default) — prints recipient list and exits
//   npx tsx scripts/announce-connected-accounts.ts
//
//   # Send to ONE address only (smoke test before the real send)
//   npx tsx scripts/announce-connected-accounts.ts --test=you@example.com
//
//   # Real send to all active sellers
//   npx tsx scripts/announce-connected-accounts.ts --send
//
//   # Custom log file (default: announce-connected-accounts.sent.log)
//   npx tsx scripts/announce-connected-accounts.ts --send --log=/tmp/sent.log

import 'dotenv/config';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { sendConnectedAccountsAnnouncement } from '../src/utils/email.js';

// Resend's default rate limit is 10 requests/sec on the API tier. Stay well
// under that — 200 ms between sends = 5/sec, leaves headroom for the rest of
// the app's transactional traffic running in parallel.
const SEND_DELAY_MS = 200;

type Args = {
  send: boolean;
  test: string | null;
  logPath: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let send = false;
  let test: string | null = null;
  let logPath = 'announce-connected-accounts.sent.log';
  for (const a of argv) {
    if (a === '--send') send = true;
    else if (a.startsWith('--test=')) test = a.slice('--test='.length).trim();
    else if (a.startsWith('--log=')) logPath = a.slice('--log='.length).trim();
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: npx tsx scripts/announce-connected-accounts.ts [--send] [--test=email] [--log=path]',
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return { send, test, logPath };
}

function loadSentSet(logPath: string): Set<string> {
  if (!existsSync(logPath)) return new Set();
  const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const out = new Set<string>();
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as { email?: string };
      if (row.email) out.add(row.email.toLowerCase());
    } catch {
      // Skip corrupt lines silently — better to over-send a few than crash mid-run.
    }
  }
  return out;
}

function recordSent(logPath: string, email: string, name: string): void {
  appendFileSync(
    logPath,
    JSON.stringify({ email, name, sentAt: new Date().toISOString() }) + '\n',
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  // "Active seller" = either marked BUSINESS, or has at least one listing in
  // ACTIVE / ON_HOLD state, or has any post-payment sale in the last 90 days.
  // Excludes soft-deleted users and unverified emails (sending to unverified
  // addresses risks domain-reputation hits with no upside — those users
  // weren't actually receiving emails before this).
  const NINETY_DAYS_AGO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const sellers = await prisma.user.findMany({
    where: {
      deletedAt: null,
      emailVerified: true,
      OR: [
        { sellerType: 'BUSINESS' },
        { listings: { some: { status: { in: ['ACTIVE', 'ON_HOLD'] } } } },
        {
          sales: {
            some: {
              status: { in: ['PAID', 'SHIPPED', 'COMPLETED'] },
              updatedAt: { gte: NINETY_DAYS_AGO },
            },
          },
        },
      ],
    },
    select: { email: true, name: true, sellerType: true },
    orderBy: { createdAt: 'asc' },
  });

  // Test mode: send to a single arbitrary address. Used for previewing the
  // rendered email before the real broadcast — the address does NOT need
  // to be an existing seller. Name defaults to the local-part of the email.
  let recipients: { email: string; name: string; sellerType?: string }[] = sellers;
  if (args.test) {
    const t = args.test.trim();
    if (!t.includes('@')) {
      console.error(`--test must be an email address, got: ${args.test}`);
      await prisma.$disconnect();
      process.exit(1);
    }
    // Reuse the existing seller's name if they happen to be in the audience
    // (so the test render matches what they'd actually receive); otherwise
    // synthesise a friendly name from the local-part for the salutation.
    const existing = sellers.find((s) => s.email.toLowerCase() === t.toLowerCase());
    recipients = [
      existing ?? { email: t, name: t.split('@')[0] || 'there', sellerType: 'TEST' },
    ];
  }

  const alreadySent = loadSentSet(args.logPath);
  const toSend = recipients.filter((s) => !alreadySent.has(s.email.toLowerCase()));
  const skipped = recipients.length - toSend.length;

  console.log(
    `Found ${sellers.length} active seller(s). ${recipients.length} after --test filter. ${skipped} already sent (per ${args.logPath}). ${toSend.length} to send.`,
  );

  if (!args.send) {
    console.log('\nDry run — no emails sent. Sample recipients:');
    console.table(toSend.slice(0, 20).map((s) => ({ email: s.email, name: s.name, type: s.sellerType })));
    console.log('\nPass --send to actually send.');
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const seller of toSend) {
    try {
      await sendConnectedAccountsAnnouncement(seller.email, seller.name);
      recordSent(args.logPath, seller.email, seller.name);
      ok += 1;
      console.log(`✓ ${seller.email}`);
    } catch (err) {
      failed += 1;
      console.error(`✗ ${seller.email}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (toSend.length > 1) await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
  }

  console.log(`\nDone. ${ok} sent, ${failed} failed. Re-run to retry failures.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
