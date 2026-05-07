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
import DisputeSection from '@/components/DisputeSection';
import { StarInput } from '@/components/Stars';

type Role = 'buyer' | 'seller';

// Mirror of the server-side window in routes/disputes.ts. Buyers can still
// dispute after marking an order received, but only within this window.
const DISPUTE_WINDOW_DAYS = 30;
const DISPUTE_WINDOW_MS = DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

function canDisputeCompleted(order: Order): boolean {
  // One dispute per order — once the buyer files (or had one filed historically)
  // they take all further action through the dispute thread, not by opening a
  // new dispute.
  if (order.dispute) return false;
  if (order.status !== 'COMPLETED' || !order.deliveredAt) return false;
  return Date.now() - new Date(order.deliveredAt).getTime() < DISPUTE_WINDOW_MS;
}

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
  const [showRefundForm, setShowRefundForm] = useState(false);
  // Track the input as a string so the field can be empty mid-edit without
  // the input jumping around (parseFloat('') === NaN). Validated on submit.
  const [refundAmountInput, setRefundAmountInput] = useState('');
  const [refundReasonInput, setRefundReasonInput] = useState('');

  const imageUrl = order.listing.images[0]?.url;
  const otherParty = role === 'buyer' ? order.seller : order.buyer;
  const statusStyle = ORDER_STATUS_STYLES[order.status];
  // CARD-flow orders open a 24h seller-decline window at PAID time. Both
  // surfaces gate UI on this single derived flag — the deadline column also
  // gets cleared by the sweep job after expiry, so a stale deadline doesn't
  // keep the button visible past its window.
  const declineDeadlineMs = order.sellerDeclineDeadline
    ? Date.parse(order.sellerDeclineDeadline)
    : null;
  const declineWindowOpen =
    order.paymentFlow === 'CARD' &&
    order.status === 'PAID' &&
    declineDeadlineMs !== null &&
    declineDeadlineMs > Date.now() &&
    order.paymentSessionState !== 'PENDING';
  // Refund accounting. Order.amount is a string ("19.99"); convert to cents
  // for arithmetic. totalRefundedCents is an Int. remaining < 0 means
  // "fully refunded already" (REFUNDED status); == amount means full,
  // 0 < remaining < amount means a partial has been issued.
  const totalCents = Math.round(parseFloat(order.amount) * 100);
  const remainingCents = Math.max(0, totalCents - order.totalRefundedCents);
  const partialRefundIssued =
    order.totalRefundedCents > 0 && order.status !== 'REFUNDED';
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

  function openRefundForm() {
    // Default the input to the remaining refundable balance — the most
    // common case is "refund the rest." The seller can edit before submit
    // for partial refunds.
    setRefundAmountInput((remainingCents / 100).toFixed(2));
    setRefundReasonInput('');
    setError('');
    setShowRefundForm(true);
  }

  async function handleSubmitRefund() {
    // Validate locally before round-tripping. Server enforces the upper
    // bound but a friendly inline error is better than a 400 toast.
    const dollars = Number(refundAmountInput);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError('Enter a refund amount greater than zero.');
      return;
    }
    const cents = Math.round(dollars * 100);
    if (cents > remainingCents) {
      setError(
        `Refund amount exceeds remaining balance ($${(remainingCents / 100).toFixed(2)}).`,
      );
      return;
    }
    const wallet =
      order.paymentMethod === 'STRIPE' || order.paymentMethod === 'SQUARE';
    const isFull = cents === remainingCents && order.totalRefundedCents === 0;
    const verb = isFull ? 'refund' : cents === remainingCents ? 'finalise the refund of' : 'partially refund';
    const msg = wallet
      ? `${verb[0].toUpperCase()}${verb.slice(1)} A$${(cents / 100).toFixed(2)} to the buyer via ${order.paymentMethod}? This cannot be reversed from inside ElectroMarket.`
      : `${verb[0].toUpperCase()}${verb.slice(1)} A$${(cents / 100).toFixed(2)}? You should already have returned the money via ${order.paymentMethod ? PAYMENT_METHOD_LABELS[order.paymentMethod] : 'the original method'} before clicking confirm.`;
    if (!confirm(msg)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/orders/${order.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({
          amountCents: cents,
          reason: refundReasonInput.trim() || undefined,
        }),
      });
      setShowRefundForm(false);
      setRefundAmountInput('');
      setRefundReasonInput('');
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

  async function handleDecline() {
    if (
      !confirm(
        'Decline this order?\n\nThe buyer will receive a full automatic refund and the order will close. You will not be able to reverse this from inside ElectroMarket.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/orders/${order.id}/decline`, { method: 'POST' });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decline order');
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
          onClick={openRefundForm}
          disabled={busy}
          className="btn-cyber-outline text-xs"
        >
          Refund
        </button>,
      );
      // CARD-flow orders get a one-click decline within the 24h window.
      // Issues a full auto-refund and closes the order — distinct from the
      // partial-refund Refund form above. The window is server-truth; the
      // button is hidden once the sweep nulls the deadline.
      if (declineWindowOpen) {
        actions.push(
          <button
            key="decline"
            onClick={handleDecline}
            disabled={busy}
            className="rounded-lg border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] px-3 py-1.5 text-xs font-medium text-[var(--neon-amber)] hover:brightness-110 disabled:opacity-50 transition-colors"
          >
            Decline (auto-refund)
          </button>,
        );
      }
    } else if (order.status === 'SHIPPED' || order.status === 'COMPLETED') {
      // Refund remains available even after shipment — covers item-arrived-
      // damaged and post-completion disputes. Seller is on the hook for
      // recovering the item separately if they refund a shipped order.
      actions.push(
        <button
          key="refund"
          onClick={openRefundForm}
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
      );
      // Existing dispute hides the Open-dispute button — buyer interacts with
      // it via the dispute section in the expanded view instead.
      if (!order.dispute) {
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
      }
    } else if (order.status === 'PAID') {
      // Buyer can dispute even before shipment — "I paid but the seller went
      // dark" is a real failure mode and shouldn't require waiting for ship.
      if (!order.dispute) {
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
      }
    } else if (order.status === 'COMPLETED') {
      if (!order.review) {
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
      if (canDisputeCompleted(order)) {
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
      }
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
            {partialRefundIssued && (
              <span
                className="rounded-md border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] px-2 py-0.5 font-medium text-[var(--neon-amber)]"
                title="A partial refund has been issued; the order remains otherwise active."
              >
                Refunded ${(order.totalRefundedCents / 100).toFixed(2)} of ${order.amount}
              </span>
            )}
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

      {/* CARD-flow decline-window notice — visible on PAID orders until the
          deadline passes (sweep nulls it). Buyer sees what's happening; seller
          sees their bounded out (the Decline button is in the action row). */}
      {declineWindowOpen && declineDeadlineMs !== null && (
        <div className="border-t border-[var(--neon-cyan)]/40 bg-[var(--tint-cyan)] px-4 py-2 text-xs text-[var(--neon-cyan)]">
          {role === 'buyer' ? (
            <>
              Payment received. The seller has until{' '}
              <span className="font-medium">
                {new Intl.DateTimeFormat('en-AU', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                }).format(new Date(declineDeadlineMs))}
              </span>{' '}
              to decline this order. If they decline, you&apos;ll be refunded
              automatically (5–10 business days to land back on your card).
            </>
          ) : (
            <>
              You can decline this order until{' '}
              <span className="font-medium">
                {new Intl.DateTimeFormat('en-AU', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                }).format(new Date(declineDeadlineMs))}
              </span>
              . After that, ship the item or use Refund if you can&apos;t
              fulfil.
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

      {/* Refund form — seller issuing a (possibly partial) refund */}
      {showRefundForm && role === 'seller' && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-4 space-y-3">
          <p className="text-xs font-medium text-[var(--text-primary)]">
            Issue a refund for this order
          </p>
          {order.totalRefundedCents > 0 && (
            <p className="text-[11px] text-[var(--text-muted)]">
              Already refunded: A${(order.totalRefundedCents / 100).toFixed(2)} of A${order.amount}.
              Remaining refundable: A${(remainingCents / 100).toFixed(2)}.
            </p>
          )}
          <div>
            <label className="text-[11px] text-[var(--text-muted)]">
              Refund amount (AUD)
            </label>
            <input
              type="number"
              value={refundAmountInput}
              onChange={(e) => setRefundAmountInput(e.target.value)}
              min="0.01"
              step="0.01"
              max={(remainingCents / 100).toFixed(2)}
              disabled={busy}
              className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2 text-xs text-[var(--text-primary)]"
            />
          </div>
          <div>
            <label className="text-[11px] text-[var(--text-muted)]">
              Reason (optional, shown to the buyer)
            </label>
            <textarea
              value={refundReasonInput}
              onChange={(e) => setRefundReasonInput(e.target.value)}
              placeholder="e.g. item shipped damaged, partial discount agreed"
              rows={2}
              maxLength={500}
              disabled={busy}
              className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2 text-xs text-[var(--text-primary)]"
            />
          </div>
          <p className="text-[11px] text-[var(--text-dim)]">
            {order.paymentMethod === 'STRIPE' || order.paymentMethod === 'SQUARE'
              ? 'Wallet refunds re-credit the buyer’s original card. Funds typically appear in 5–10 business days.'
              : 'For cash / bank transfer / PayPal, you must have already returned the funds offline. This step only records the refund.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSubmitRefund}
              disabled={busy || !refundAmountInput.trim()}
              className="btn-cyber-primary text-xs disabled:opacity-50"
            >
              {busy ? 'Refunding…' : 'Issue refund'}
            </button>
            <button
              onClick={() => {
                setShowRefundForm(false);
                setRefundAmountInput('');
                setRefundReasonInput('');
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

          <FulfillmentSummary order={order} />

          {order.dispute && (
            <DisputeSection
              order={order}
              currentUserId={currentUserId}
              role={role}
              onChange={onChange}
            />
          )}

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

// Show how the buyer chose to receive the item, the shipping price they
// were charged, and the address (if any). Visible to both buyer and seller
// in the expanded order view.
function FulfillmentSummary({ order }: { order: Order }) {
  const ship = parseFloat(order.shippingPrice);
  const total = parseFloat(order.amount);
  const itemPrice = total - ship;
  const isPost = order.fulfillmentMethod === 'POST';

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 text-xs">
      <p className="font-semibold text-[var(--text-primary)]">
        {isPost ? 'Delivery: Post' : 'Delivery: Pickup'}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--text-muted)]">
        <dt>Item price</dt>
        <dd className="text-right text-[var(--text-primary)]">{formatPrice(itemPrice)}</dd>
        <dt>Shipping</dt>
        <dd className="text-right text-[var(--text-primary)]">
          {isPost ? formatPrice(ship) : 'Pickup'}
        </dd>
        <dt className="font-semibold text-[var(--text-primary)]">Total</dt>
        <dd className="text-right font-semibold text-[var(--text-primary)]">
          {formatPrice(total)}
        </dd>
      </dl>

      {isPost && order.shippingAddress && (
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-2">
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">
            Ship to
          </p>
          <address className="mt-1 not-italic text-[var(--text-primary)]">
            <div>{order.shippingAddress.name}</div>
            <div>{order.shippingAddress.line1}</div>
            {order.shippingAddress.line2 && <div>{order.shippingAddress.line2}</div>}
            <div>
              {order.shippingAddress.city}, {order.shippingAddress.region}{' '}
              {order.shippingAddress.postcode}
            </div>
            <div>{order.shippingAddress.country}</div>
          </address>
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
