import { z } from 'zod';

export const disputeReasonSchema = z.enum([
  'NOT_RECEIVED',
  'NOT_AS_DESCRIBED',
  'DAMAGED',
  'OTHER',
]);

// Buyer creates a dispute on a paid order. Description is mandatory — even
// for "not received" we want some specifics so the seller has something
// concrete to respond to (postage method, expected window, etc.).
export const createDisputeSchema = z.object({
  reason: disputeReasonSchema,
  description: z
    .string()
    .trim()
    .min(10, 'Please describe what happened in at least 10 characters')
    .max(2000, 'Description must be 2000 characters or fewer'),
});

export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;

export const resolveDisputeSchema = z.object({
  outcome: z.enum(['RESOLVED_REFUND', 'RESOLVED_NO_REFUND']),
  resolutionNote: z
    .string()
    .trim()
    .min(1, 'Resolution note is required')
    .max(2000, 'Resolution note must be 2000 characters or fewer'),
});

export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;

// Buyer or seller posts a message on the dispute thread. Same length cap as
// the initial description.
export const disputeMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message must be 2000 characters or fewer'),
});

export type DisputeMessageInput = z.infer<typeof disputeMessageSchema>;

// Seller closes a dispute on their own (typically after refunding). Note is
// optional — sometimes "I refunded you, here's the receipt" doesn't need
// extra words.
export const resolveBySellerSchema = z.object({
  resolutionNote: z
    .string()
    .trim()
    .max(2000, 'Resolution note must be 2000 characters or fewer')
    .optional(),
});

export type ResolveBySellerInput = z.infer<typeof resolveBySellerSchema>;
