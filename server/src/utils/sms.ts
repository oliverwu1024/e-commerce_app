// SMS sender for phone verification. Live mode = Twilio Programmable SMS;
// dev fallback (creds unset) just logs the body to stdout so local dev never
// needs a Twilio account. Mirrors the email.ts / config/email.ts split at a
// smaller scale — the whole thing is one file because there's exactly one
// SMS template (the OTP).

import type { Twilio } from 'twilio';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM || '';

export const SMS_LIVE =
  Boolean(TWILIO_ACCOUNT_SID) && Boolean(TWILIO_AUTH_TOKEN) && Boolean(TWILIO_FROM);

// Lazy-constructed so boot doesn't fail when creds are absent (local dev).
let _client: Twilio | null = null;
async function getClient(): Promise<Twilio> {
  if (_client) return _client;
  const { default: twilio } = await import('twilio');
  _client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return _client;
}

export async function sendOtpSms(toE164: string, code: string): Promise<void> {
  const body = `Your ElectroMarket code is ${code}. It expires in 10 minutes. If you didn't request this, ignore this message.`;
  if (!SMS_LIVE) {
    console.log(`[sms:dev] would send to ${toE164}: ${body}`);
    return;
  }
  const client = await getClient();
  // Let the caller handle errors. Twilio throws with useful .code / .status
  // on invalid numbers, unreachable carriers, rate limits, etc.
  await client.messages.create({ to: toE164, from: TWILIO_FROM, body });
}

export function verifySmsAtStartup(): void {
  if (SMS_LIVE) {
    console.log(`[sms] Twilio live — from=${TWILIO_FROM} sid=${TWILIO_ACCOUNT_SID.slice(0, 8)}...`);
    return;
  }
  console.warn('[sms] Twilio creds not set — /verify-phone will log OTPs to stdout');
}
