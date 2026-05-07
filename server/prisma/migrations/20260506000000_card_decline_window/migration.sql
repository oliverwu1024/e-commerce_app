-- CreateEnum
CREATE TYPE "PaymentFlow" AS ENUM ('CARD', 'OFFLINE');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paymentFlow" "PaymentFlow" NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN     "sellerDeclineDeadline" TIMESTAMP(3);
