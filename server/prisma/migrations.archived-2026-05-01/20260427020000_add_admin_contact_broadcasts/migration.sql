-- Persisted contact submissions (admin can reply via in-app form, no longer
-- needs to reply from personal email) + Broadcast model (admin announcements
-- to subgroups via email and/or in-app notification).

CREATE TYPE "ContactStatus" AS ENUM ('NEW', 'REPLIED', 'CLOSED');

CREATE TYPE "BroadcastAudience" AS ENUM (
    'ALL_VERIFIED',
    'ALL_SELLERS',
    'BUSINESS_SELLERS',
    'PERSONAL_SELLERS',
    'SELLERS_NO_PAYMENT',
    'CUSTOM_EMAILS'
);

CREATE TABLE "ContactSubmission" (
    "id" TEXT NOT NULL,
    "fromName" VARCHAR(100) NOT NULL,
    "fromEmail" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(150) NOT NULL,
    "message" VARCHAR(3000) NOT NULL,
    "status" "ContactStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "ContactSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactSubmission_status_createdAt_idx" ON "ContactSubmission"("status", "createdAt");
CREATE INDEX "ContactSubmission_fromEmail_idx" ON "ContactSubmission"("fromEmail");

ALTER TABLE "ContactSubmission"
    ADD CONSTRAINT "ContactSubmission_closedById_fkey"
    FOREIGN KEY ("closedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ContactReply" (
    "id" TEXT NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submissionId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,

    CONSTRAINT "ContactReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactReply_submissionId_sentAt_idx" ON "ContactReply"("submissionId", "sentAt");

ALTER TABLE "ContactReply"
    ADD CONSTRAINT "ContactReply_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "ContactSubmission"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactReply"
    ADD CONSTRAINT "ContactReply_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "body" VARCHAR(20000) NOT NULL,
    "audience" "BroadcastAudience" NOT NULL,
    "targetEmails" VARCHAR(5000),
    "channelEmail" BOOLEAN NOT NULL DEFAULT true,
    "channelInApp" BOOLEAN NOT NULL DEFAULT true,
    "audienceCount" INTEGER NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "sentById" TEXT NOT NULL,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Broadcast_createdAt_idx" ON "Broadcast"("createdAt");

ALTER TABLE "Broadcast"
    ADD CONSTRAINT "Broadcast_sentById_fkey"
    FOREIGN KEY ("sentById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
