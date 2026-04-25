import Link from 'next/link';

export const metadata = { title: 'How to sell on ElectroMarket · Help' };

export default function HelpSellPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="font-serif-italic text-lg text-[var(--text-muted)]">
        For sellers
      </p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-[var(--text-primary)]">
        How to sell on ElectroMarket
      </h1>
      <p className="mt-3 text-sm text-[var(--text-muted)]">
        Whether you&apos;re clearing out an old phone or running a refurb
        shop, this guide gets you from sign-up to first payout. The key thing
        to know up front: <strong>you are the merchant of record</strong> —
        the buyer pays your Stripe or Square account directly, ElectroMarket
        never holds funds.
      </p>

      <Section number="1" title="Choose Personal or Business at sign-up">
        <p>On the{' '}
          <Link href="/register" className="text-[var(--neon-cyan)] hover:underline">
            registration page
          </Link>{' '}
          you pick an account type. You can&apos;t change this later, so:
        </p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong>Personal</strong> — you&apos;re selling your own gear
            occasionally. No business name needed.
          </li>
          <li>
            <strong>Business</strong> — you&apos;re selling regularly under a
            registered business name (sole trader, ABN holder, company). The
            business name shows on your listings and seller profile.
          </li>
        </ul>
        <p>
          Business sellers in Australia: you&apos;re responsible for GST
          registration and remittance once you cross the ATO threshold.
          ElectroMarket doesn&apos;t collect or remit tax for you.
        </p>
      </Section>

      <Section number="2" title="Verify your email">
        <p>
          We send a verification link the moment you register. You can browse
          and message immediately, but you can&apos;t list items or accept
          payments until verified. Didn&apos;t get it? Open{' '}
          <Link href="/verify-email" className="text-[var(--neon-cyan)] hover:underline">
            /verify-email
          </Link>{' '}
          and click <strong>Resend</strong>.
        </p>
      </Section>

      <Section number="3" title="Connect a payment provider">
        <p>
          Visit{' '}
          <Link href="/account/payments" className="text-[var(--neon-cyan)] hover:underline">
            Account → Payments
          </Link>
          . You&apos;ll see two cards: <strong>Stripe</strong> and{' '}
          <strong>Square</strong>. You only need one to start, but you can
          connect both.
        </p>

        <h3 className="mt-4 text-base font-semibold text-[var(--text-primary)]">
          Stripe (recommended for most)
        </h3>
        <ol className="ml-5 list-decimal space-y-2">
          <li>Click <strong>Connect Stripe</strong>.</li>
          <li>
            You&apos;ll be redirected to Stripe&apos;s onboarding form. Have
            your photo ID and bank details ready — it takes 5–10 minutes.
          </li>
          <li>
            Stripe verifies your identity and bank account. Once approved,
            payments settle to your bank in ~2 business days.
          </li>
          <li>
            Back on ElectroMarket the card flips to <strong>Active</strong>{' '}
            and buyers can pay you with Stripe immediately.
          </li>
        </ol>
        <p className="mt-2 text-xs text-[var(--text-dim)]">
          Stripe issues your annual tax forms (e.g. 1099-K equivalent) — not
          ElectroMarket. Stripe charges its own processing fee on top of our
          5% platform fee.
        </p>

        <h3 className="mt-5 text-base font-semibold text-[var(--text-primary)]">
          Square (only if you already use it)
        </h3>
        <ol className="ml-5 list-decimal space-y-2">
          <li>
            You need an existing Square merchant account first (Square
            doesn&apos;t onboard fresh sellers through us).
          </li>
          <li>
            Click <strong>Connect Square</strong>. You&apos;ll authorise
            ElectroMarket to create payments on your account.
          </li>
          <li>
            We grab your default location automatically. Done — buyers can
            now pay you with Square.
          </li>
        </ol>
      </Section>

      <Section number="4" title="Create your first listing">
        <p>
          Click <strong>+ Sell Item</strong> in the navbar. Good listings have:
        </p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong>Clear photos</strong> — at least 3, taken in daylight.
            Show the screen on, any cosmetic damage honestly.
          </li>
          <li>
            <strong>Honest condition</strong> — pick the closest match (Like
            new, Good, Fair). Buyers leave bad reviews when condition was
            oversold.
          </li>
          <li>
            <strong>Specifics in the title</strong> — model number, storage,
            colour. &quot;iPhone 13 Pro 256GB Sierra Blue&quot; beats
            &quot;Old iPhone&quot;.
          </li>
          <li>
            <strong>Reasonable price</strong> — check{' '}
            <Link href="/browse" className="text-[var(--neon-cyan)] hover:underline">
              Browse
            </Link>{' '}
            to see what similar items go for.
          </li>
        </ul>
      </Section>

      <Section number="5" title="When a buyer orders">
        <p>The order shows in{' '}
          <Link href="/dashboard?tab=in_sales" className="text-[var(--neon-cyan)] hover:underline">
            Dashboard → Selling → In Progress
          </Link>
          . You&apos;ll get a notification and an email.
        </p>
        <ol className="ml-5 list-decimal space-y-2">
          <li>
            <strong>Confirm</strong> the order — this signals to the buyer
            that you&apos;ve got it and pay buttons appear on their side.
          </li>
          <li>
            The buyer pays via Stripe / Square / cash. Online payments land
            in your provider account immediately; we deduct our 5% platform
            fee at the moment of charge (no separate invoice).
          </li>
          <li>
            <strong>Ship it</strong> and add a tracking number. Mark as
            shipped in the dashboard.
          </li>
          <li>
            Once the buyer marks received (or the auto-complete window
            elapses), the order is closed and you can leave a review.
          </li>
        </ol>
      </Section>

      <Section number="6" title="Fees and payouts">
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong>Platform fee</strong>: 5% of each completed online payment.
            Deducted at the time of charge via Stripe&apos;s{' '}
            <code>application_fee_amount</code> mechanism.
          </li>
          <li>
            <strong>Cash and bank transfer</strong>: free. No platform fee.
          </li>
          <li>
            <strong>Payouts</strong>: managed by Stripe / Square, not by us.
            Stripe defaults to a 2-business-day rolling payout to your bank.
            See your{' '}
            <Link href="/dashboard?tab=in_sales" className="text-[var(--neon-cyan)] hover:underline">
              earnings card
            </Link>{' '}
            for a running gross / fee / net total.
          </li>
        </ul>
      </Section>

      <Section number="7" title="Refunds and disputes">
        <p>
          You can issue a full refund on any paid order from the order page.
          The refund debits your Stripe / Square account and reverses the
          platform fee.
        </p>
        <p>
          If a buyer opens a dispute (or files a chargeback directly with
          their bank), an ElectroMarket moderator reviews and may rule in
          their favour. <strong>Chargebacks and their fees are your
          responsibility</strong> — we don&apos;t reimburse them.
        </p>
        <p>
          Best defence: ship promptly, keep tracking numbers on file, and
          don&apos;t describe items more generously than they deserve.
        </p>
      </Section>

      <Section number="8" title="Account types: when to switch up">
        <p>
          A Personal account is fine for the first few sales. Convert your
          intent to a Business account (re-register with a new email or
          contact us) once any of these is true:
        </p>
        <ul className="ml-5 list-disc space-y-2">
          <li>You&apos;re selling regularly enough that the ATO would call it a business.</li>
          <li>You have an ABN and want it on your invoices.</li>
          <li>You want the <span className="rounded border border-[var(--neon-cyan)]/30 bg-[var(--tint-cyan)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--neon-cyan)]">Business</span> badge on your profile (it boosts buyer trust).</li>
        </ul>
      </Section>

      <div className="mt-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 text-sm text-[var(--text-muted)]">
        Still have questions?{' '}
        <Link href="/contact" className="font-semibold text-[var(--neon-cyan)] hover:underline">
          Contact us
        </Link>
        . For the legal side, see the{' '}
        <Link href="/terms" className="font-semibold text-[var(--neon-cyan)] hover:underline">
          Terms of Service
        </Link>
        .
      </div>
    </div>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 space-y-3 text-sm text-[var(--text-primary)]">
      <h2 className="flex items-baseline gap-3 text-lg font-semibold">
        <span className="font-display text-[var(--neon-cyan)]">{number}.</span>
        <span>{title}</span>
      </h2>
      <div className="space-y-3 text-[var(--text-muted)]">{children}</div>
    </section>
  );
}
