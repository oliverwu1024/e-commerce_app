-- Inbound email support: customer replies to admin replies (and direct cold
-- emails to support@) are received via /api/webhooks/email and stored as
-- ContactReply rows with direction=INBOUND, adminId=null. Outbound (admin)
-- replies keep direction=OUTBOUND with adminId set.

CREATE TYPE "ContactReplyDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- Drop old NOT NULL on adminId so inbound rows can have it null.
ALTER TABLE "ContactReply" DROP CONSTRAINT "ContactReply_adminId_fkey";
ALTER TABLE "ContactReply" ALTER COLUMN "adminId" DROP NOT NULL;
ALTER TABLE "ContactReply"
    ADD CONSTRAINT "ContactReply_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- direction column. Default OUTBOUND so existing rows (admin replies) are
-- correctly tagged without a separate backfill step.
ALTER TABLE "ContactReply"
    ADD COLUMN "direction" "ContactReplyDirection" NOT NULL DEFAULT 'OUTBOUND';

-- Bump body length: inbound emails (with quoted history) routinely exceed
-- the old 5000-char limit.
ALTER TABLE "ContactReply" ALTER COLUMN "body" TYPE VARCHAR(10000);
