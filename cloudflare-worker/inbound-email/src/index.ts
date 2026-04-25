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
      let detail: string;
      if (webhookRes.status === 'rejected') {
        detail = String(webhookRes.reason);
      } else {
        const resp = webhookRes.value as Response;
        // Read the body so we can see WHY the server rejected — much more
        // useful in `wrangler tail` than just the status code.
        let bodyText = '';
        try {
          bodyText = await resp.text();
        } catch {
          /* best-effort */
        }
        detail = `${resp.status} ${bodyText.slice(0, 300)}`;
      }
      console.error('Webhook POST failed:', detail);
      // Also log what we sent, so you can see if PostalMime parsed the
      // email shape we expected (no body, etc.).
      console.error('Payload was:', {
        from: payload.from,
        subject: payload.subject,
        textLen: payload.text.length,
        htmlLen: payload.html.length,
      });
      message.setReject(`Inbound webhook returned: ${detail.slice(0, 200)}`);
    } else {
      console.log('Webhook POST OK');
    }
  },
};
