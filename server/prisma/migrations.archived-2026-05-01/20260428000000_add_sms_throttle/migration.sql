-- Global daily SMS budget counter. One row per UTC day; /verify-phone
-- refuses once count >= SMS_DAILY_BUDGET. Caps worst-case Twilio bill.
CREATE TABLE "SmsUsageDay" (
    "day" VARCHAR(10) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsUsageDay_pkey" PRIMARY KEY ("day")
);

-- Per-phone-number cooldown. Prevents N attacker accounts targeting the
-- same handset from burning N SMS sends — only one send per
-- SMS_PHONE_COOLDOWN_SECONDS window, regardless of which user requests.
CREATE TABLE "PhoneSmsCooldown" (
    "phone" VARCHAR(20) NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneSmsCooldown_pkey" PRIMARY KEY ("phone")
);
