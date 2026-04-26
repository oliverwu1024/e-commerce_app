# Used Electronics Marketplace

A peer-to-peer platform for buying and selling used electronics. Users can list
their devices, browse listings from other sellers, and purchase items via
Stripe Connect, Square, or PayPal — funds settle directly to each seller's
own account, never through the platform. Live at
[electromarket-app.com](https://electromarket-app.com).

## Tech Stack

- **Frontend**: Next.js 16 (App Router, TypeScript, Tailwind CSS)
- **Backend**: Express 5 (TypeScript), Prisma 7
- **Database**: PostgreSQL 16
- **Queue**: BullMQ on Redis (Square Catalog sync worker + reconciler)
- **Payments**: Stripe Connect Standard, Square OAuth, PayPal Partner
- **ID verification**: Stripe Identity
- **Image / file storage**: AWS S3 (presigned PUT/GET, regional bucket)
- **Catalog integration**: Two-way sync to seller's Square Catalog
- **Email**: Resend (transactional + inbound)
- **Phone OTP**: Firebase Auth (free up to 10k/mo)
- **DNS / TLS / DDoS**: Cloudflare
- **Containerisation**: Docker (multi-stage builds, dev + prod compose)

### Where it runs

| Layer | Runs on |
|---|---|
| Frontend (Next.js) | Vercel |
| Backend (Express + worker) | Railway |
| PostgreSQL | Railway managed |
| Redis (BullMQ backing store) | Railway managed |
| File storage | AWS S3 (`ap-southeast-2`) |
| Email | Resend |
| DNS / edge | Cloudflare |

The stack is intentionally polyglot: each service is the strongest fit for its
job (S3 for blob storage, Vercel for Next.js, Resend over SES to skip sender-
domain warm-up, Cloudflare for free DDoS + edge caching).

## Features

- JWT auth (httpOnly cookies, bcrypt, email + phone verification, ID upload)
- Listings with multi-image upload, fulfilment options, search + filters
- Cart (Zustand client-side + Prisma server-side)
- Per-seller checkout via Stripe Connect / Square / PayPal sandboxes
- Order lifecycle (PENDING → CONFIRMED → PAID → SHIPPED → COMPLETED) with
  buyer-seller chat thread and dispute flow
- Reviews, saved listings, inquiries
- Admin tooling: user browser, broadcasts, contact inbox, dispute queue,
  Square Catalog sync health
- Two-way Square Catalog sync (outbox pattern, BullMQ worker, webhook-driven
  reconciliation, image upload) — see `docs/square-catalog-sync.md`
- Public Featured rail powered by a partner Square Catalog

## Project Structure

```
e-commerce_app/
├── client/                          # Next.js frontend
│   └── src/
│       ├── app/                     # App router pages
│       ├── components/
│       ├── lib/
│       ├── stores/                  # Zustand stores
│       └── types/
├── server/                          # Express backend
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── src/
│       ├── config/                  # S3, Stripe, Square, email config
│       ├── lib/                     # prisma, crypto, password helpers
│       ├── middleware/              # auth, csrf, rate limiter, request log
│       ├── queue/                   # BullMQ + ioredis
│       ├── routes/                  # HTTP handlers
│       ├── services/
│       │   └── squareCatalog/       # OAuth, mapper, worker, webhooks…
│       └── utils/
├── docs/
│   ├── inbound-email-setup.md
│   └── square-catalog-sync.md
├── docker-compose.yml               # dev (db, redis, server, client)
├── docker-compose.prod.yml          # prod (no bind-mounts, secrets required)
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 20+
- Docker Desktop (recommended — handles Postgres + Redis automatically)
- npm

### Running with Docker

```bash
cp server/.env.example server/.env   # fill in JWT_SECRET + AWS keys
docker compose up --build
```

This brings up Postgres, Redis, the Express server, and the Next.js client.
Run migrations on first start:

```bash
docker compose exec server npx prisma migrate deploy
```

### Running locally without Docker

```bash
# in one terminal
cd server
npm install
npx prisma migrate deploy
npm run dev

# in another terminal
cd client
npm install
npm run dev
```

The client runs on `http://localhost:3000`, the server on `http://localhost:5000`.

### Tests

```bash
cd server
npm test     # node:test runner — Square Catalog mapper unit tests
```

## Environment variables

See `docker-compose.yml` for the full list. The critical ones at minimum:

- `JWT_SECRET` — auth signing key (32+ random bytes)
- `DATABASE_URL` — Postgres connection string
- `REDIS_URL` — required if you want catalog sync; otherwise the feature
  silently disables and the marketplace runs as before
- `PAYMENT_TOKEN_ENCRYPTION_KEY` — 32-byte hex; encrypts seller OAuth tokens
- `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_S3_BUCKET` + `AWS_REGION`
- Per-provider payment env vars (`STRIPE_SECRET_KEY`, `SQUARE_APPLICATION_ID`,
  etc.) — empty values are fine; each provider's `/pay` endpoint returns 503
  if it's not configured
- `ADMIN_PASSWORD_HASH` — bcrypt hash for the seeded admin user (seed.ts only).
  Generate with:
  ```bash
  node -e "require('bcrypt').hash(process.argv[1], 12).then(console.log)" 'your-password'
  ```
- `FIREBASE_SERVICE_ACCOUNT` — base64-encoded service-account JSON for the
  Firebase Admin SDK (used to verify client-issued phone-auth ID tokens).
  Generate the JSON in Firebase Console → Project Settings → Service accounts,
  then `base64 -w0 firebase-admin.json`. Treat as a secret.

### Running the Cloudflare Worker (inbound email)

The `cloudflare-worker/inbound-email/` directory holds a Worker that parses
inbound mail and POSTs to `/api/webhooks/email`. Setup is documented in
[`docs/inbound-email-setup.md`](docs/inbound-email-setup.md).
