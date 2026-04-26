-- Password reset token + expiry. Token is random hex, stored directly (not
-- hashed) to match the existing emailVerificationToken pattern. @unique so
-- the consumer endpoint can look it up by token alone.
ALTER TABLE "User" ADD COLUMN "passwordResetToken" VARCHAR(128);
ALTER TABLE "User" ADD COLUMN "passwordResetExpires" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_passwordResetToken_key" ON "User"("passwordResetToken");
