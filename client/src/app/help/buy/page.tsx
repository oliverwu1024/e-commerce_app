import Link from 'next/link';

export const metadata = { title: 'How to use ElectroMarket · Help' };

export default function HelpBuyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="font-serif-italic text-lg text-[var(--text-muted)]">
        For buyers
      </p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-[var(--text-primary)]">
        How to use ElectroMarket
      </h1>
      <p className="mt-3 text-sm text-[var(--text-muted)]">
        A walkthrough from finding a phone you like to leaving a review after
        it arrives. Every step happens through the seller — ElectroMarket is
        the marketplace; the seller is the merchant.
      </p>

      <Section number="1" title="Find an item">
        <p>
          Use the search bar on the homepage or open{' '}
          <Link href="/browse" className="text-[var(--neon-cyan)] hover:underline">
            Browse
          </Link>{' '}
          to filter by category, condition, price range, and location. Tap the
          heart icon on any card to save it to your dashboard for later.
        </p>
      </Section>

      <Section number="2" title="Check the seller">
        <p>
          On a listing page, click the seller&apos;s name to see their profile,
          reviews, and other listings. Business sellers have a{' '}
          <span className="rounded border border-[var(--neon-cyan)]/30 bg-[var(--tint-cyan)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--neon-cyan)]">
            Business
          </span>{' '}
          badge.
        </p>
        <p>
          Have a question about the item? Use the <strong>Message
          seller</strong> button. Most sellers reply within 24 hours.
        </p>
      </Section>

      <Section number="3" title="Place an order">
        <p>
          Click <strong>Buy now</strong> on the listing. This creates a pending
          order and notifies the seller. The item moves to <em>On hold</em> so
          another buyer can&apos;t snipe it while you&apos;re finalising
          payment.
        </p>
        <p>
          The seller confirms the order — at this point you&apos;ll see the
          payment options they accept.
        </p>
      </Section>

      <Section number="4" title="Pay">
        <p>
          You&apos;ll see one or more of these buttons depending on what the
          seller has enabled:
        </p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong>Pay with Stripe</strong> — credit/debit card, Apple Pay or
            Google Pay. Money goes directly to the seller&apos;s bank.
          </li>
          <li>
            <strong>Pay with Square</strong> — credit/debit card. Money goes
            directly to the seller&apos;s Square account.
          </li>
          <li>
            <strong>Cash or bank transfer</strong> — arrange with the seller in
            the message thread. Mark as paid once the funds clear.
          </li>
        </ul>
        <p>
          ElectroMarket never holds your money. You&apos;re paying the seller
          on their own provider account.
        </p>
      </Section>

      <Section number="5" title="Track shipment">
        <p>
          Once paid, the seller marks the order as <em>Shipped</em> and adds a
          tracking number where available. You&apos;ll get a notification, and
          the order shows in <strong>Dashboard → Buying → In Progress</strong>.
        </p>
      </Section>

      <Section number="6" title="Receive and confirm">
        <p>
          When it arrives, inspect the item. If everything looks right, click{' '}
          <strong>Mark as received</strong> to close the order. If you do
          nothing, the order auto-completes after a delivery window (so
          sellers aren&apos;t left in limbo).
        </p>
      </Section>

      <Section number="7" title="Leave a review">
        <p>
          Completed orders unlock a review. Honest reviews help future buyers
          and reward good sellers — please take 30 seconds to leave one.
        </p>
      </Section>

      <Section number="8" title="If something goes wrong">
        <p>
          Always message the seller first — most issues (delayed shipping,
          minor description mismatches) resolve in one or two messages.
        </p>
        <p>
          If the seller goes silent or refuses to help, click{' '}
          <strong>Open a dispute</strong> on the order. An ElectroMarket
          moderator will read both sides and decide whether to issue a refund
          through the seller&apos;s payment account.
        </p>
        <p>
          Refunds always go back to the original payment method via the
          seller&apos;s Stripe or Square account — they may take a few
          business days to land.
        </p>
      </Section>

      <Section number="9" title="Safety tips">
        <ul className="ml-5 list-disc space-y-2">
          <li>
            Keep all messages on the platform — off-platform deals can&apos;t
            be reviewed by our moderation team.
          </li>
          <li>
            For high-value items, prefer Stripe / Square over cash so you have
            a chargeback option if something goes wrong.
          </li>
          <li>
            Don&apos;t share personal info (passwords, full bank details) in
            messages. Sellers never need them.
          </li>
        </ul>
      </Section>

      <div className="mt-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 text-sm text-[var(--text-muted)]">
        Still have questions?{' '}
        <Link href="/contact" className="font-semibold text-[var(--neon-cyan)] hover:underline">
          Contact us
        </Link>{' '}
        and we&apos;ll get back to you.
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
