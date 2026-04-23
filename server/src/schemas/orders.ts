import { z } from 'zod';

// Day 16(a) supports manual payment paths only (CASH/BANK_TRANSFER).
// PAYPAL/SQUARE/STRIPE land with Day 16(b) when sandbox keys are in place.
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

// Day 16(b) — buyer-initiated online payment. Seller-type gating is enforced
// in the route handler (PERSONAL sellers are restricted to PAYPAL only).
export const paySchema = z.object({
  paymentMethod: z.enum(['STRIPE', 'SQUARE', 'PAYPAL'], {
    message: 'Payment method must be STRIPE, SQUARE, or PAYPAL',
  }),
});

export type PayInput = z.infer<typeof paySchema>;

export const paypalCaptureSchema = z.object({
  paypalOrderId: z
    .string({ message: 'paypalOrderId is required' })
    .min(1, 'paypalOrderId is required')
    .max(64, 'paypalOrderId is too long'),
});

export type PaypalCaptureInput = z.infer<typeof paypalCaptureSchema>;
