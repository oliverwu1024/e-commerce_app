import nodemailer from 'nodemailer';

const SMTP_PORT = Number(process.env.SMTP_PORT) || 2525;
const SMTP_HOST = process.env.SMTP_HOST || 'sandbox.smtp.mailtrap.io';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

export const EMAIL_CONFIG = {
  verificationTokenExpires: 24 * 60 * 60 * 1000, // 24 hours
  from: process.env.EMAIL_FROM || 'ElectroMarket <noreply@electromarket.example>',
};

// SMTP fallback for dev (Mailtrap) and self-hosted setups. Cloud platforms
// (Railway, Render, Heroku, Fly) frequently block outbound SMTP — set
// RESEND_API_KEY to use Resend's HTTPS API instead.
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

export interface MailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

// Single send entrypoint. Picks Resend HTTP API when RESEND_API_KEY is set
// (production), otherwise falls back to nodemailer SMTP (dev). HTTP API
// rides on port 443 so it works from cloud platforms that block SMTP.
export async function sendMail(params: MailParams): Promise<void> {
  const from = params.from ?? EMAIL_CONFIG.from;
  if (RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend API ${res.status}: ${body.slice(0, 500)}`);
    }
    return;
  }
  await transporter.sendMail({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}

// Verify email config at startup so problems surface in the boot log
// instead of the first real send.
export function verifyEmailAtStartup(): void {
  if (RESEND_API_KEY) {
    console.log(
      `[email] using Resend HTTPS API from=${EMAIL_CONFIG.from} keyPrefix=${RESEND_API_KEY.slice(0, 6)}...`,
    );
    return;
  }
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS ||
    process.env.SMTP_USER === 'placeholder'
  ) {
    console.warn(
      `[email] verify skipped — neither RESEND_API_KEY nor full SMTP env is set (host=${SMTP_HOST} user=${process.env.SMTP_USER || '(unset)'})`,
    );
    return;
  }
  transporter
    .verify()
    .then(() => {
      console.log(
        `[smtp] verify ok host=${SMTP_HOST} port=${SMTP_PORT} secure=${SMTP_PORT === 465} user=${process.env.SMTP_USER}`,
      );
    })
    .catch((err) => {
      console.error('[smtp] verify FAILED', {
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        user: process.env.SMTP_USER,
        from: EMAIL_CONFIG.from,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    });
}

// Back-compat alias (older imports).
export const verifySmtpAtStartup = verifyEmailAtStartup;
