import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

// AES-256-GCM for OAuth tokens at rest (Square access+refresh tokens today;
// easy to reuse for any future at-rest secret). GCM gives authenticated
// encryption — a tampered ciphertext won't decrypt, so token substitution
// attacks fail closed rather than silently producing garbage bytes.
//
// Key: 32 raw bytes, provided as 64 hex chars in PAYMENT_TOKEN_ENCRYPTION_KEY.
// Generate one with `openssl rand -hex 32` and load into Railway / .env.
//
// Format of encrypt() output (base64-encoded single string so it fits in a
// VARCHAR column):   iv (12B) || ciphertext || authTag (16B)
// decrypt() reverses; any mismatch (wrong key, truncation, tamper) throws.

const IV_LENGTH = 12;      // 96 bits — NIST-recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits — GCM default

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.PAYMENT_TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      'PAYMENT_TOKEN_ENCRYPTION_KEY is not set. Generate with `openssl rand -hex 32` ' +
        'and add to environment. This key encrypts seller OAuth tokens at rest — ' +
        'rotating it invalidates every stored token, forcing all connected sellers ' +
        'to re-onboard.',
    );
  }
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error(
      `PAYMENT_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars), got ${buf.length} bytes`,
    );
  }
  cachedKey = buf;
  return buf;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
}

export function decryptToken(ciphertextB64: string): string {
  const buf = Buffer.from(ciphertextB64, 'base64');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Ciphertext too short to contain iv + authTag');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// Null-passthrough for DB columns that are sometimes set, sometimes not.
export function encryptTokenOrNull(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === '') return null;
  return encryptToken(plaintext);
}

export function decryptTokenOrNull(ciphertextB64: string | null | undefined): string | null {
  if (ciphertextB64 == null || ciphertextB64 === '') return null;
  return decryptToken(ciphertextB64);
}
