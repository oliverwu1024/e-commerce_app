import { z } from 'zod';
import { uuidSchema } from './common.js';

export const createReviewSchema = z.object({
  orderId: uuidSchema,
  rating: z
    .number({ message: 'Rating is required' })
    .int('Rating must be a whole number')
    .min(1, 'Rating must be between 1 and 5')
    .max(5, 'Rating must be between 1 and 5'),
  comment: z
    .string()
    .trim()
    .max(2000, 'Comment must be 2000 characters or fewer')
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const sellerReviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});
