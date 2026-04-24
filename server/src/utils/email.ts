import crypto from 'crypto';
import { sendMail, EMAIL_CONFIG } from '../config/email.js';

export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const verifyUrl = `${clientUrl}/verify-email?token=${token}`;

  await sendMail({
    from: EMAIL_CONFIG.from,
    to: email,
    subject: 'Verify your ElectroMarket email',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Welcome to ElectroMarket!</h2>
        <p>Please verify your email address by clicking the button below:</p>
        <a href="${verifyUrl}"
           style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; font-weight: 600;">
          Verify Email
        </a>
        <p style="margin-top: 16px; color: #666; font-size: 14px;">
          Or copy and paste this link into your browser:<br/>
          <a href="${verifyUrl}">${verifyUrl}</a>
        </p>
        <p style="color: #999; font-size: 12px;">This link expires in 24 hours.</p>
      </div>
    `,
  });
}

export async function sendIdApprovedEmail(email: string, username: string): Promise<void> {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const listingsUrl = `${clientUrl}/listings/new`;

  await sendMail({
    from: EMAIL_CONFIG.from,
    to: email,
    subject: 'Your ID has been approved',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Hi ${escapeHtml(username)},</h2>
        <p>Your ID has been approved by our review team. You can now create listings and start selling on ElectroMarket.</p>
        <a href="${listingsUrl}"
           style="display: inline-block; background: #059669; color: #fff; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; font-weight: 600;">
          Create your first listing
        </a>
        <p style="margin-top: 16px; color: #666; font-size: 14px;">
          If you have any questions, just reply to this email.
        </p>
      </div>
    `,
  });
}

export async function sendIdRejectedEmail(
  email: string,
  username: string,
  reason: string,
): Promise<void> {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const resubmitUrl = `${clientUrl}/account/verification`;

  await sendMail({
    from: EMAIL_CONFIG.from,
    to: email,
    subject: 'Your ID submission needs attention',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Hi ${escapeHtml(username)},</h2>
        <p>We weren't able to approve your ID submission. Here's the reason:</p>
        <blockquote style="border-left: 3px solid #dc2626; padding: 8px 12px; margin: 16px 0; color: #7f1d1d; background: #fef2f2;">
          ${escapeHtml(reason)}
        </blockquote>
        <p>You can upload a new document at any time:</p>
        <a href="${resubmitUrl}"
           style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; font-weight: 600;">
          Resubmit ID
        </a>
        <p style="margin-top: 16px; color: #666; font-size: 14px;">
          Common reasons for rejection: blurry image, expired document, name mismatch, missing photo.
        </p>
      </div>
    `,
  });
}

// Reason strings are admin-supplied free text; username is user-supplied.
// Keep this local to the email path since that's the only untrusted surface
// that interpolates into HTML.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendPasswordResetEmail(
  email: string,
  username: string,
  token: string,
): Promise<void> {
  const clientUrl = (process.env.CLIENT_URL || 'http://localhost:3000').split(',')[0].trim();
  const resetUrl = `${clientUrl}/reset-password?token=${token}`;

  await sendMail({
    from: EMAIL_CONFIG.from,
    to: email,
    subject: 'Reset your ElectroMarket password',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Hi ${escapeHtml(username)},</h2>
        <p>We received a request to reset the password on your ElectroMarket account.</p>
        <p>Click the button below to set a new password. This link expires in 1 hour.</p>
        <a href="${resetUrl}"
           style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; font-weight: 600;">
          Reset password
        </a>
        <p style="margin-top: 16px; color: #666; font-size: 14px;">
          Or copy and paste this link into your browser:<br/>
          <a href="${resetUrl}">${resetUrl}</a>
        </p>
        <p style="margin-top: 16px; color: #999; font-size: 12px;">
          If you didn't request a password reset, you can safely ignore this email —
          your password won't change.
        </p>
      </div>
    `,
  });
}

export async function sendIdSubmittedEmail(
  adminEmail: string,
  username: string,
  userEmail: string,
  userId: string,
): Promise<void> {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const reviewUrl = `${clientUrl}/admin/verifications`;

  await sendMail({
    from: EMAIL_CONFIG.from,
    to: adminEmail,
    subject: `New ID submission from ${username}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>New ID verification pending review</h2>
        <p><strong>${escapeHtml(username)}</strong> (${escapeHtml(userEmail)}) just submitted a government ID for verification.</p>
        <p style="color: #666; font-size: 14px;">User ID: <code>${escapeHtml(userId)}</code></p>
        <p>Open the admin queue to view the front and back images and approve or reject:</p>
        <a href="${reviewUrl}"
           style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; font-weight: 600;">
          Review submission
        </a>
        <p style="margin-top: 16px; color: #999; font-size: 12px;">
          ID photos are never attached to emails. They're stored in a private bucket and
          only visible inside the admin dashboard via short-lived signed URLs.
        </p>
      </div>
    `,
  });
}

export async function sendContactFormEmail(
  adminEmail: string,
  fromName: string,
  fromEmail: string,
  subject: string,
  message: string,
): Promise<void> {
  // Escape every user-supplied field — name/subject/message are all
  // attacker-controlled (anonymous contact form), and fromEmail ends up in a
  // mailto: link. Reply-To lets the admin hit reply and have it go back to
  // the form submitter, not noreply@.
  await sendMail({
    from: EMAIL_CONFIG.from,
    to: adminEmail,
    replyTo: fromEmail,
    subject: `[Support] ${subject}`,
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
        <h2 style="margin-bottom: 4px;">New support enquiry</h2>
        <p style="color: #666; margin-top: 0;">Someone filled in the Contact form on ElectroMarket.</p>
        <table style="border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #666;">From:</td>
            <td style="padding: 4px 0;"><strong>${escapeHtml(fromName)}</strong> &lt;<a href="mailto:${escapeHtml(fromEmail)}">${escapeHtml(fromEmail)}</a>&gt;</td>
          </tr>
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #666;">Subject:</td>
            <td style="padding: 4px 0;"><strong>${escapeHtml(subject)}</strong></td>
          </tr>
        </table>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;"/>
        <div style="white-space: pre-wrap; line-height: 1.5;">${escapeHtml(message)}</div>
        <p style="margin-top: 24px; color: #999; font-size: 12px;">
          Reply to this email to respond — it'll go to ${escapeHtml(fromEmail)}.
        </p>
      </div>
    `,
  });
}

export async function sendOrderPlacedEmail(
  sellerEmail: string,
  sellerUsername: string,
  listingTitle: string,
  buyerUsername: string,
  orderId: string,
): Promise<void> {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const url = `${clientUrl}/dashboard?tab=sales&order=${orderId}`;

  await sendMail({
    from: EMAIL_CONFIG.from,
    to: sellerEmail,
    subject: `New order for "${listingTitle}"`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Hi ${escapeHtml(sellerUsername)},</h2>
        <p>You have a new order from <strong>${escapeHtml(buyerUsername)}</strong> for <strong>${escapeHtml(listingTitle)}</strong>.</p>
        <p>Confirm or decline from your Sales dashboard:</p>
        <a href="${url}"
           style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; font-weight: 600;">
          Open order
        </a>
      </div>
    `,
  });
}

export async function sendNewMessageEmail(
  receiverEmail: string,
  receiverUsername: string,
  senderUsername: string,
  listingTitle: string,
  preview: string,
  orderId: string,
  role: 'buyer' | 'seller',
): Promise<void> {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  // Go to the inbox page since that's where threads live; fallback to the
  // role-specific dashboard tab.
  const url = `${clientUrl}/account/messages?order=${orderId}&tab=${
    role === 'buyer' ? 'purchases' : 'sales'
  }`;

  // Keep the preview short — some clients clip at the subject line anyway,
  // and we don't want to send an entire screed via email for what's meant
  // to be a "there's a new message, come read it" nudge.
  const shortPreview = preview.length > 140 ? preview.slice(0, 140) + '…' : preview;

  await sendMail({
    from: EMAIL_CONFIG.from,
    to: receiverEmail,
    subject: `${senderUsername} sent you a message about "${listingTitle}"`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Hi ${escapeHtml(receiverUsername)},</h2>
        <p><strong>${escapeHtml(senderUsername)}</strong> sent you a message about <strong>${escapeHtml(listingTitle)}</strong>:</p>
        <blockquote style="border-left: 3px solid #2563eb; padding: 8px 12px; margin: 16px 0; color: #1e40af; background: #eff6ff;">
          ${escapeHtml(shortPreview)}
        </blockquote>
        <a href="${url}"
           style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; font-weight: 600;">
          Open conversation
        </a>
      </div>
    `,
  });
}

// Admin replying to a customer support inquiry from inside the app. Sent
// from the platform's noreply address with replyTo=ADMIN_EMAIL so any
// follow-up from the customer comes back to the same admin inbox the
// original /api/contact email landed in. From: never exposes the admin's
// personal email — that was the whole point of building this flow.
export async function sendAdminContactReply(
  toEmail: string,
  toName: string,
  originalSubject: string,
  body: string,
): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  // Strip an existing "Re:" so reply chains don't grow "Re: Re: Re:".
  const cleaned = originalSubject.replace(/^(re:\s*)+/i, '').trim();
  const subject = `Re: ${cleaned}`;

  await sendMail({
    from: EMAIL_CONFIG.from,
    to: toEmail,
    replyTo: adminEmail || undefined,
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #111827;">
        <p>Hi ${escapeHtml(toName)},</p>
        <div style="white-space: pre-wrap; line-height: 1.5; margin: 16px 0;">${escapeHtml(body)}</div>
        <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">
          — ElectroMarket Support
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;"/>
        <p style="color: #9ca3af; font-size: 12px;">
          Reply to this email and your message will reach us at the same place
          your original enquiry went.
        </p>
      </div>
    `,
  });
}

// Admin-initiated broadcast email. Used by the /admin/broadcasts send
// pipeline to push a single subject + body to many recipients (one call
// per recipient — Resend batches up to 100 in a single API call but we
// keep it simple). Body is pre-formatted HTML; admin is trusted, no
// escape pass on the body itself, but the salutation IS escaped.
export async function sendBroadcastEmail(
  toEmail: string,
  toName: string,
  subject: string,
  bodyHtml: string,
): Promise<void> {
  await sendMail({
    from: EMAIL_CONFIG.from,
    to: toEmail,
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #111827;">
        <p>Hi ${escapeHtml(toName)},</p>
        <div style="line-height: 1.5; margin: 16px 0;">${bodyHtml}</div>
        <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">
          — The ElectroMarket team
        </p>
      </div>
    `,
  });
}

// One-shot announcement for the connected-accounts cutover (sent 2026-04-25
// via scripts/announce-connected-accounts.ts). Kept here rather than inlined
// in the script so the HTML lives next to the other email templates.
export async function sendConnectedAccountsAnnouncement(
  email: string,
  name: string,
): Promise<void> {
  const clientUrl = process.env.CLIENT_URL?.split(',')[0]?.trim() || 'http://localhost:3000';
  const paymentsUrl = `${clientUrl}/account/payments`;
  const termsUrl = `${clientUrl}/terms`;

  await sendMail({
    from: EMAIL_CONFIG.from,
    to: email,
    subject: 'Action needed — connect your own payment account',
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #111827;">
        <h2 style="margin: 0 0 16px;">Hi ${escapeHtml(name)},</h2>
        <p>We just changed how money flows on ElectroMarket. From now on, when a buyer pays online, the funds go <strong>directly to your bank</strong> — ElectroMarket never holds your money along the way. This is better for you (faster payouts, tax forms come direct to you, no platform float) and keeps us out of money-transmitter territory.</p>

        <h3 style="margin: 24px 0 8px;">What you need to do</h3>
        <p>Visit your payment settings and connect at least one of:</p>
        <ul>
          <li><strong>Stripe</strong> — credit cards, Apple Pay, Google Pay. Best for most sellers. Funds in your bank in 2 business days.</li>
          <li><strong>Square</strong> — useful if you already sell in person with a Square reader.</li>
        </ul>
        <p style="margin: 16px 0;">
          <a href="${paymentsUrl}"
             style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px;
                    border-radius: 8px; text-decoration: none; font-weight: 600;">
            Connect a payment account
          </a>
        </p>
        <p>Takes about 5 minutes. You can connect both if you want to give buyers a choice.</p>

        <h3 style="margin: 24px 0 8px;">Until you connect</h3>
        <p>Buyers of your listings can only pay you via cash or bank transfer (arranged through the order's message thread). Unchanged if you were already using cash or bank transfer.</p>

        <h3 style="margin: 24px 0 8px;">Heads up on fees</h3>
        <p>ElectroMarket keeps 5% of each online payment as a platform fee, deducted automatically at the time of payment — you never need to send us anything separately. Cash and bank transfer remain fee-free.</p>

        <h3 style="margin: 24px 0 8px;">A few things we also just shipped</h3>
        <ul>
          <li>A <strong>Refund</strong> button on your paid orders.</li>
          <li>An <strong>Earnings</strong> card on your sales dashboard, showing gross / fees / net.</li>
          <li><strong>Disputes</strong>: buyers can now formally flag issues with an order. You'll be notified if it happens.</li>
        </ul>

        <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">
          Full details: <a href="${termsUrl}">${termsUrl}</a><br/>
          Reply to this email if anything doesn't work.
        </p>
        <p style="color: #6b7280; font-size: 14px;">— The ElectroMarket team</p>
      </div>
    `,
  });
}
