import { z } from 'zod';

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
    .enum(['PENDING_CONFIRMATION', 'CONFIRMED', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED'])
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

// Buyer-initiated online payment. Only STRIPE + SQUARE are supported; sellers
// who want another channel (cash / bank transfer / arranged-by-message) use
// the manual completion path instead.
export const paySchema = z.object({
  paymentMethod: z.enum(['STRIPE', 'SQUARE'], {
    message: 'Payment method must be STRIPE or SQUARE',
  }),
});

export type PayInput = z.infer<typeof paySchema>;
