import { z } from 'zod';

export const notificationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  // ?unread=1 filters to unread only. Default is all.
  unread: z
    .union([z.literal('1'), z.literal('true')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export const markReadSchema = z
  .object({
    ids: z.array(z.string().uuid()).max(100).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => v.all === true || (v.ids && v.ids.length > 0), {
    message: 'Provide either ids[] or all=true',
  });
