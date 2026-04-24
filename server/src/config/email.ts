import nodemailer from 'nodemailer';

const SMTP_PORT = Number(process.env.SMTP_PORT) || 2525;
const SMTP_HOST = process.env.SMTP_HOST || 'sandbox.smtp.mailtrap.io';

export const EMAIL_CONFIG = {
  verificationTokenExpires: 24 * 60 * 60 * 1000, // 24 hours
  from: process.env.EMAIL_FROM || 'ElectroMarket <noreply@electromarket.example>',
};

export const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  // Port 465 = implicit TLS (SSL handshake before SMTP). Port 587/2525 =
  // STARTTLS upgrade. Resend on :465 needs secure=true or the connection
  // hangs in plaintext and the send appears to silently fail.
  secure: SMTP_PORT === 465,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

// Verify SMTP at startup so credential / TLS issues surface in the boot
// log instead of the first real send. Logs detailed error on failure but
// doesn't crash — most app routes don't depend on email working.
export function verifySmtpAtStartup(): void {
  // Skip when SMTP isn't configured (placeholder env in dev, etc.).
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS ||
    process.env.SMTP_USER === 'placeholder'
  ) {
    console.warn(`[smtp] verify skipped — host=${SMTP_HOST} user=${process.env.SMTP_USER || '(unset)'}`);
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
