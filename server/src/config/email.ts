import nodemailer from 'nodemailer';

const SMTP_PORT = Number(process.env.SMTP_PORT) || 2525;

export const EMAIL_CONFIG = {
  verificationTokenExpires: 24 * 60 * 60 * 1000, // 24 hours
  from: process.env.EMAIL_FROM || 'ElectroMarket <noreply@electromarket.example>',
};

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'sandbox.smtp.mailtrap.io',
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
