# Seller announcement email — connected accounts cutover

Send to: every active seller (anyone with `sellerType=PERSONAL` or
`sellerType=BUSINESS` who has at least one `ACTIVE`/`ON_HOLD` listing OR
any `PAID`/`SHIPPED`/`COMPLETED` order in the last 90 days).

Send via: Resend (already configured per `project_production_topology`).

---

**Subject:** Action needed — connect your own payment account

**Body:**

Hi {{name}},

We just changed how money flows on ElectroMarket. From now on, when a buyer pays online, the funds go **directly to your bank** — ElectroMarket never holds your money along the way. This is better for you (faster payouts, tax forms come direct to you, no platform float) and keeps us out of money-transmitter territory.

**What you need to do:**

Visit https://electromarket-app.com/account/payments and connect at least one of:

- **Stripe** — accepts credit cards, Apple Pay, Google Pay. Best for most sellers. Funds in your bank in 2 business days.
- **Square** — useful if you already sell in person with a Square reader.

It takes about 5 minutes. You can connect both if you want to give buyers a choice.

**Until you connect:** buyers of your listings can only pay you via cash or bank transfer (arranged directly through the order's message thread). This is unchanged if you were already using cash or bank transfer.

**Heads up on fees:** ElectroMarket keeps 5% of each online payment as a platform fee, deducted automatically at the time of payment — you never need to send us anything separately. Cash and bank transfer remain fee-free.

**A few things we also just shipped:**
- A **Refund** button on your paid orders, in case a buyer needs their money back.
- An **Earnings** card on your sales dashboard, showing gross / fees / net.
- **Disputes**: buyers can now formally flag issues with an order. You'll be notified if it happens.

Full details: https://electromarket-app.com/terms

Reply to this email if anything doesn't work.

— The ElectroMarket team
