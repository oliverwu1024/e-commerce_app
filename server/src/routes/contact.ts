import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { sendContactFormEmail } from '../utils/email.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Aggressive rate limit because this endpoint (a) is unauthenticated and
// (b) triggers an outbound email to the admin inbox. 3 per IP per hour caps
// spam at a level that a human filing one genuine support ticket never hits.
const contactLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many messages — please try again in an hour.' },
});

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  email: z.string().trim().toLowerCase().email('Valid email is required').max(255),
  subject: z
    .string()
    .trim()
    .min(3, 'Subject must be at least 3 characters')
    .max(150, 'Subject is too long'),
  message: z
    .string()
    .trim()
    .min(10, 'Message must be at least 10 characters')
    .max(3000, 'Message is too long (max 3000 characters)'),
});

router.post('/', contactLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { name, email, subject, message } = parsed.data;

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      // Fail closed: if the destination isn't configured the form would
      // silently drop messages. Log and 503 so the client surfaces it.
      logger.error('contact.admin_email_missing');
      res.status(503).json({ error: 'Support is temporarily unavailable.' });
      return;
    }

    // Persist FIRST so we still have a record if the email send fails — the
    // admin can then reply through /admin/contact even if Resend was down at
    // intake time. Email is best-effort notification; the row is the truth.
    const submission = await prisma.contactSubmission.create({
      data: {
        fromName: name,
        fromEmail: email,
        subject,
        message,
      },
    });

    try {
      await sendContactFormEmail(adminEmail, name, email, subject, message);
    } catch (mailErr) {
      // Log but still return success — the row is in the DB and the admin
      // will see it in /admin/contact even without the email notification.
      logger.error('contact.notify_failed', {
        submissionId: submission.id,
        err: mailErr instanceof Error ? mailErr.message : String(mailErr),
      });
    }

    logger.info('contact.sent', {
      submissionId: submission.id,
      fromEmail: email,
      subject: subject.slice(0, 60),
    });
    res.json({ message: "Thanks — we've got your message and will reply soon." });
  } catch (err) {
    logger.error('contact.failed', { err: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to send message. Please try again.' });
  }
});

export default router;
