-- CreateEnum
CREATE TYPE "SellerType" AS ENUM ('PERSONAL', 'BUSINESS');

-- AlterEnum: convert old PaymentMethod values to new ones
ALTER TABLE "Order" ALTER COLUMN "paymentMethod" TYPE TEXT;
UPDATE "Order" SET "paymentMethod" = 'CASH' WHERE "paymentMethod" = 'IN_PERSON';
UPDATE "Order" SET "paymentMethod" = 'PAYPAL' WHERE "paymentMethod" = 'ONLINE';

DROP TYPE "PaymentMethod";
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'PAYPAL', 'SQUARE', 'STRIPE');
ALTER TABLE "Order" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod" USING "paymentMethod"::"PaymentMethod";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "businessName" TEXT,
ADD COLUMN     "sellerType" "SellerType" NOT NULL DEFAULT 'PERSONAL';
