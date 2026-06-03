# ElectroMarket

> A production peer-to-peer marketplace for buying and selling used electronics. Funds settle **directly** to each seller's own Stripe or Square account — the platform never custodies money.

**Live at [electromarket-app.com](https://electromarket-app.com)**

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express)
![Prisma](https://img.shields.io/badge/Prisma-7-2d3748?logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)
![Redis](https://img.shields.io/badge/Redis-BullMQ-dc382d?logo=redis)
![Docker](https://img.shields.io/badge/Docker-multi--stage-2496ed?logo=docker)
![License](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)
[![CI](https://github.com/oliverwu1024/e-commerce_app/actions/workflows/ci.yml/badge.svg)](https://github.com/oliverwu1024/e-commerce_app/actions/workflows/ci.yml)

---

## Table of Contents

- [What it does](#what-it-does)
- [Engineering highlights](#engineering-highlights)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [License](#license)

---

## What it does

ElectroMarket is a full-stack marketplace where individuals and small businesses list used electronics, browse with rich filters and full-text search, and check out via the seller's own payment account. Each listing represents a single physical item.

### For buyers
- Search + filters across category, condition, brand, price, fulfilment method
- Saved listings, cart, multi-seller checkout
- Order timeline (`PENDING → CONFIRMED → PAID → SHIPPED → COMPLETED`)
- In-app chat thread with seller, dispute flow with admin oversight
- Reviews after purchase

### For sellers
- Multi-image + video listings with reorderable galleries
- Connect Stripe or Square — funds land in your account directly
- Stripe Identity verification for higher trust tier
- Two-way Square Catalog sync (edits in either system propagate)
- Earnings dashboard with provider-fee breakdown

### For admins
- ID verification queue, dispute resolution, contact inbox (with inbound email threading)
- User browser, broadcast announcements (email + in-app, audience-targeted)
- Square Catalog sync health dashboard with per-seller force resync

---

## Engineering highlights

These are the parts of the codebase that go beyond a typical CRUD marketplace.

### Outbox pattern for catalog sync
Every Listing mutation writes a `SquareSyncOutbox` row in the **same Postgres transaction** as the Listing change. A BullMQ worker drains the outbox; if Redis is down, a 60-second reconciler picks up the slack. This eliminates the two classic failure modes — *"Listing committed, queue enqueue failed"* and *"queue succeeded, Listing rolled back"*.

### Optimistic concurrency with Square
`SquareCatalogLink.version` mirrors Square's catalog version. Outbound writes include the version; on `OPTIMISTIC_LOCKING_FAILURE` we drop it and let the next sync re-fetch. Inbound webhooks (`catalog.version.updated`) only apply when the remote version is strictly greater. Net behaviour: last writer wins, with a one-side bias toward the marketplace.

### Encryption-at-rest for OAuth tokens
Square access/refresh tokens are encrypted with **AES-256-GCM** (12-byte IV, 16-byte auth tag) before hitting Postgres. Key lives in `PAYMENT_TOKEN_ENCRYPTION_KEY`. Backups, accidental dumps, and read-only DB access don't leak seller credentials.

### Defence-in-depth rate limiting
Redis-backed `express-rate-limit` buckets with memory fallback. Per-user and per-IP. Notable rules: contact form ≥4/hr blocked, login ≥6/hr blocked, daily SMS budget cap, **per-phone cooldown across all accounts** (defeats account-spraying on a shared phone number).

### CSRF + SameSite hardening
SameSite=Lax JWT cookie + Origin-header allowlist on every state-changing request. Missing or mismatched Origin → rejected. Helmet ships strict CSP, frameguard deny, HSTS preload-eligible.

### Soft deletion that respects counterparties
Deleted users are anonymised (`deletedAt` set, PII cleared) but their orders, reviews, and messages remain so buyers/sellers on the other side keep their history. Removed listings stay readable so existing cart snapshots don't 404.

### Direct-settlement payments (no platform custody)
Two providers behind one abstraction: **Stripe Connect Standard** and **Square OAuth**. Money goes directly from buyer → seller account; the platform never holds funds (regulatory + insolvency-risk win). Each provider's `/pay` endpoint returns 503 if not configured, so the marketplace stays online if a single provider is down.

### Money as integers
Newer columns (`Refund.amountCents`, `SquareFeaturedItem.priceCents`) use `Int` cents to dodge floating-point drift. Legacy `Decimal(10,2)` columns are being migrated.

### Full-text search via tsvector
Listings have a `STORED` generated `tsvector` column. Search runs through `$queryRaw` with `plainto_tsquery`, so it survives misspellings without a separate Elastic/Meili process.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| State (client) | Zustand (`auth`, `cart`, `inbox`, `saved`) |
| Backend | Express 5 (TypeScript) |
| ORM | Prisma 7 |
| Database | PostgreSQL 16 |
| Queue | BullMQ on Redis (catalog sync worker + reconciler) |
| Payments | Stripe Connect Standard, Square OAuth |
| ID verification | Stripe Identity |
| File storage | AWS S3 (presigned PUT/GET) |
| Email | Resend (transactional + inbound via Cloudflare Worker) |
| Phone OTP | Firebase Auth |
| Containerisation | Docker (multi-stage; dev + prod compose) |

### Where it runs in production

| Layer | Hosted on |
|---|---|
| Frontend (Next.js) | Vercel |
| Backend (Express + worker) | Railway |
| PostgreSQL | Railway managed |
| Redis (BullMQ) | Railway managed |
| File storage | AWS S3 (`ap-southeast-2`) |
| Transactional email | Resend |
| DNS / TLS / DDoS | Cloudflare |

The stack is intentionally polyglot — each piece is the strongest fit for its job. S3 for blobs, Vercel for Next.js, Resend over SES to skip sender-domain warm-up, Cloudflare for free DDoS + edge caching.

---

## Architecture

```
┌──────────────┐    HTTPS     ┌──────────────┐    Postgres    ┌──────────────┐
│  Next.js 16  │◄────────────►│  Express 5   │◄───────────────►│ PostgreSQL   │
│   (Vercel)   │   JWT cookie │  (Railway)   │                 │  (Railway)   │
└──────┬───────┘              └──────┬───────┘                 └──────────────┘
       │                             │
       │ presigned PUT/GET           │ enqueue
       ▼                             ▼
┌──────────────┐              ┌──────────────┐    BullMQ       ┌──────────────┐
│   AWS S3     │              │ outbox tx    │────────────────►│ Square sync  │
│              │              │ (atomic)     │                 │  worker      │
└──────────────┘              └──────────────┘                 └──────┬───────┘
                                                                      │
                                                                      ▼
                                                              ┌──────────────┐
                                                              │ Square       │
                                                              │ Catalog API  │
                                                              └──────────────┘
```

**Request flow** — Browser → Cloudflare → Vercel → Express → Postgres. Cookies are httpOnly + SameSite=Lax. Every mutating request carries an Origin allowlist check.

**Catalog-sync flow** — Listing mutation writes Listing + outbox row in one transaction. Worker drains outbox, calls Square, records audit row. Inbound webhooks dedupe via `SquareCatalogWebhookEvent` and apply only if remote version > local version.

---

## Project structure

```
e-commerce_app/
├── client/                          # Next.js 16 frontend (28 routes)
│   └── src/
│       ├── app/                     # App Router pages
│       ├── components/
│       ├── lib/
│       ├── stores/                  # Zustand: auth, cart, inbox, saved
│       └── types/
├── server/                          # Express 5 backend (~9k LOC)
│   ├── prisma/
│   │   ├── schema.prisma            # 32 models incl. Square subsystem
│   │   └── migrations/
│   └── src/
│       ├── config/                  # S3, Stripe, Square, email
│       ├── lib/                     # prisma singleton, crypto, password
│       ├── middleware/              # auth, csrf, rate limiter, request log
│       ├── queue/                   # BullMQ + ioredis singleton
│       ├── routes/                  # 17 route files, 100+ endpoints
│       ├── services/
│       │   └── squareCatalog/       # oauth, mapper, worker, reconciler,
│       │                            # imageUpload, inbound, featured,
│       │                            # observability (+ mapper.test.ts)
│       └── utils/
├── cloudflare-worker/
│   └── inbound-email/               # Parses inbound mail → /api/webhooks/email
├── docker-compose.yml               # dev (db, redis, server, client)
├── docker-compose.prod.yml          # prod (no bind-mounts, secrets required)
└── README.md
```

---

## Getting started

### Prerequisites
- Node.js 20+
- Docker Desktop (recommended — handles Postgres + Redis automatically)
- npm

### With Docker (recommended)

```bash
cp server/.env.example server/.env   # fill in JWT_SECRET + AWS keys
docker compose up --build
```

Brings up Postgres, Redis, the Express server, and the Next.js client. On first run apply migrations:

```bash
docker compose exec server npx prisma migrate deploy
```

Optional — seed an admin user and a few listings:

```bash
docker compose exec server npm run seed
```

### Without Docker

```bash
# Terminal 1
cd server
npm install
npx prisma migrate deploy
npm run dev

# Terminal 2
cd client
npm install
npm run dev
```

Client → `http://localhost:3000` · Server → `http://localhost:5000`

---

## Environment variables

Full list lives in `docker-compose.yml`. Minimum required:

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Auth signing key (32+ random bytes) |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Required for catalog sync; if absent, sync silently disables |
| `PAYMENT_TOKEN_ENCRYPTION_KEY` | 32-byte hex; encrypts seller OAuth tokens |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_S3_BUCKET` / `AWS_REGION` | S3 image + video storage |
| `STRIPE_SECRET_KEY`, `SQUARE_APPLICATION_ID`, … | Per-provider payment keys (any subset is fine — missing providers return 503) |
| `FIREBASE_SERVICE_ACCOUNT` | Base64 JSON for Firebase Admin (verifies client phone-OTP tokens) |
| `ADMIN_PASSWORD_HASH` | bcrypt hash for the seeded admin user (seed.ts only) |

Generate the bcrypt hash with:

```bash
node -e "require('bcrypt').hash(process.argv[1], 12).then(console.log)" 'your-password'
```

Generate the Firebase service account: Firebase Console → Project Settings → Service accounts → Generate new private key → `base64 -w0 firebase-admin.json`.

### Cloudflare Worker (inbound email)

`cloudflare-worker/inbound-email/` parses inbound mail and POSTs to `/api/webhooks/email`.

---

## Testing

```bash
cd server
npm test          # node:test runner — Square Catalog mapper unit tests
```

Currently focused unit coverage on the catalog mapper (the trickiest pure logic). End-to-end coverage is a manual smoke-test checklist (171 items across buyer, individual seller, business seller, and cross-persona flows).

---

## License

[GNU Affero General Public License v3.0](LICENSE) — you're free to use, modify, and self-host this code, but if you run a modified version as a network service you must also publish your changes under the same licence.
