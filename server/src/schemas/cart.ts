import { z } from 'zod';
import { uuidSchema } from './common.js';

export const addCartItemSchema = z.object({
  listingId: uuidSchema,
});

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
