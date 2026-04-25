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

// AU-only phone. The /verify-phone endpoint hits Twilio Programmable SMS,
// which bills cross-country at 3-10x the AU rate — restricting to +61
// numbers is our cheapest cost-ceiling defence against toll-fraud attackers
// who'd otherwise route verification codes to expensive international
// destinations. Accept the common local input shapes (`0412 345 678`,
// `(04) 1234 5678`, `+61 412 345 678`) and normalise to E.164 `+61...`.
//
// Valid shapes (after stripping spaces / dashes / parens):
//   +614XXXXXXXX   — 12 chars total (mobile)
//   +612XXXXXXXX   — 12 chars total (landline, kept for flexibility)
//   04XXXXXXXX     — 10 chars, local mobile form (normalised → +614XXXXXXXX)
//   02/03/07/08... — 10 chars, local landline form (normalised → +61...)
//   614XXXXXXXX    — missing leading + (normalised by prefixing +)
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-()]/g, ''))
  .pipe(
    z
      .string()
      .regex(
        /^(\+?61[2-478][0-9]{8}|0[2-478][0-9]{8})$/,
        'Enter an Australian phone number (e.g. 0412 345 678 or +61 412 345 678)',
      ),
  )
  .transform((v) => {
    if (v.startsWith('+61')) return v;
    if (v.startsWith('61')) return `+${v}`;
    // Local 0X... form — strip the trunk-prefix 0 and prepend +61.
    return `+61${v.slice(1)}`;
  });

// Firebase Phone Auth flow: the client uses Firebase's signInWithPhoneNumber,
// which does its own SMS send + reCAPTCHA + code prompt + ID token issuance.
// All we ever see is the resulting ID token — server's job is to verify it
// (signature + expiry) and pluck the verified phone number out of the claims.
export const confirmPhoneVerificationSchema = z.object({
  idToken: z.string().min(20).max(8192, 'Invalid ID token'),
});

export const verifyIdSchema = z.object({
  // Both front + back URLs are required — government IDs (driver's licence,
  // passport card, national ID) always have two sides and admins need both
  // to verify identity. Prefix checks live in the route handler against the
  // caller's userId so a user can't submit another user's upload URL.
  documentUrl: z
    .string()
    .url('Invalid front document URL')
    .refine((v) => v.startsWith('https://'), 'Front document URL must use https'),
  documentBackUrl: z
    .string()
    .url('Invalid back document URL')
    .refine((v) => v.startsWith('https://'), 'Back document URL must use https'),
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
