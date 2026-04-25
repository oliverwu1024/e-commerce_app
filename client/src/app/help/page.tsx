import Link from 'next/link';

export const metadata = { title: 'Help · ElectroMarket' };

export default function HelpIndexPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="font-serif-italic text-lg text-[var(--text-muted)]">
        Help centre
      </p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-[var(--text-primary)]">
        How can we help?
      </h1>
      <p className="mt-3 text-sm text-[var(--text-muted)]">
        Pick a guide based on what you&apos;re trying to do. If you can&apos;t
        find what you need, the contact form is at the bottom of every page.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <HelpCard
          href="/help/buy"
          eyebrow="For buyers"
          title="How to use ElectroMarket"
          body="Search, message a seller, place an order, pay safely, and what to do if something goes wrong."
        />
        <HelpCard
          href="/help/sell"
          eyebrow="For sellers"
          title="How to sell on ElectroMarket"
          body="Set up your account (Personal or Business), connect Stripe or Square, create your first listing, get paid."
        />
      </div>

      <div className="mt-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Quick answers
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-[var(--text-primary)]">
          <li>
            <strong>Does ElectroMarket hold my money?</strong> No — payments
            settle directly to the seller&apos;s connected Stripe or Square
            account.
          </li>
          <li>
            <strong>How much does it cost to sell?</strong> Nothing.
            ElectroMarket takes no platform fee on any payment method —
            sellers receive 100% of each sale.
          </li>
          <li>
            <strong>Do I need a Stripe / Square account before signing up?</strong>{' '}
            No. You can register first and connect a payment provider later
            from <Link href="/account/payments" className="text-[var(--neon-cyan)] hover:underline">your payments page</Link>.
          </li>
          <li>
            <strong>What if a buyer or seller goes silent?</strong> Open a
            dispute on the order — see{' '}
            <Link href="/help/buy" className="text-[var(--neon-cyan)] hover:underline">
              the buyer guide
            </Link>{' '}
            or{' '}
            <Link href="/help/sell" className="text-[var(--neon-cyan)] hover:underline">
              the seller guide
            </Link>
            .
          </li>
        </ul>
      </div>
    </div>
  );
}

function HelpCard({
  href,
  eyebrow,
  title,
  body,
}: {
  href: string;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="panel panel-hover clip-corner block p-5 transition-shadow"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--neon-cyan)]">
        {eyebrow}
      </p>
      <h3 className="mt-2 text-lg font-bold text-[var(--text-primary)]">
        {title}
      </h3>
      <p className="mt-1.5 text-sm text-[var(--text-muted)]">{body}</p>
      <p className="mt-3 text-sm font-semibold text-[var(--neon-cyan)]">
        Read guide →
      </p>
    </Link>
  );
}
