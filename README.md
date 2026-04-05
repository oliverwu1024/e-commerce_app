# Used Electronics Marketplace

A peer-to-peer platform for buying and selling used electronics. Users can list their devices, browse listings from other sellers, and purchase items directly through Stripe checkout.

## Tech Stack

- **Frontend**: Next.js (TypeScript, Tailwind CSS)
- **Backend**: Express (TypeScript)
- **Database**: PostgreSQL
- **Payments**: Stripe
- **Image Storage**: AWS S3
- **Deployment**: AWS EC2 + RDS, Vercel (frontend)

## Project Structure

```
e-commerce_app/
├── client/          # Next.js frontend
│   └── src/
│       └── app/     # App router pages
├── server/          # Express backend
│   └── src/         # TypeScript source
└── README.md
```

## Getting Started

### Prerequisites

- Node.js (v18+)
- PostgreSQL
- npm

### Running the Server

```bash
cd server
cp .env.example .env   # Edit with your credentials
npm install
npm run dev
```

### Running the Client

```bash
cd client
npm install
npm run dev
```

The client runs on `http://localhost:3000` and the server on `http://localhost:5000`.
