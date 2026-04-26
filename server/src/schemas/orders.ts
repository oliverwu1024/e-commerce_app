import { z } from 'zod';
import { uuidSchema } from './common.js';

// Buyer-supplied delivery address for POST orders. Server stores this
// verbatim on the Order as JSON — no normalization beyond trimming and
// length caps. Validation here protects the DB; the Order API echoes it
// back unchanged.
export const shippingAddressSchema = z.object({
  name: z.string().trim().min(1, 'Recipient name is required').max(100),
  line1: z.string().trim().min(1, 'Address is required').max(200),
  line2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(1, 'City / suburb is required').max(100),
  region: z.string().trim().min(1, 'State / region is required').max(100),
  postcode: z.string().trim().min(1, 'Postcode is required').max(20),
  country: z.string().trim().min(1, 'Country is required').max(100),
});

export type ShippingAddressInput = z.infer<typeof shippingAddressSchema>;

// Per-item fulfillment choice the buyer makes at checkout.
const checkoutItemSchema = z.object({
  listingId: uuidSchema,
  fulfillmentMethod: z.enum(['POST', 'PICKUP'], {
    message: 'Fulfillment method must be POST or PICKUP',
  }),
});

// Single shipping address per checkout — applies to every POST item in
// the cart. Address is required iff at least one item is POST. The route
// also revalidates against listing.fulfillmentMethod since the client's
// claim alone isn't authoritative.
export const checkoutSchema = z.object({
  items: z.array(checkoutItemSchema).min(1, 'Checkout must include at least one item'),
  shippingAddress: shippingAddressSchema.nullable().optional(),
}).superRefine((data, ctx) => {
  const anyPost = data.items.some((i) => i.fulfillmentMethod === 'POST');
  if (anyPost && !data.shippingAddress) {
    ctx.addIssue({
      code: 'custom',
      path: ['shippingAddress'],
      message: 'Shipping address is required when posting any item',
    });
  }
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

// Manual completion (seller records that the buyer paid offline). Online
// providers (Stripe, Square) mark orders paid automatically via webhook/
// confirm; only cash / bank transfer use this path.
export const completeOrderSchema = z.object({
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER'], {
    message: 'Payment method must be CASH or BANK_TRANSFER',
  }),
});

export type CompleteOrderInput = z.infer<typeof completeOrderSchema>;

export const messageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message must be 2000 characters or fewer'),
});

export type MessageInput = z.infer<typeof messageSchema>;

export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  status: z
    .enum(['PENDING_CONFIRMATION', 'CONFIRMED', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED'])
    .optional(),
  // Convenience filter for the dashboard's "In Progress" vs "Past" tabs.
  // 'in_progress' = anything that's not COMPLETED or CANCELLED.
  // 'past'        = COMPLETED or CANCELLED.
  bucket: z.enum(['in_progress', 'past']).optional(),
});

export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const shipSchema = z.object({
  trackingNumber: z
    .string()
    .trim()
    .max(100, 'Tracking number must be 100 characters or fewer')
    .optional(),
});

export type ShipInput = z.infer<typeof shipSchema>;

// Seller-initiated refund. Optional reason shown to the buyer + stored
// on the order for the seller's own records. amountCents is optional —
// when omitted, refund the entire remaining refundable balance (the
// "full refund" case). When supplied, it must be > 0 and ≤ remaining;
// the server enforces the upper bound against the order's actual state.
export const refundSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500, 'Reason must be 500 characters or fewer')
    .optional(),
  amountCents: z
    .number()
    .int('Refund amount must be a whole number of cents')
    .positive('Refund amount must be greater than zero')
    .optional(),
});

export type RefundInput = z.infer<typeof refundSchema>;

// Buyer-initiated online payment. Only STRIPE + SQUARE are supported; sellers
// who want another channel (cash / bank transfer / arranged-by-message) use
// the manual completion path instead.
export const paySchema = z.object({
  paymentMethod: z.enum(['STRIPE', 'SQUARE'], {
    message: 'Payment method must be STRIPE or SQUARE',
  }),
});

export type PayInput = z.infer<typeof paySchema>;
