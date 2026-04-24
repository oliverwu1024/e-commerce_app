export const metadata = { title: 'Terms of Service · ElectroMarket' };

// Plain-language marketplace ToS draft. Written deliberately as a starting
// point the operator should run past a lawyer before relying on it in any
// jurisdiction-sensitive situation (tax registration, disputes).
export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold text-[var(--text-primary)]">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Last updated: April 2026. These terms govern your use of
        ElectroMarket. By using the site you agree to them.
      </p>

      <Section title="1. What ElectroMarket is">
        <p>
          ElectroMarket is a <strong>marketplace platform</strong> that lets
          people list used electronics for sale and connects buyers with
          sellers. We do not own, ship, or take custody of any listed items.
        </p>
        <p>
          <strong>ElectroMarket is not a party to any sale.</strong> Each
          transaction is a direct agreement between the buyer and the
          seller.
        </p>
      </Section>

      <Section title="2. Who handles the money">
        <p>
          Online payments are processed by the seller&apos;s own connected
          Stripe or Square account. <strong>Funds go directly to the
          seller</strong> — ElectroMarket never holds, receives, or transmits
          the buyer&apos;s payment. The seller is the merchant of record.
        </p>
        <p>
          Cash and bank-transfer arrangements are made between buyer and
          seller without any involvement from ElectroMarket.
        </p>
      </Section>

      <Section title="3. Platform fee">
        <p>
          ElectroMarket charges the seller a platform fee (5% by default)
          on each completed online payment. The fee is deducted at the time
          of payment through the payment provider&apos;s platform-fee
          mechanism (Stripe <code>application_fee_amount</code>). No separate
          invoice.
        </p>
        <p>
          Cash and bank-transfer sales are free — no platform fee.
        </p>
      </Section>

      <Section title="4. Seller obligations">
        <ul className="ml-5 list-disc space-y-2">
          <li>
            You are solely responsible for your listings, the accuracy of
            descriptions, the condition of items, compliance with local law
            (including GST / sales tax registration where applicable), and
            shipment of sold items.
          </li>
          <li>
            You must complete identity verification (personal ID or ABN for
            business sellers) before listing items.
          </li>
          <li>
            You must maintain an active connected payment account (Stripe
            or Square) to receive online payments; otherwise only cash or
            bank transfer is available.
          </li>
          <li>
            Prohibited items: anything illegal to sell in your jurisdiction,
            stolen goods, items violating intellectual-property rights,
            devices that cannot legally be transferred to a new owner
            (locked / stolen phones, etc.).
          </li>
        </ul>
      </Section>

      <Section title="5. Buyer obligations">
        <ul className="ml-5 list-disc space-y-2">
          <li>
            You pay via the seller&apos;s chosen method. Clicking
            &quot;Pay&quot; on a listing creates a payment directly to the
            seller&apos;s account.
          </li>
          <li>
            Inspect items promptly on delivery. Raise issues with the
            seller first via the order messaging thread.
          </li>
        </ul>
      </Section>

      <Section title="6. Disputes, refunds and chargebacks">
        <p>
          <strong>Disputes are resolved directly between buyer and
          seller.</strong> Because the seller is the merchant of record,
          any refund, chargeback, or claim is processed through the
          seller&apos;s payment provider account (Stripe or Square) — not
          through ElectroMarket.
        </p>
        <p>
          ElectroMarket may, at its discretion, help mediate by contacting
          both parties, but has no authority to issue refunds, reverse
          transfers, or enforce one party&apos;s position. If a dispute
          cannot be resolved between the parties, you may escalate through
          the payment provider&apos;s dispute process (Stripe chargeback
          or Square dispute) or through the relevant small-claims tribunal.
        </p>
        <p>
          Chargebacks and their fees are the seller&apos;s responsibility.
          ElectroMarket does not reimburse sellers for lost chargebacks.
        </p>
      </Section>

      <Section title="7. Account suspension">
        <p>
          We may suspend listings or accounts that violate these terms,
          show fraud indicators, receive repeated dispute rulings against
          them, or fail identity verification. Suspended sellers are
          notified by email and may appeal once.
        </p>
      </Section>

      <Section title="8. Tax">
        <p>
          Sellers are responsible for collecting and remitting any sales
          tax / GST / VAT that applies to their transactions. Stripe and
          Square may issue annual tax forms (1099-K in the US; equivalents
          elsewhere) directly to the seller — ElectroMarket does not issue
          tax forms because we are not the merchant of record.
        </p>
      </Section>

      <Section title="9. Limitation of liability">
        <p>
          ElectroMarket provides the platform &quot;as is&quot;. To the
          extent permitted by law, ElectroMarket is not liable for: losses
          arising from transactions between buyers and sellers; items not
          as described; non-delivery; non-payment by the buyer (beyond
          what the payment provider reverses); data loss; or service
          interruptions.
        </p>
      </Section>

      <Section title="10. Changes">
        <p>
          We may update these terms. Material changes will be announced
          by email at least 14 days before taking effect.
        </p>
      </Section>

      <Section title="11. Contact">
        <p>
          Questions about these terms: use the contact form at{' '}
          <a
            href="/contact"
            className="text-[var(--neon-cyan)] hover:underline"
          >
            /contact
          </a>
          .
        </p>
      </Section>

      <p className="mt-10 rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)]/60 p-4 text-xs text-[var(--text-muted)]">
        <strong className="text-[var(--neon-danger)]">
          Draft — not legal advice.
        </strong>{' '}
        This document is a starting point. Before relying on it
        commercially, have it reviewed by a lawyer in your jurisdiction,
        especially the dispute, tax, and limitation-of-liability sections.
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 space-y-3 text-sm text-[var(--text-primary)]">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-3 text-[var(--text-muted)]">{children}</div>
    </section>
  );
}
