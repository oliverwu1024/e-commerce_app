import { z } from 'zod';

// Keep in sync with client/src/types/listings.ts CATEGORIES
const CATEGORIES = [
  'Phones', 'Laptops', 'Desktops', 'Tablets',
  'Consoles', 'Cameras', 'Audio', 'Accessories', 'PC Parts',
] as const;

const imageSchema = z.object({
  url: z.string().url('Invalid image URL').refine(
    (u) => u.startsWith('https://') || u.startsWith('http://'),
    { message: 'Image URL must use http or https' },
  ),
  displayOrder: z.number().int().min(0),
});

const priceSchema = z.number()
  .positive('Price must be greater than 0')
  .max(999999.99, 'Price too high')
  .refine(v => {
    const decimals = v.toString().split('.')[1];
    return !decimals || decimals.length <= 2;
  }, { message: 'Price can have at most 2 decimal places' });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const createListingSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().min(10, 'Description must be at least 10 characters').max(5000),
  price: priceSchema,
  category: z.enum(CATEGORIES, { message: 'Invalid category' }),
  subcategory: z.string().optional(),
  platform: z.string().optional(),
  brand: z.string().max(100).optional(),
  condition: z.enum(['LIKE_NEW', 'GOOD', 'FAIR', 'POOR'], {
    message: 'Condition is required',
  }),
  images: z.array(imageSchema).max(10, 'Maximum 10 images allowed')
    .refine(imgs => new Set(imgs.map(i => i.displayOrder)).size === imgs.length,
      { message: 'Image display orders must be unique' })
    .optional(),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;

export const updateListingSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200).optional(),
  description: z.string().min(10, 'Description must be at least 10 characters').max(5000).optional(),
  price: priceSchema.optional(),
  category: z.enum(CATEGORIES, { message: 'Invalid category' }).optional(),
  subcategory: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  brand: z.string().max(100).nullable().optional(),
  condition: z.enum(['LIKE_NEW', 'GOOD', 'FAIR', 'POOR']).optional(),
  images: z.array(imageSchema).max(10, 'Maximum 10 images allowed')
    .refine(imgs => new Set(imgs.map(i => i.displayOrder)).size === imgs.length,
      { message: 'Image display orders must be unique' })
    .optional(),
});

export type UpdateListingInput = z.infer<typeof updateListingSchema>;

export const listingQuerySchema = paginationSchema.extend({
  category: z.string().optional(),
  brand: z.string().optional(),
  condition: z.enum(['LIKE_NEW', 'GOOD', 'FAIR', 'POOR']).optional(),
  minPrice: z.coerce.number().min(0, 'Min price must be non-negative').optional(),
  maxPrice: z.coerce.number().min(0, 'Max price must be non-negative').optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc']).optional().default('newest'),
}).refine(
  (data) => data.minPrice == null || data.maxPrice == null || data.minPrice <= data.maxPrice,
  { message: 'Min price must be less than or equal to max price', path: ['minPrice'] },
);

export type ListingQuery = z.infer<typeof listingQuerySchema>;
