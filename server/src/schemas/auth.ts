import { z } from 'zod';
import { validateAbnChecksum } from '../lib/abn.js';
import { checkPassword, passwordErrorMessage, PASSWORD_MAX_LENGTH } from '../lib/password.js';

const strongPassword = z
  .string()
  .max(PASSWORD_MAX_LENGTH, 'Password is too long')
  .superRefine((pw, ctx) => {
    const { ok } = checkPassword(pw);
    if (!ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: passwordErrorMessage(pw) ?? 'Password does not meet requirements',
      });
    }
  });

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  password: strongPassword,
  name: z.string().min(1, 'Name is required').max(100),
  location: z.string().min(1).optional().or(z.literal('').transform(() => undefined)),
  bio: z.string().min(1).max(500).optional().or(z.literal('').transform(() => undefined)),
  sellerType: z.enum(['PERSONAL', 'BUSINESS']).optional().default('PERSONAL'),
  businessName: z.string().max(200).optional(),
  abn: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, ''))
    .optional()
    .or(z.literal('').transform(() => undefined)),
  // Cloudflare Turnstile token. Optional in the schema because the server
  // skips verification when TURNSTILE_SECRET_KEY is unset (local dev); the
  // route handler enforces presence in live mode.
  turnstileToken: z.string().max(2048).optional(),
}).superRefine((data, ctx) => {
  if (data.sellerType !== 'BUSINESS') return;
  if (!data.businessName || data.businessName.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Business name is required for business accounts',
      path: ['businessName'],
    });
  }
  if (!data.abn) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ABN is required for business accounts',
      path: ['abn'],
    });
    return;
  }
  if (!validateAbnChecksum(data.abn)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid ABN. Check the number and try again.',
      path: ['abn'],
    });
  }
});

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
  password: strongPassword,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
