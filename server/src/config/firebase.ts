// Firebase Admin SDK initialisation. Used only for verifying client-issued
// Phone-Auth ID tokens — we never sign tokens ourselves, never read other
// user data, never use any other Firebase service.
//
// Service account is provided via FIREBASE_SERVICE_ACCOUNT (JSON string,
// base64-encoded for Railway-friendliness — newlines in the private key
// otherwise get mangled by env-var loaders). Generate it from:
//   Firebase Console → Project Settings → Service accounts → Generate new
// Treat the JSON like a password.

import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { logger } from '../utils/logger.js';

const SERVICE_ACCOUNT_B64 = process.env.FIREBASE_SERVICE_ACCOUNT || '';

export const FIREBASE_ENABLED = Boolean(SERVICE_ACCOUNT_B64);

let _app: App | null = null;
let _auth: Auth | null = null;

function decodeServiceAccount(b64: string): Record<string, unknown> {
  // Accept either raw JSON or base64-encoded JSON. Base64 is the recommended
  // form for Railway / Vercel because their env-var UI strips or escapes
  // newlines from raw JSON, breaking the private_key field.
  const trimmed = b64.trim();
  const isJson = trimmed.startsWith('{');
  const json = isJson ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

function getApp(): App {
  if (_app) return _app;
  if (getApps().length > 0) {
    _app = getApps()[0];
    return _app;
  }
  if (!FIREBASE_ENABLED) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT not set — Firebase Admin cannot init');
  }
  const credentials = decodeServiceAccount(SERVICE_ACCOUNT_B64);
  _app = initializeApp({
    credential: cert(credentials as Parameters<typeof cert>[0]),
  });
  return _app;
}

export function firebaseAuth(): Auth {
  if (_auth) return _auth;
  _auth = getAuth(getApp());
  return _auth;
}

export function verifyFirebaseAtStartup(): void {
  if (!FIREBASE_ENABLED) {
    logger.warn('firebase.init.skipped', { reason: 'FIREBASE_SERVICE_ACCOUNT not set — phone verification will reject' });
    return;
  }
  try {
    const app = getApp();
    // Touch the app's options to confirm the key parsed cleanly.
    const projectId = (app.options.credential as unknown as { projectId?: string })?.projectId
      ?? '(unknown)';
    logger.info('firebase.init.success', { projectId });
  } catch (err) {
    logger.error('firebase.init.failed', { err: String(err) });
  }
}
