// Firebase JS SDK initialisation. Used only for Phone Auth — we don't use
// any other Firebase service (analytics, firestore, etc.). Each NEXT_PUBLIC_*
// var is browser-exposed by design; the API key is a project identifier,
// not a secret (Firebase relies on Authorized Domains to gate access).
//
// Lazy init so that pre-render / static-export passes don't choke on the
// missing window object — call getFirebaseAuth() from a 'use client'
// component once the user opens the verification page.

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const FIREBASE_CONFIGURED =
  Boolean(firebaseConfig.apiKey) &&
  Boolean(firebaseConfig.authDomain) &&
  Boolean(firebaseConfig.projectId);

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

function getApp(): FirebaseApp {
  if (_app) return _app;
  const existing = getApps();
  if (existing.length > 0) {
    _app = existing[0];
    return _app;
  }
  if (!FIREBASE_CONFIGURED) {
    throw new Error('Firebase not configured — set NEXT_PUBLIC_FIREBASE_* env vars');
  }
  _app = initializeApp(firebaseConfig);
  return _app;
}

export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  _auth = getAuth(getApp());
  return _auth;
}
