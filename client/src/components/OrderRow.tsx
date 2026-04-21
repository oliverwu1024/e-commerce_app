'use client';

import { useState } from 'react';
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
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
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
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
        >
          Decline
        </button>,
      );
    } else if (order.status === 'CONFIRMED') {
      actions.push(
        <button
          key="complete"
          onClick={() => setShowCompletePicker((v) => !v)}
          disabled={busy}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
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
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
        >
          Cancel
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
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>,
      );
    } else if (order.status === 'CONFIRMED') {
      actions.push(
        <button
          key="pay"
          onClick={() => setShowPayPicker((v) => !v)}
          disabled={busy}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
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
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>,
      );
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 p-4">
        <Link
          href={`/listings/${order.listing.id}`}
          className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-100"
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={order.listing.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-300">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </Link>

        <div className="flex-1 min-w-0">
          <Link
            href={`/listings/${order.listing.id}`}
            className="block text-sm font-medium text-zinc-900 truncate hover:text-blue-600 transition-colors"
          >
            {order.listing.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-md px-2 py-0.5 font-medium ${statusStyle.bg}`}>
              {statusStyle.label}
            </span>
            <span className="text-zinc-500">
              {role === 'buyer' ? 'Seller' : 'Buyer'}: {otherParty.username}
            </span>
            <span className="text-zinc-400">&middot;</span>
            <span className="text-zinc-400">{createdDate}</span>
            {order.paymentMethod && (
              <>
                <span className="text-zinc-400">&middot;</span>
                <span className="text-zinc-500">
                  Paid: {PAYMENT_METHOD_LABELS[order.paymentMethod]}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 text-right">
          <p className="text-sm font-bold text-zinc-900">
            {formatPrice(order.amount)}
          </p>
          {actions.length > 0 && (
            <div className="mt-2 flex gap-2 justify-end">{actions}</div>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Payment picker — seller completing manually */}
      {showCompletePicker && role === 'seller' && order.status === 'CONFIRMED' && (
        <div className="border-t border-zinc-200 bg-zinc-50 p-4">
          <p className="text-xs font-medium text-zinc-700 mb-2">
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
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 transition-colors"
              >
                {PAYMENT_METHOD_LABELS[pm]}
              </button>
            ))}
            <button
              onClick={() => setShowCompletePicker(false)}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {order.seller.sellerType === 'BUSINESS'
              ? 'Online payments (Stripe, Square, PayPal) are processed automatically when the buyer pays — no need to mark them here.'
              : 'PayPal payments are processed automatically when the buyer pays — no need to mark them here.'}
          </p>
        </div>
      )}

      {/* Payment picker — buyer paying online */}
      {showPayPicker && role === 'buyer' && order.status === 'CONFIRMED' && (
        <div className="border-t border-zinc-200 bg-zinc-50 p-4">
          <p className="text-xs font-medium text-zinc-700 mb-2">
            Choose how to pay online:
          </p>
          <div className="flex flex-wrap gap-2">
            {order.seller.sellerType === 'BUSINESS' && (
              <>
                <PaymentOption label="Stripe" onClick={() => handlePay('STRIPE')} disabled={busy} />
                <PaymentOption label="Square" onClick={() => handlePay('SQUARE')} disabled={busy} />
              </>
            )}
            <PaymentOption label="PayPal" onClick={() => handlePay('PAYPAL')} disabled={busy} />
            <button
              onClick={() => setShowPayPicker(false)}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Or arrange cash / bank transfer with the seller directly through the messages
            below. They&apos;ll mark the order as paid once payment is received.
          </p>
        </div>
      )}

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full border-t border-zinc-200 px-4 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 flex items-center justify-center gap-1 transition-colors"
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
        <div className="border-t border-zinc-200 bg-zinc-50 p-4 space-y-4">
          <div className="text-xs text-zinc-500 font-mono">
            Order ID: <span className="text-zinc-700">{order.id}</span>
          </div>
          <MessageThread
            orderId={order.id}
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
      className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 transition-colors"
    >
      {label}
    </button>
  );
}
