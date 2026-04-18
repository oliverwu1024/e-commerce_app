import nodemailer from 'nodemailer';

export const EMAIL_CONFIG = {
  verificationTokenExpires: 24 * 60 * 60 * 1000, // 24 hours
  from: process.env.EMAIL_FROM || 'ElectroMarket <noreply@electromarket.example>',
};

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'sandbox.smtp.mailtrap.io',
  port: Number(process.env.SMTP_PORT) || 2525,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});
