-- AlterEnum
ALTER TYPE "DisputeStatus" ADD VALUE 'RESOLVED_BY_SELLER';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_MESSAGE';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_RESOLVED_BY_SELLER';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_REOPENED';

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN "reopenedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DisputeMessage" (
    "id" TEXT NOT NULL,
    "content" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disputeId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,

    CONSTRAINT "DisputeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisputeMessage_disputeId_createdAt_idx" ON "DisputeMessage"("disputeId", "createdAt");

-- AddForeignKey
ALTER TABLE "DisputeMessage" ADD CONSTRAINT "DisputeMessage_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeMessage" ADD CONSTRAINT "DisputeMessage_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
