import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(100),
  location: z.string().min(1).optional().or(z.literal('').transform(() => undefined)),
  bio: z.string().min(1).max(500).optional().or(z.literal('').transform(() => undefined)),
  sellerType: z.enum(['PERSONAL', 'BUSINESS']).optional().default('PERSONAL'),
  businessName: z.string().max(200).optional(),
  // Cloudflare Turnstile token. Optional in the schema because the server
  // skips verification when TURNSTILE_SECRET_KEY is unset (local dev); the
  // route handler enforces presence in live mode.
  turnstileToken: z.string().max(2048).optional(),
}).refine(
  (data) => data.sellerType !== 'BUSINESS' || (data.businessName && data.businessName.trim().length > 0),
  { message: 'Business name is required for business accounts', path: ['businessName'] },
);

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z
    .string()
    .min(32, 'Invalid reset link')
    .max(128, 'Invalid reset link')
    .regex(/^[a-f0-9]+$/i, 'Invalid reset link'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
