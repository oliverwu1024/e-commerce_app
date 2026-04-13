import { z } from 'zod';

export const listingQuerySchema = z.object({
  category: z.string().optional(),
  brand: z.string().optional(),
  condition: z.enum(['LIKE_NEW', 'GOOD', 'FAIR', 'POOR']).optional(),
  minPrice: z.coerce.number().min(0, 'Min price must be non-negative').optional(),
  maxPrice: z.coerce.number().min(0, 'Max price must be non-negative').optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc']).optional().default('newest'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
}).refine(
  (data) => !data.minPrice || !data.maxPrice || data.minPrice <= data.maxPrice,
  { message: 'Min price must be less than or equal to max price', path: ['minPrice'] },
);

export type ListingQuery = z.infer<typeof listingQuerySchema>;
