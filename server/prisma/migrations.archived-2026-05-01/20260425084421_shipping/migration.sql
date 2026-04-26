-- DropForeignKey
ALTER TABLE "ContactReply" DROP CONSTRAINT "ContactReply_adminId_fkey";

-- AddForeignKey
ALTER TABLE "ContactReply" ADD CONSTRAINT "ContactReply_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
