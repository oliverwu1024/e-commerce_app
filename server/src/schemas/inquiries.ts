import { z } from 'zod';

export const createInquirySchema = z.object({
  listingId: z.string().uuid('Invalid listing ID'),
  content: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message must be 2000 characters or fewer'),
});

export type CreateInquiryInput = z.infer<typeof createInquirySchema>;

export const inquiryMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message must be 2000 characters or fewer'),
});

export type InquiryMessageInput = z.infer<typeof inquiryMessageSchema>;

export const inquiryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  // Defaults to OPEN — closed inquiries are hidden unless explicitly asked for.
  status: z.enum(['OPEN', 'CLOSED', 'ALL']).optional().default('OPEN'),
});

export type InquiryListQuery = z.infer<typeof inquiryListQuerySchema>;
