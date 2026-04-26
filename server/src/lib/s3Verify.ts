// Verify a freshly-uploaded S3 object before trusting its URL on a row in
// the DB. The presigned PUT we hand the client constrains size + Content-
// Type as request HEADERS, but AWS doesn't actually inspect the bytes —
// a hostile client could sign as `image/jpeg`, send arbitrary bytes,
// and S3 stores them with the metadata we asked for. Browsers downstream
// will then trust S3's stored Content-Type, which is whatever the client
// declared.
//
// Mitigation here: server-side HEAD after upload, fail closed if the
// stored ContentType isn't in our allow-list. Cheap, no body fetch,
// catches the common misuse where a user POSTs a URL without having
// uploaded, or uploaded a different file type than requested.
//
// What this DOESN'T catch: a client that signs as image/jpeg AND
// uploads bytes claiming to be image/jpeg but that are actually a
// PDF / executable / SVG-with-script. Closing that requires fetching
// the first ~12 bytes and checking magic numbers (`FF D8 FF` for JPEG,
// `89 50 4E 47` for PNG, etc.). Tracked as future hardening.

import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { s3, S3_BUCKET, S3_REGION } from '../config/s3.js';
import { logger } from '../utils/logger.js';

export type S3VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'wrong_type' | 'too_big' | 'misconfigured'; detail?: string };

export type VerifyOptions = {
  allowedContentTypes: readonly string[];
  // Optional ceiling — additional defence-in-depth even though presigned
  // URLs already cap size at signature time.
  maxBytes?: number;
};

/**
 * Convert a public S3 URL back to a key. Returns null if the URL doesn't
 * point at our bucket.
 */
export function s3KeyFromUrl(url: string): string | null {
  if (!S3_BUCKET) return null;
  const root = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/`;
  if (!url.startsWith(root)) return null;
  return url.slice(root.length);
}

/**
 * HEAD the object and validate its ContentType + ContentLength. Treats
 * 404/403 as "not_found" (caller's URL is bogus or upload didn't land).
 */
export async function verifyS3Upload(
  url: string,
  options: VerifyOptions,
): Promise<S3VerifyResult> {
  if (!S3_BUCKET) {
    return { ok: false, reason: 'misconfigured' };
  }
  const key = s3KeyFromUrl(url);
  if (!key) {
    return { ok: false, reason: 'not_found', detail: 'URL is not under the configured S3 bucket' };
  }
  let head: { ContentType?: string; ContentLength?: number };
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status === 404 || status === 403) {
      return { ok: false, reason: 'not_found' };
    }
    logger.error('s3.verify.head_threw', { key, err: String(err) });
    throw err;
  }

  const contentType = head.ContentType?.toLowerCase().split(';')[0].trim();
  if (!contentType || !options.allowedContentTypes.includes(contentType)) {
    return {
      ok: false,
      reason: 'wrong_type',
      detail: `S3 reports Content-Type=${contentType ?? 'unset'}; expected one of ${options.allowedContentTypes.join(', ')}`,
    };
  }
  if (options.maxBytes != null && head.ContentLength != null && head.ContentLength > options.maxBytes) {
    return {
      ok: false,
      reason: 'too_big',
      detail: `S3 reports ${head.ContentLength} bytes; max ${options.maxBytes}`,
    };
  }
  return { ok: true };
}

// Pre-built allow-lists matching the upload presigned-URL handler in
// routes/uploads.ts. Keep these in sync with that handler.
export const LISTING_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ID_DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
