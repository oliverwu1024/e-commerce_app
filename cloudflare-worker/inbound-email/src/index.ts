// Cloudflare Email Worker — receives inbound email at the addresses
// configured in Cloudflare → Email Routing → Routes, parses it, and POSTs
// to ElectroMarket's /api/webhooks/email endpoint. The Express handler
// turns the POST into a ContactSubmission (cold email) or threads it onto
// an existing ContactSubmission (subject contains [#<id>] tag).
//
// Required Worker variables (set via `wrangler secret put` or in the
// dashboard → Worker → Settings → Variables):
//   EMAIL_WEBHOOK_SECRET   — same value as Railway env; auths the POST
//   WEBHOOK_URL            — full URL, e.g. https://api.electromarket-app.com/api/webhooks/email
//
// Optional:
//   FORWARD_TO             — if set, ALSO forwards a copy of the email to
//                            this address (e.g., your personal Gmail) as a
//                            backup. Useful during cutover; remove later.

import PostalMime from 'postal-mime';

export interface Env {
  EMAIL_WEBHOOK_SECRET: string;
  WEBHOOK_URL: string;
  FORWARD_TO?: string;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    // Parse the raw RFC 822 email into structured fields. PostalMime is the
    // recommended parser for Cloudflare Email Workers — handles MIME, quoted-
    // printable, attachments, etc.
    const parsed = await PostalMime.parse(message.raw);

    const payload = {
      from: parsed.from?.address ?? message.from,
      fromName: parsed.from?.name ?? '',
      to: message.to,
      subject: parsed.subject ?? '',
      text: parsed.text ?? '',
      html: parsed.html ?? '',
    };

    // Best-effort backup forward — runs in parallel with the webhook POST so
    // a slow forward doesn't delay the primary path. Failure here is logged
    // but doesn't reject the inbound email (the webhook is the source of truth).
    const tasks: Promise<unknown>[] = [
      fetch(env.WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Email-Secret': env.EMAIL_WEBHOOK_SECRET,
        },
        body: JSON.stringify(payload),
      }),
    ];

    if (env.FORWARD_TO) {
      tasks.push(message.forward(env.FORWARD_TO));
    }

    const [webhookRes] = await Promise.allSettled(tasks);

    // If the webhook POST failed, reject the email. Cloudflare will return
    // a bounce to the sender. Better than silently dropping support tickets.
    if (
      webhookRes.status === 'rejected' ||
      (webhookRes.status === 'fulfilled' && !(webhookRes.value as Response).ok)
    ) {
      const detail =
        webhookRes.status === 'rejected'
          ? String(webhookRes.reason)
          : `${(webhookRes.value as Response).status}`;
      console.error('Webhook POST failed:', detail);
      message.setReject(`Inbound webhook returned: ${detail}`);
    }
  },
};
