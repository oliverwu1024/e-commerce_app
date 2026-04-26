// Password complexity rules. Applied at registration, password change, and
// password reset. NOT applied at login — existing users with weaker passwords
// keep working until they next change/reset their password.
//
// Rule labels are reused by the client-side strength checklist component so
// the wording stays in sync between server errors and client UX.

export type PasswordRule = {
  id: 'length' | 'upper' | 'lower' | 'digit' | 'special';
  label: string;
  test: (pw: string) => boolean;
};

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: 'length', label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { id: 'upper', label: 'At least 1 uppercase letter (A–Z)', test: (pw) => /[A-Z]/.test(pw) },
  { id: 'lower', label: 'At least 1 lowercase letter (a–z)', test: (pw) => /[a-z]/.test(pw) },
  { id: 'digit', label: 'At least 1 number (0–9)', test: (pw) => /[0-9]/.test(pw) },
  {
    id: 'special',
    label: 'At least 1 special character (!@#$%^&* etc)',
    test: (pw) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(pw),
  },
] as const;

export const PASSWORD_MAX_LENGTH = 200;

export type PasswordCheckResult = {
  ok: boolean;
  failed: PasswordRule[];
};

export function checkPassword(pw: string): PasswordCheckResult {
  const failed = PASSWORD_RULES.filter((r) => !r.test(pw));
  return { ok: failed.length === 0, failed };
}

// Single error message surfaced to the client when validation fails. Lists
// the rules that failed so the user knows what to fix without consulting the
// live checklist (which they may not be looking at on submit).
export function passwordErrorMessage(pw: string): string | null {
  const { ok, failed } = checkPassword(pw);
  if (ok) return null;
  return `Password must contain: ${failed.map((r) => r.label).join('; ')}`;
}
