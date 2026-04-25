# Inbound email Worker

Receives email at addresses configured in **Cloudflare → Email Routing**,
parses it, and POSTs to the ElectroMarket API at
`POST /api/webhooks/email`.

## Local files

- `src/index.ts` — Worker code
- `wrangler.toml` — Cloudflare config + non-secret variables
- `package.json` — pinned `postal-mime` (parser) + `wrangler` (CLI)

## Deploy (CLI path — recommended, version-controlled)

From this directory:

```bash
npm install
npx wrangler login                       # opens browser, one-time
npx wrangler secret put EMAIL_WEBHOOK_SECRET
# paste the same value you set on Railway, hit enter
npx wrangler deploy
```

Then in the Cloudflare dashboard:

1. **Email Routing** → enable for the domain if you haven't already
2. **Email Routing → Routes** → add a custom address:
   - `support@electromarket-app.com` → Action: **Send to a Worker** → pick `electromarket-inbound-email`
3. (Optional) Add `noreply@electromarket-app.com` → same Worker, so any
   stragglers replying to old admin emails (before SUPPORT_EMAIL_FROM was
   set) still thread correctly.

## Deploy (dashboard paste — fastest if you've never used wrangler)

1. Cloudflare dashboard → Workers & Pages → Create → "Hello World" template
2. Name: `electromarket-inbound-email`
3. Replace the entire `index.js` with the contents of `src/index.ts`
   (Worker dashboard runs JS directly — TS strips fine, but you may need
   to remove the `: ForwardableEmailMessage` etc. type annotations and
   the `import` at the top — replace with a CDN-style import:
   `import PostalMime from 'https://cdn.skypack.dev/postal-mime'`)
4. Save & deploy
5. Worker → Settings → Variables → add encrypted variables:
   - `EMAIL_WEBHOOK_SECRET` (the value from Railway)
   - `WEBHOOK_URL` = `https://api.electromarket-app.com/api/webhooks/email`
6. Worker → Settings → Triggers → Email → Add address → `support@electromarket-app.com`

If you go the dashboard route, this repo's files are documentation only —
edits here won't update the live Worker until you copy them across (or
switch to the CLI path).

## Test the wiring

After deploying, send a test email to `support@electromarket-app.com`:

```bash
# from a different inbox (gmail etc), send a plain email to:
#   support@electromarket-app.com
# subject: anything
# body: anything

# Then watch:
npx wrangler tail
# OR Cloudflare dashboard → your worker → Logs

# You should see one line per inbound email + the webhook response status.
```

If the Worker logs show 200 from the webhook → check `/admin/contact` on
electromarket-app.com — the email should be there as a new submission.

## Common failures

| Symptom | Cause |
|---|---|
| Worker doesn't fire at all | Email Routing not enabled, or no Route configured for `support@` → Worker |
| Worker fires, returns 401 | `EMAIL_WEBHOOK_SECRET` mismatch between Worker and Railway |
| Worker fires, returns 503 | Server doesn't have `EMAIL_WEBHOOK_SECRET` set on Railway |
| Worker fires, returns 200, but `/admin/contact` empty | Migration `20260427030000_inbound_contact_replies` didn't run on prod — check Railway deploy logs |
| Cold email arrives but reply email doesn't thread | Subject `[#<id>]` tag was stripped by the customer or by an intermediate mail server. Check Worker logs to see the actual subject received. |
