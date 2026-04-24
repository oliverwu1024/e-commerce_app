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
