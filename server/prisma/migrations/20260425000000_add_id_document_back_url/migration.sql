-- Add back-of-ID column for PERSONAL sellers. Nullable so existing rows
-- (both unsubmitted and the handful that submitted only a front before this
-- migration) keep working. The application layer will gate NEW submissions
-- on both columns being present.
ALTER TABLE "User" ADD COLUMN "idDocumentBackUrl" VARCHAR(500);
