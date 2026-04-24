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
