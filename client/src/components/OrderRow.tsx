'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPrice } from '@/types/listings';
import {
  type Order,
  type PaymentMethod,
  ORDER_STATUS_STYLES,
  PAYMENT_METHOD_LABELS,
} from '@/types/orders';
import MessageThread from '@/components/MessageThread';
import { StarInput } from '@/components/Stars';

type Role = 'buyer' | 'seller';

type Props = {
  order: Order;
  role: Role;
  currentUserId: string;
  onChange: () => void;
};

export default function OrderRow({ order, role, currentUserId, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showCompletePicker, setShowCompletePicker] = useState(false);
  const [showPayPicker, setShowPayPicker] = useState(false);
  const [showShipPicker, setShowShipPicker] = useState(false);
  const [trackingInput, setTrackingInput] = useState('');
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState<
    'NOT_RECEIVED' | 'NOT_AS_DESCRIBED' | 'DAMAGED' | 'OTHER'
  >('NOT_RECEIVED');
  const [disputeDescription, setDisputeDescription] = useState('');

  const imageUrl = order.listing.images[0]?.url;
  const otherParty = role === 'buyer' ? order.seller : order.buyer;
  const statusStyle = ORDER_STATUS_STYLES[order.status];
  const createdDate = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(order.createdAt));

  async function handleMutation(
    path: string,
    body?: object,
    confirmMsg?: string,
  ) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    setError('');
    try {
      await api(path, {
        method: 'PUT',
        ...(body && { body: JSON.stringify(body) }),
      });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function handlePay(paymentMethod: PaymentMethod) {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ provider: string; url: string }>(
        `/api/orders/${order.id}/pay`,
        {
          method: 'POST',
          body: JSON.stringify({ paymentMethod }),
        },
      );
      // Leave the app so the provider can process payment.
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start payment');
      setBusy(false);
      setShowPayPicker(false);
    }
  }

  async function handleRefund() {
    // Wallet refunds (Stripe / Square) re-credit the buyer's original card,
    // which usually takes 5–10 days at their bank. CASH / BANK_TRANSFER
    // assume the seller has settled offline; we just record the refund
    // here so the order history is consistent.
    const wallet =
      order.paymentMethod === 'STRIPE' || order.paymentMethod === 'SQUARE';
    const msg = wallet
      ? `Refund A$${order.amount} to the buyer via ${order.paymentMethod}? This is a full refund and cannot be reversed from inside ElectroMarket.`
      : `Mark this order as refunded? You should already have returned the buyer's payment via ${order.paymentMethod ? PAYMENT_METHOD_LABELS[order.paymentMethod] : 'the original method'} before doing this.`;
    if (!confirm(msg)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/orders/${order.id}/refund`, { method: 'POST' });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitDispute() {
    if (disputeDescription.trim().length < 10) {
      setError('Please describe what happened in at least 10 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/orders/${order.id}/disputes`, {
        method: 'POST',
        body: JSON.stringify({
          reason: disputeReason,
          description: disputeDescription.trim(),
        }),
      });
      setShowDisputeForm(false);
      setDisputeDescription('');
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open dispute');
    } finally {
      setBusy(false);
    }
  }

  async function handleShip() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/orders/${order.id}/ship`, {
        method: 'POST',
        body: JSON.stringify(
          trackingInput.trim() ? { trackingNumber: trackingInput.trim() } : {},
        ),
      });
      setShowShipPicker(false);
      setTrackingInput('');
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark as shipped');
    } finally {
      setBusy(false);
    }
  }

  async function handleReceive() {
    if (
      !confirm(
        'Confirm you received the item?\n\nThis will close the order and unlock leaving a review. Only do this once the item is in your hands.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/orders/${order.id}/receive`, { method: 'POST' });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm receipt');
    } finally {
      setBusy(false);
    }
  }

  async function handleAbandon() {
    if (
      !confirm(
        'Release the payment lock?\n\nOnly do this if you closed the payment tab without completing. If your payment actually went through, releasing the lock here will not refund it — contact support instead.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/orders/${order.id}/pay/abandon`, { method: 'POST' });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to release lock');
    } finally {
      setBusy(false);
    }
  }

  // -----------------------------------------------------------------
  // Role + status → available actions
  // -----------------------------------------------------------------
  const actions: React.ReactNode[] = [];

  if (role === 'seller') {
    if (order.status === 'PENDING_CONFIRMATION') {
      actions.push(
        <button
          key="confirm"
          onClick={() => handleMutation(`/api/orders/${order.id}/confirm`)}
          disabled={busy}
          className="rounded-lg bg-[var(--neon-green)] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50 transition-colors"
        >
          Confirm
        </button>,
        <button
          key="decline"
          onClick={() =>
            handleMutation(
              `/api/orders/${order.id}/cancel`,
              undefined,
              'Decline this order? The listing will go back on sale.',
            )
          }
          disabled={busy}
          className="btn-cyber-outline text-xs"
        >
          Decline
        </button>,
      );
    } else if (order.status === 'CONFIRMED') {
      // Hide seller mutations during a live buyer payment session — the
      // server will 409 them anyway. The payment-in-progress banner below
      // explains the state.
      if (order.paymentSessionState !== 'PENDING') {
        actions.push(
          <button
            key="complete"
            onClick={() => setShowCompletePicker((v) => !v)}
            disabled={busy}
            className="btn-cyber-primary text-xs"
          >
            Mark as Paid
          </button>,
          <button
            key="cancel"
            onClick={() =>
              handleMutation(
                `/api/orders/${order.id}/cancel`,
                undefined,
                'Cancel this order? The listing will go back on sale.',
              )
            }
            disabled={busy}
            className="btn-cyber-outline text-xs"
          >
            Cancel
          </button>,
        );
      }
    } else if (order.status === 'PAID') {
      actions.push(
        <button
          key="ship"
          onClick={() => setShowShipPicker((v) => !v)}
          disabled={busy}
          className="btn-cyber-primary text-xs"
        >
          Mark Shipped
        </button>,
        <button
          key="refund"
          onClick={handleRefund}
          disabled={busy}
          className="btn-cyber-outline text-xs"
        >
          Refund
        </button>,
      );
    } else if (order.status === 'SHIPPED' || order.status === 'COMPLETED') {
      // Refund remains available even after shipment — covers item-arrived-
      // damaged and post-completion disputes. Seller is on the hook for
      // recovering the item separately if they refund a shipped order.
      actions.push(
        <button
          key="refund"
          onClick={handleRefund}
          disabled={busy}
          className="btn-cyber-outline text-xs"
        >
          Refund
        </button>,
      );
    }
  } else {
    // buyer
    if (order.status === 'PENDING_CONFIRMATION') {
      actions.push(
        <button
          key="cancel"
          onClick={() =>
            handleMutation(
              `/api/orders/${order.id}/cancel`,
              undefined,
              'Cancel this purchase request?',
            )
          }
          disabled={busy}
          className="btn-cyber-outline text-xs"
        >
          Cancel
        </button>,
      );
    } else if (order.status === 'CONFIRMED') {
      // When a provider payment session is live the server will 409 any
      // Pay / Cancel — hide those and expose the release-lock escape hatch
      // so a buyer who closed the provider tab isn't stuck.
      if (order.paymentSessionState === 'PENDING') {
        actions.push(
          <button
            key="release"
            onClick={handleAbandon}
            disabled={busy}
            className="rounded-lg border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] px-3 py-1.5 text-xs font-medium text-[var(--neon-amber)] hover:brightness-110 disabled:opacity-50 transition-colors"
          >
            Release lock
          </button>,
        );
      } else {
        actions.push(
          <button
            key="pay"
            onClick={() => setShowPayPicker((v) => !v)}
            disabled={busy}
            className="btn-cyber-primary text-xs"
          >
            Pay Now
          </button>,
          <button
            key="cancel"
            onClick={() =>
              handleMutation(
                `/api/orders/${order.id}/cancel`,
                undefined,
                'Cancel this order?',
              )
            }
            disabled={busy}
            className="btn-cyber-outline text-xs"
          >
            Cancel
          </button>,
        );
      }
    } else if (order.status === 'SHIPPED') {
      actions.push(
        <button
          key="receive"
          onClick={handleReceive}
          disabled={busy}
          className="btn-cyber-primary text-xs"
        >
          Mark Received
        </button>,
        <button
          key="dispute"
          onClick={() => setShowDisputeForm((v) => !v)}
          disabled={busy}
          className="btn-cyber-outline text-xs"
        >
          Open dispute
        </button>,
      );
    } else if (order.status === 'PAID') {
      // Buyer can dispute even before shipment — "I paid but the seller went
      // dark" is a real failure mode and shouldn't require waiting for ship.
      actions.push(
        <button
          key="dispute"
          onClick={() => setShowDisputeForm((v) => !v)}
          disabled={busy}
          className="btn-cyber-outline text-xs"
        >
          Open dispute
        </button>,
      );
    } else if (order.status === 'COMPLETED' && !order.review) {
      actions.push(
        <button
          key="review"
          onClick={() => setShowReviewForm((v) => !v)}
          disabled={busy}
          className="rounded-lg bg-[var(--neon-amber)] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50 transition-colors"
        >
          Leave a review
        </button>,
      );
    }
  }

  const otherPartyLabel = role === 'buyer' ? 'Seller' : 'Buyer';

  return (
    <div className="panel clip-corner overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 p-4">
        <Link
          href={`/listings/${order.listing.id}`}
          className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--bg-panel-hi)]"
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={order.listing.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[var(--text-dim)]">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </Link>

        <div className="flex-1 min-w-0">
          <Link
            href={`/listings/${order.listing.id}`}
            className="block text-sm font-medium text-[var(--text-primary)] truncate hover:text-[var(--neon-cyan)] transition-colors"
          >
            {order.listing.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-md px-2 py-0.5 font-medium ${statusStyle.bg}`}>
              {statusStyle.label}
            </span>
            <span className="text-[var(--text-muted)]">
              {otherPartyLabel}:{' '}
              {role === 'buyer' ? (
                <Link
                  href={`/sellers/${otherParty.id}`}
                  className="text-[var(--text-muted)] hover:text-[var(--neon-cyan)] hover:underline transition-colors"
                >
                  {otherParty.username}
                </Link>
              ) : (
                <span className="text-[var(--text-muted)]">{otherParty.username}</span>
              )}
            </span>
            <span className="text-[var(--text-dim)]">&middot;</span>
            <span className="text-[var(--text-dim)]">{createdDate}</span>
            {order.paymentMethod && (
              <>
                <span className="text-[var(--text-dim)]">&middot;</span>
                <span className="text-[var(--text-muted)]">
                  Paid: {PAYMENT_METHOD_LABELS[order.paymentMethod]}
                </span>
              </>
            )}
            {order.trackingNumber && (
              <>
                <span className="text-[var(--text-dim)]">&middot;</span>
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--tint-cyan)] px-1.5 py-0.5 font-medium text-[var(--neon-cyan)]">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                  </svg>
                  {order.trackingNumber}
                </span>
              </>
            )}
            {role === 'buyer' && order.review && (
              <>
                <span className="text-[var(--text-dim)]">&middot;</span>
                <Link
                  href={`/sellers/${order.seller.id}?tab=reviews`}
                  className="inline-flex items-center gap-1 rounded-md bg-[var(--tint-amber)] px-1.5 py-0.5 font-medium text-[var(--neon-amber)] hover:brightness-110 transition-colors"
                >
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  Reviewed {order.review.rating}
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 text-right">
          <p className="text-sm font-bold text-[var(--text-primary)]">
            {formatPrice(order.amount)}
          </p>
          {actions.length > 0 && (
            <div className="mt-2 flex gap-2 justify-end">{actions}</div>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-t border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] px-4 py-2 text-xs text-[var(--neon-danger)]">
          {error}
        </div>
      )}

      {/* Payment-in-progress notice — visible to whichever role is looking at
          an order whose buyer has a live provider session. Explains why the
          usual actions are gone and (for the buyer) how to recover. */}
      {order.status === 'CONFIRMED' &&
        order.paymentSessionState === 'PENDING' && (
          <div className="border-t border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] px-4 py-2 text-xs text-[var(--neon-amber)]">
            {role === 'buyer' ? (
              <>
                Payment is in progress. If you closed the payment tab without
                completing, click{' '}
                <span className="font-medium">Release lock</span> to try again.
              </>
            ) : (
              <>
                The buyer has an online payment in progress. Mark Paid and
                Cancel are disabled until the payment completes or is
                released.
              </>
            )}
          </div>
        )}

      {/* Review form — buyer, completed, not yet reviewed */}
      {showReviewForm && role === 'buyer' && order.status === 'COMPLETED' && !order.review && (
        <ReviewForm
          orderId={order.id}
          sellerUsername={order.seller.username}
          onCancel={() => setShowReviewForm(false)}
          onSubmitted={() => {
            setShowReviewForm(false);
            onChange();
          }}
        />
      )}

      {/* Payment picker — seller completing manually */}
      {showCompletePicker && role === 'seller' && order.status === 'CONFIRMED' && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-4">
          <p className="text-xs font-medium text-[var(--text-primary)] mb-2">
            How did the buyer pay you?
          </p>
          <div className="flex flex-wrap gap-2">
            {(['CASH', 'BANK_TRANSFER'] as const).map((pm) => (
              <button
                key={pm}
                onClick={() =>
                  handleMutation(`/api/orders/${order.id}/complete`, {
                    paymentMethod: pm,
                  })
                }
                disabled={busy}
                className="rounded-lg border border-[var(--border-hi)] bg-[var(--bg-panel)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:border-[var(--neon-cyan)] hover:bg-[var(--tint-cyan)] hover:text-[var(--neon-cyan)] disabled:opacity-50 transition-colors"
              >
                {PAYMENT_METHOD_LABELS[pm]}
              </button>
            ))}
            <button
              onClick={() => setShowCompletePicker(false)}
              disabled={busy}
              className="btn-cyber-ghost text-xs"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Online payments (Stripe, Square) are processed automatically when
            the buyer pays — only record here for offline payments.
          </p>
        </div>
      )}

      {/* Ship picker — seller marking PAID order as shipped */}
      {showShipPicker && role === 'seller' && order.status === 'PAID' && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-4">
          <p className="mb-2 text-xs font-medium text-[var(--text-primary)]">
            Tracking number{' '}
            <span className="font-normal text-[var(--text-dim)]">(optional)</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={trackingInput}
              onChange={(e) => setTrackingInput(e.target.value)}
              maxLength={100}
              placeholder="e.g. ABCD1234567"
              disabled={busy}
              className="input-cyber min-w-0 flex-1 px-3 py-1.5 text-xs sm:flex-initial sm:w-64"
            />
            <button
              onClick={handleShip}
              disabled={busy}
              className="btn-cyber-primary text-xs"
            >
              {busy ? 'Shipping…' : 'Confirm Shipped'}
            </button>
            <button
              onClick={() => {
                setShowShipPicker(false);
                setTrackingInput('');
              }}
              disabled={busy}
              className="btn-cyber-ghost text-xs"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Tracking number is shown to the buyer so they can follow the parcel. Leave blank
            if you handed the item over in person.
          </p>
        </div>
      )}

      {/* Payment picker — buyer paying online. Only shows providers the
          seller has actually connected (server filters seller.paymentAccounts
          to ACTIVE + chargesEnabled only, so presence here = safe to render). */}
      {showPayPicker && role === 'buyer' && order.status === 'CONFIRMED' && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-4">
          <p className="text-xs font-medium text-[var(--text-primary)] mb-2">
            Choose how to pay online:
          </p>
          <div className="flex flex-wrap gap-2">
            {order.seller.paymentAccounts.some((a) => a.provider === 'STRIPE') && (
              <PaymentOption label="Stripe" onClick={() => handlePay('STRIPE')} disabled={busy} />
            )}
            {order.seller.paymentAccounts.some((a) => a.provider === 'SQUARE') && (
              <PaymentOption label="Square" onClick={() => handlePay('SQUARE')} disabled={busy} />
            )}
            <button
              onClick={() => setShowPayPicker(false)}
              disabled={busy}
              className="btn-cyber-ghost text-xs"
            >
              Cancel
            </button>
          </div>
          {order.seller.paymentAccounts.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              This seller hasn&apos;t enabled online payments yet. Arrange cash
              or bank transfer with them through the messages below — they&apos;ll
              mark the order as paid once payment is received.
            </p>
          ) : (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Or arrange cash / bank transfer with the seller directly through the messages
              below. They&apos;ll mark the order as paid once payment is received.
            </p>
          )}
        </div>
      )}

      {/* Dispute form — buyer opening a dispute on PAID/SHIPPED/COMPLETED */}
      {showDisputeForm && role === 'buyer' && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-4 space-y-3">
          <p className="text-xs font-medium text-[var(--text-primary)]">
            Open a dispute on this order
          </p>
          <div>
            <label className="text-[11px] text-[var(--text-muted)]">What went wrong?</label>
            <select
              value={disputeReason}
              onChange={(e) =>
                setDisputeReason(e.target.value as typeof disputeReason)
              }
              disabled={busy}
              className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2 text-xs text-[var(--text-primary)]"
            >
              <option value="NOT_RECEIVED">I never received the item</option>
              <option value="NOT_AS_DESCRIBED">It&apos;s not as described</option>
              <option value="DAMAGED">Arrived damaged</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <textarea
            value={disputeDescription}
            onChange={(e) => setDisputeDescription(e.target.value)}
            placeholder="Describe what happened (10–2000 characters). Include dates, what was promised vs received, photos uploaded elsewhere if relevant."
            rows={4}
            maxLength={2000}
            disabled={busy}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2 text-xs text-[var(--text-primary)]"
          />
          <p className="text-[11px] text-[var(--text-dim)]">
            We&apos;ll notify the seller and mediate. ElectroMarket can&apos;t reverse a
            transaction directly — refunds (if any) come from the seller via the same
            payment method you paid with.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSubmitDispute}
              disabled={busy || disputeDescription.trim().length < 10}
              className="btn-cyber-primary text-xs disabled:opacity-50"
            >
              {busy ? 'Submitting…' : 'Open dispute'}
            </button>
            <button
              onClick={() => {
                setShowDisputeForm(false);
                setDisputeDescription('');
                setError('');
              }}
              disabled={busy}
              className="btn-cyber-ghost text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full border-t border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-panel-hi)] hover:text-[var(--text-primary)] flex items-center justify-center gap-1 transition-colors"
      >
        <span>{expanded ? 'Hide details' : 'View messages & details'}</span>
        <svg
          className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-4 space-y-4">
          <div className="text-xs text-[var(--text-muted)] font-mono">
            Order ID: <span className="text-[var(--text-primary)]">{order.id}</span>
          </div>
          <MessageThread
            endpoint={`/api/orders/${order.id}/messages`}
            currentUserId={currentUserId}
            otherPartyName={otherParty.username}
          />
        </div>
      )}
    </div>
  );
}

function PaymentOption({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-[var(--border-hi)] bg-[var(--bg-panel)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:border-[var(--neon-cyan)] hover:bg-[var(--tint-cyan)] hover:text-[var(--neon-cyan)] disabled:opacity-50 transition-colors"
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Review form (inline)
// ---------------------------------------------------------------------------

function ReviewForm({
  orderId,
  sellerUsername,
  onCancel,
  onSubmitted,
}: {
  orderId: string;
  sellerUsername: string;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Synchronous guard — setSubmitting is async, so two rapid clicks can both
  // reach the fetch before the button disables. A ref flips immediately.
  const submittingRef = useRef(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (rating < 1) {
      setError('Please choose a rating');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      await api('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          rating,
          ...(comment.trim() && { comment: comment.trim() }),
        }),
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review');
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-[var(--border-subtle)] bg-[var(--tint-amber)] p-4 space-y-3"
    >
      <div>
        <p className="text-sm font-medium text-[var(--text-primary)]">
          Review your purchase from {sellerUsername}
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Reviews help other buyers and are visible on the seller&apos;s profile.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--text-primary)] mb-1">
          Rating
        </label>
        <StarInput value={rating} onChange={setRating} disabled={submitting} />
      </div>

      <div>
        <label
          htmlFor={`review-comment-${orderId}`}
          className="block text-xs font-medium text-[var(--text-primary)] mb-1"
        >
          Comment <span className="text-[var(--text-dim)]">(optional, max 2000 chars)</span>
        </label>
        <textarea
          id={`review-comment-${orderId}`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={2000}
          rows={3}
          disabled={submitting}
          placeholder={`How was your experience with ${sellerUsername}?`}
          className="input-cyber w-full resize-none px-3 py-2 text-sm disabled:opacity-60"
        />
        <p className="mt-1 text-right text-[10px] text-[var(--text-dim)]">
          {comment.length}/2000
        </p>
      </div>

      {error && (
        <p className="text-xs text-[var(--neon-danger)]">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="btn-cyber-outline text-xs"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || rating < 1}
          className="btn-cyber-primary text-xs"
        >
          {submitting ? 'Submitting...' : 'Submit review'}
        </button>
      </div>
    </form>
  );
}
