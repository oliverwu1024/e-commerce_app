// Catalog-sync-specific emails. Kept separate from utils/email.ts so the
// transactional / verification / receipt emails there don't grow yet
// another concern. Each function is tolerant of misconfiguration (missing
// SMTP, missing user, etc.) — a failed catalog notification email must
// never take down a sync attempt.

import prisma from '../../lib/prisma.js';
import { sendMail, EMAIL_CONFIG } from '../../config/email.js';
import { logger } from '../../utils/logger.js';

function clientUrl(): string {
  return (process.env.CLIENT_URL || 'http://localhost:3000').split(',')[0].trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sent when the seller's Square OAuth refresh fails permanently — they
 * need to reconnect from /account/payments. Their listings remain on the
 * marketplace but stop mirroring to Square POS until they reconnect.
 */
export async function sendTokenExpiringEmail(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user) return;
  const reconnectUrl = `${clientUrl()}/account/payments`;
  try {
    await sendMail({
      from: EMAIL_CONFIG.from,
      to: user.email,
      subject: 'Reconnect your Square account on ElectroMarket',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Hi ${escapeHtml(user.name)},</h2>
          <p>Your Square account on ElectroMarket has been disconnected and we
          can no longer sync your listings to your Square Catalog.</p>
          <p>Your listings remain live on ElectroMarket — only the sync to your
          Square POS is paused. To resume, please reconnect Square below.</p>
          <a href="${reconnectUrl}"
             style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px;
                    border-radius: 8px; text-decoration: none; font-weight: 600;">
            Reconnect Square
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 16px;">
            If you didn't intend to enable Square Catalog sync, you can ignore this email.
          </p>
        </div>
      `,
    });
  } catch (err) {
    logger.warn('square.catalog.emails.token_expiring_send_failed', {
      userId,
      err: String(err),
    });
  }
}

/**
 * Daily summary of catalog sync failures for a single seller. Sent only if
 * they had at least N failures in the last 24h. Hooked up by the daily
 * summary cron in services/squareCatalog/observability.
 */
export async function sendSyncFailureSummaryEmail(
  userId: string,
  stats: {
    failures: number;
    successRate: number;
    samples: { listingTitle: string; message: string }[];
  },
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user) return;
  const dashboardUrl = `${clientUrl()}/account/payments`;
  const sampleHtml = stats.samples
    .slice(0, 3)
    .map(
      (s) =>
        `<li><b>${escapeHtml(s.listingTitle)}</b>: ${escapeHtml(s.message)}</li>`,
    )
    .join('');
  const successPercent = Math.round(stats.successRate * 100);
  try {
    await sendMail({
      from: EMAIL_CONFIG.from,
      to: user.email,
      subject: `Square Catalog sync had ${stats.failures} failure${stats.failures === 1 ? '' : 's'} yesterday`,
      html: `
        <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
          <h2>Hi ${escapeHtml(user.name)},</h2>
          <p>Your Square Catalog sync had <b>${stats.failures}</b> failure${stats.failures === 1 ? '' : 's'}
          in the last 24 hours (success rate ${successPercent}%).</p>
          ${sampleHtml ? `<p>Most recent samples:</p><ul>${sampleHtml}</ul>` : ''}
          <p>Open the dashboard to retry, or contact support if the failures
          look permanent.</p>
          <a href="${dashboardUrl}"
             style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px;
                    border-radius: 8px; text-decoration: none; font-weight: 600;">
            Open dashboard
          </a>
        </div>
      `,
    });
  } catch (err) {
    logger.warn('square.catalog.emails.failure_summary_send_failed', {
      userId,
      err: String(err),
    });
  }
}
