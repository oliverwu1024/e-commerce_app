-- Tokens are now stored as SHA-256 hashes, not plaintext. Existing pending
-- tokens won't match the new lookup (hash(URL_token)) so they would silently
-- 401 forever. Null them out — affected users re-request via the resend /
-- forgot-password flows. Both columns are nullable so no default needed.
UPDATE "User"
SET "emailVerificationToken" = NULL,
    "emailVerificationExpires" = NULL
WHERE "emailVerificationToken" IS NOT NULL;

UPDATE "User"
SET "passwordResetToken" = NULL,
    "passwordResetExpires" = NULL
WHERE "passwordResetToken" IS NOT NULL;
