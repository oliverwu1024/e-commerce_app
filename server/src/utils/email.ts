import crypto from 'crypto';
import { transporter, EMAIL_CONFIG } from '../config/email.js';

export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const verifyUrl = `${clientUrl}/verify-email?token=${token}`;

  await transporter.sendMail({
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
