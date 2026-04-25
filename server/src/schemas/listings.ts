import { z } from 'zod';
import { S3_BUCKET, S3_REGION } from '../config/s3.js';
import { uuidSchema } from './common.js';

// Keep in sync with client/src/types/listings.ts CATEGORIES
const CATEGORIES = [
  'Phones', 'Laptops', 'Desktops', 'Tablets',
  'Consoles', 'Cameras', 'Audio', 'Accessories', 'PC Parts',
] as const;

const s3Prefix = S3_BUCKET
  ? `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/listings/`
  : null;

function imageSchemaForUser(userId: string) {
  return z.object({
    url: z.string().url('Invalid image URL').refine(
      (u) => {
        if (!s3Prefix) return false; // No uploads possible without S3
        return u.startsWith(`${s3Prefix}${userId}/`);
      },
      { message: 'Image must be from your own uploads' },
    ),
    displayOrder: z.number().int().min(0),
  });
}

// Allow 0 for free items. Negative is still rejected. The cross-field
// refines below enforce shipping rules.
const priceSchema = z.number()
  .nonnegative('Price cannot be negative')
  .max(999999.99, 'Price too high')
  .refine(v => {
    const decimals = v.toString().split('.')[1];
    return !decimals || decimals.length <= 2;
  }, { message: 'Price can have at most 2 decimal places' });

const shippingPriceSchema = z.number()
  .nonnegative('Shipping price cannot be negative')
  .max(999999.99, 'Shipping price too high')
  .refine(v => {
    const decimals = v.toString().split('.')[1];
    return !decimals || decimals.length <= 2;
  }, { message: 'Shipping price can have at most 2 decimal places' });

const fulfillmentMethodSchema = z.enum(['POST_ONLY', 'PICKUP_ONLY', 'BOTH'], {
  message: 'Fulfillment method is required',
});

// Shared cross-field rule: any time fulfillmentMethod is in the payload,
// shippingPrice must also be explicit (number when post is offered, null
// for pickup-only). For updates that don't touch fulfillment, both fields
// can be omitted and the existing DB row is preserved.
function fulfillmentRefine<
  T extends { fulfillmentMethod?: 'POST_ONLY' | 'PICKUP_ONLY' | 'BOTH'; shippingPrice?: number | null },
>(data: T, ctx: z.RefinementCtx) {
  const fm = data.fulfillmentMethod;
  if (!fm) return;
  const postEnabled = fm === 'POST_ONLY' || fm === 'BOTH';
  const sp = data.shippingPrice;
  if (sp === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['shippingPrice'],
      message: postEnabled
        ? 'Shipping price is required when post is offered'
        : 'Shipping price must be set when changing to pickup-only',
    });
    return;
  }
  if (postEnabled && sp === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['shippingPrice'],
      message: 'Shipping price is required when post is offered',
    });
  }
  if (!postEnabled && sp !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['shippingPrice'],
      message: 'Shipping price must be empty for pickup-only listings',
    });
  }
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export function createListingSchemaForUser(userId: string) {
  const imgSchema = imageSchemaForUser(userId);
  return z.object({
    title: z.string().min(3, 'Title must be at least 3 characters').max(200),
    description: z.string().min(10, 'Description must be at least 10 characters').max(5000),
    price: priceSchema,
    fulfillmentMethod: fulfillmentMethodSchema,
    // Nullable so PICKUP_ONLY can omit it. Refine below enforces presence
    // when post is enabled.
    shippingPrice: shippingPriceSchema.nullable().optional(),
    category: z.enum(CATEGORIES, { message: 'Invalid category' }),
    subcategory: z.string().max(100).optional(),
    platform: z.string().max(100).optional(),
    brand: z.string().max(100).optional(),
    condition: z.enum(['LIKE_NEW', 'GOOD', 'FAIR', 'POOR'], {
      message: 'Condition is required',
    }),
    images: z.array(imgSchema).max(10, 'Maximum 10 images allowed')
      .refine(imgs => new Set(imgs.map(i => i.displayOrder)).size === imgs.length,
        { message: 'Image display orders must be unique' })
      .optional(),
  }).superRefine(fulfillmentRefine);
}

export type CreateListingInput = z.infer<ReturnType<typeof createListingSchemaForUser>>;

export function updateListingSchemaForUser(userId: string) {
  const imgSchema = imageSchemaForUser(userId);
  return z.object({
    title: z.string().min(3, 'Title must be at least 3 characters').max(200).optional(),
    description: z.string().min(10, 'Description must be at least 10 characters').max(5000).optional(),
    price: priceSchema.optional(),
    fulfillmentMethod: fulfillmentMethodSchema.optional(),
    shippingPrice: shippingPriceSchema.nullable().optional(),
    category: z.enum(CATEGORIES, { message: 'Invalid category' }).optional(),
    subcategory: z.string().max(100).nullable().optional(),
    platform: z.string().max(100).nullable().optional(),
    brand: z.string().max(100).nullable().optional(),
    condition: z.enum(['LIKE_NEW', 'GOOD', 'FAIR', 'POOR']).optional(),
    images: z.array(imgSchema).max(10, 'Maximum 10 images allowed')
      .refine(imgs => new Set(imgs.map(i => i.displayOrder)).size === imgs.length,
        { message: 'Image display orders must be unique' })
      .optional(),
  }).superRefine(fulfillmentRefine);
}

export type UpdateListingInput = z.infer<ReturnType<typeof updateListingSchemaForUser>>;

export const listingQuerySchema = paginationSchema.extend({
  category: z.string().optional(),
  brand: z.string().optional(),
  condition: z.enum(['LIKE_NEW', 'GOOD', 'FAIR', 'POOR']).optional(),
  minPrice: z.coerce.number().min(0, 'Min price must be non-negative').optional(),
  maxPrice: z.coerce.number().min(0, 'Max price must be non-negative').optional(),
  search: z.string().max(200).optional(),
  sellerId: uuidSchema.optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc']).optional().default('newest'),
}).refine(
  (data) => data.minPrice == null || data.maxPrice == null || data.minPrice <= data.maxPrice,
  { message: 'Min price must be less than or equal to max price', path: ['minPrice'] },
);

export type ListingQuery = z.infer<typeof listingQuerySchema>;
