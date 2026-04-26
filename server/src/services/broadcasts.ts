import prisma from '../lib/prisma.js';
import type { BroadcastAudience } from '../generated/prisma/client.js';
import { sendBroadcastEmail } from '../utils/email.js';
import { createNotification } from './notifications.js';
import { logger } from '../utils/logger.js';

// Audience resolution + send pipeline for admin broadcasts. The resolver is
// shared between the preview endpoint (`POST /api/admin/broadcasts/preview`)
// and the actual send so the count an admin sees before clicking Send is the
// same set the send hits.
//
// Rate limit: Resend's default cap is 10/sec on the API tier. We pace at 5/sec
// (200 ms between sends) to leave headroom for transactional traffic running
// at the same time. For audiences over a few hundred this is the dominant
// cost — a 1k-recipient broadcast takes ~3.5 minutes.

const SEND_DELAY_MS = 200;

export type Recipient = {
  id: string | null; // null when audience=CUSTOM_EMAILS and the email isn't a known user
  email: string;
  name: string;
};

export async function resolveAudience(
  audience: BroadcastAudience,
  targetEmails: string | null,
): Promise<Recipient[]> {
  if (audience === 'CUSTOM_EMAILS') {
    if (!targetEmails) return [];
    const emails = targetEmails
      .split(/[,;\n]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes('@'));
    if (emails.length === 0) return [];
    // Try to attach a name from User if we can (so the salutation is
    // personalised). Fallback to the local-part of the email.
    const known = await prisma.user.findMany({
      where: { email: { in: emails }, deletedAt: null },
      select: { id: true, email: true, name: true },
    });
    const byEmail = new Map(known.map((u) => [u.email.toLowerCase(), u]));
    return emails.map((e) => {
      const u = byEmail.get(e);
      return u
        ? { id: u.id, email: u.email, name: u.name }
        : { id: null, email: e, name: e.split('@')[0] || 'there' };
    });
  }

  // Common base: only verified, not-deleted users.
  const baseFilter = { deletedAt: null, emailVerified: true };

  if (audience === 'ALL_VERIFIED') {
    const users = await prisma.user.findMany({
      where: baseFilter,
      select: { id: true, email: true, name: true },
    });
    return users.map((u) => ({ id: u.id, email: u.email, name: u.name }));
  }

  if (audience === 'BUSINESS_SELLERS') {
    const users = await prisma.user.findMany({
      where: { ...baseFilter, sellerType: 'BUSINESS' },
      select: { id: true, email: true, name: true },
    });
    return users.map((u) => ({ id: u.id, email: u.email, name: u.name }));
  }

  if (audience === 'PERSONAL_SELLERS') {
    // PERSONAL is the default sellerType. Only count those who have actually
    // listed something (otherwise this hits every signed-up buyer too).
    const users = await prisma.user.findMany({
      where: {
        ...baseFilter,
        sellerType: 'PERSONAL',
        listings: { some: {} },
      },
      select: { id: true, email: true, name: true },
    });
    return users.map((u) => ({ id: u.id, email: u.email, name: u.name }));
  }

  if (audience === 'ALL_SELLERS') {
    // Anyone marked BUSINESS, OR PERSONAL with at least one listing OR sale.
    const users = await prisma.user.findMany({
      where: {
        ...baseFilter,
        OR: [
          { sellerType: 'BUSINESS' },
          { listings: { some: {} } },
          { sales: { some: {} } },
        ],
      },
      select: { id: true, email: true, name: true },
    });
    return users.map((u) => ({ id: u.id, email: u.email, name: u.name }));
  }

  if (audience === 'SELLERS_NO_PAYMENT') {
    // Sellers without ANY ACTIVE+chargesEnabled payment account. Useful for
    // re-prompting the connected-accounts onboarding.
    const users = await prisma.user.findMany({
      where: {
        ...baseFilter,
        OR: [
          { sellerType: 'BUSINESS' },
          { listings: { some: { status: { in: ['ACTIVE', 'ON_HOLD'] } } } },
        ],
        // No active-and-charges-enabled payment account on file.
        NOT: {
          paymentAccounts: {
            some: { status: 'ACTIVE', chargesEnabled: true },
          },
        },
      },
      select: { id: true, email: true, name: true },
    });
    return users.map((u) => ({ id: u.id, email: u.email, name: u.name }));
  }

  // Exhaustive switch — TS will warn here if a new enum value is added
  // without a handler.
  const _exhaust: never = audience;
  throw new Error(`Unhandled audience: ${_exhaust as string}`);
}

export type SendBroadcastInput = {
  sentById: string;
  subject: string;
  body: string;
  audience: BroadcastAudience;
  targetEmails: string | null;
  channelEmail: boolean;
  channelInApp: boolean;
};

export type SendBroadcastResult = {
  broadcastId: string;
  audienceCount: number;
  emailsSent: number;
  emailsFailed: number;
  notificationsSent: number;
};

// Synchronous fan-out. For audiences over a few hundred this can take
// minutes — fine for now since admins click Send and watch a spinner; if
// it becomes a UX problem we can move to a background job queue.
export async function sendBroadcast(input: SendBroadcastInput): Promise<SendBroadcastResult> {
  const recipients = await resolveAudience(input.audience, input.targetEmails);

  // Persist the broadcast row up-front so a crash mid-send still leaves a
  // record. status flips DONE / FAILED at the end.
  const broadcast = await prisma.broadcast.create({
    data: {
      subject: input.subject,
      body: input.body,
      audience: input.audience,
      targetEmails: input.targetEmails,
      channelEmail: input.channelEmail,
      channelInApp: input.channelInApp,
      audienceCount: recipients.length,
      sentById: input.sentById,
    },
  });

  let emailsSent = 0;
  let emailsFailed = 0;
  let notificationsSent = 0;

  for (const r of recipients) {
    if (input.channelEmail) {
      try {
        await sendBroadcastEmail(r.email, r.name, input.subject, input.body);
        emailsSent += 1;
      } catch (err) {
        emailsFailed += 1;
        logger.error('broadcast.email.failed', {
          broadcastId: broadcast.id,
          email: r.email,
          err: String(err),
        });
      }
    }

    if (input.channelInApp && r.id) {
      // Trim long bodies to fit the notification body column (500 chars).
      const shortBody = input.body.length > 460
        ? input.body.slice(0, 457) + '…'
        : input.body;
      // Fire-and-log inside createNotification — no need to track failures
      // separately here, the table is the audit.
      await createNotification({
        recipientId: r.id,
        type: 'NEW_MESSAGE', // closest existing type until we add a BROADCAST type — broadcasts surface in the bell badge with a regular-looking entry
        title: input.subject.slice(0, 200),
        body: shortBody,
        actorId: input.sentById,
      });
      notificationsSent += 1;
    }

    // Pace API calls — only matters when emailing, not for in-app-only.
    if (input.channelEmail && recipients.length > 1) {
      await new Promise((res) => setTimeout(res, SEND_DELAY_MS));
    }
  }

  await prisma.broadcast.update({
    where: { id: broadcast.id },
    data: {
      sentCount: emailsSent + notificationsSent,
      failedCount: emailsFailed,
      status: emailsFailed > 0 && emailsSent === 0 ? 'FAILED' : 'DONE',
      finishedAt: new Date(),
    },
  });

  return {
    broadcastId: broadcast.id,
    audienceCount: recipients.length,
    emailsSent,
    emailsFailed,
    notificationsSent,
  };
}
