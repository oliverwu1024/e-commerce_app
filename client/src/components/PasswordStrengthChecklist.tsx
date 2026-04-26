'use client';

// Live password strength checklist used by /register, /account/settings
// (change password), and /reset-password. The rules and labels mirror
// server/src/lib/password.ts — when changing them, update both.

type Rule = {
  id: string;
  label: string;
  test: (pw: string) => boolean;
};

const RULES: readonly Rule[] = [
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

export function isPasswordStrong(pw: string): boolean {
  return RULES.every((r) => r.test(pw));
}

export default function PasswordStrengthChecklist({ password }: { password: string }) {
  if (!password) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs" aria-live="polite">
      {RULES.map((rule) => {
        const passed = rule.test(password);
        return (
          <li
            key={rule.id}
            className={`flex items-center gap-2 ${
              passed ? 'text-[var(--neon-green)]' : 'text-[var(--text-muted)]'
            }`}
          >
            <span aria-hidden className="inline-block w-3 text-center font-bold">
              {passed ? '✓' : '✗'}
            </span>
            <span>{rule.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
