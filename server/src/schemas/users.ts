import { z } from 'zod';

// Accept empty string as "clear this field"; reject whitespace-only strings.
const emptyToNull = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? null : v.trim()));

export const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100).optional(),
  bio: emptyToNull.pipe(z.string().max(500).nullable()),
  location: emptyToNull.pipe(z.string().max(100).nullable()),
  businessName: emptyToNull.pipe(z.string().max(200).nullable()),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(200, 'New password is too long'),
});

// Same format rules as register (kept in sync by copy — if either changes,
// update both). Regex blocks punctuation / emoji so usernames remain URL-safe
// and unambiguous in the /sellers/<uuid> → @username rendering.
export const changeUsernameSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
});

export const changeEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Invalid email address')
    .max(254, 'Email address is too long'),
});

// International phone format: optional leading +, then 8-15 digits.
// E.164 minimum is 8 (country code + subscriber); max is 15.
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-()]/g, ''))
  .pipe(z.string().regex(/^\+?[0-9]{8,15}$/, 'Phone must be 8-15 digits, optional leading +'));

export const startPhoneVerificationSchema = z.object({
  phone: phoneSchema,
});

export const confirmPhoneVerificationSchema = z.object({
  code: z.string().regex(/^[0-9]{6}$/, 'Code must be 6 digits'),
});

export const verifyIdSchema = z.object({
  // The URL returned by the presigned-url endpoint for purpose=id-document.
  // We validate the prefix in the route against user.id so a user can't submit
  // another user's upload URL. Scheme check here is redundant with the prefix
  // check in the handler but keeps the invariant local to the schema.
  documentUrl: z
    .string()
    .url('Invalid document URL')
    .refine((v) => v.startsWith('https://'), 'Document URL must use https'),
});

export const verifyAbnSchema = z.object({
  abn: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, ''))
    .pipe(z.string().regex(/^[0-9]{11}$/, 'ABN must be 11 digits')),
});

export const adminReviewSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('APPROVE') }),
  z.object({
    action: z.literal('REJECT'),
    reason: z
      .string({ message: 'Reason is required for rejection' })
      .trim()
      .min(1, 'Reason is required for rejection')
      .max(500, 'Reason must be under 500 characters'),
  }),
]);

export const pendingVerificationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export const updateAvatarSchema = z.object({
  // The URL returned by the presigned-url endpoint for purpose=avatar.
  // The route handler validates the prefix against the user's id so a
  // user can't claim someone else's upload.
  avatarUrl: z
    .string()
    .url('Invalid avatar URL')
    .refine((v) => v.startsWith('https://'), 'Avatar URL must use https'),
});

// Exact phrase the user must type to confirm destructive account deletion.
// Kept here so the client + server match — if either changes, update both.
export const DELETE_ACCOUNT_PHRASE = 'I confirm the deletion of account';

export const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1, 'Password is required'),
  confirmation: z
    .string()
    .trim()
    .refine(
      (v) => v.toLowerCase() === DELETE_ACCOUNT_PHRASE.toLowerCase(),
      { message: `Please type "${DELETE_ACCOUNT_PHRASE}" to confirm.` },
    ),
});
