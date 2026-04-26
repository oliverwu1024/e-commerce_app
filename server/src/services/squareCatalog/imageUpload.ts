// S3-fetch + Square multipart upload for catalog images.
//
// Why this exists:
//   Square's CreateCatalogImage endpoint accepts ONLY multipart/form-data
//   with an attached image file — there is no "fetch this URL" mode.
//   Listing images live on a public S3 bucket, so we fetch them server-
//   side, stream the bytes into a Blob, and post that to Square.
//
// Validation:
//   - Square accepts JPEG, PJPEG, PNG, GIF (per their docs). We sniff the
//     URL extension first, fall back to Content-Type, and skip anything
//     unsupported with a logged warning.
//   - Square's documented max file size is 15 MB. We enforce that here so
//     a too-big image fails fast instead of after a multi-MB upload.
//
// Idempotency:
//   - The caller passes an idempotencyKey for Square's request-level
//     dedup. Re-running with the same key returns the same image id.
//   - At the application level, the worker checks for an existing
//     ListingImage.squareImageId before calling this and skips upload
//     when present. So the multipart upload only happens once per
//     (listingId, displayOrder) pair, regardless of how many times the
//     listing is re-saved.

import { logger } from '../../utils/logger.js';
import { imageToCatalogObject } from './mapper.js';
import type { CatalogSession } from './oauth.js';

// Square's documented limits.
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/gif',
]);
// Mapping from URL-extension fallback when Content-Type is missing /
// generic ("application/octet-stream" from S3 with no metadata set).
const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
};

export type UploadInput = {
  index: number;       // 0-based position in the listing's image list
  url: string;
  listingId: string;
};

export type UploadResult =
  | { ok: true; squareImageId: string }
  | { ok: false; reason: string };

/**
 * Fetch an image from a (public) URL and upload it to the seller's Square
 * Catalog. Returns the server-assigned image id on success, or a
 * descriptive reason on failure.
 *
 * Failure here is per-image — the caller is expected to swallow it and
 * keep syncing the rest of the listing's images, so a single bad image
 * doesn't block the entire item from appearing in POS.
 */
export async function uploadListingImageToSquare(
  session: CatalogSession,
  input: UploadInput,
  idempotencyKey: string,
): Promise<UploadResult> {
  // Step 1: fetch the image bytes from S3.
  let resp: Response;
  try {
    resp = await fetch(input.url, {
      // Square's docs are silent on timeouts; default Node fetch has none.
      // Use AbortController so a hung CDN can't block the worker forever.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, reason: `fetch image failed: ${String(err)}` };
  }
  if (!resp.ok) {
    return { ok: false, reason: `image URL returned ${resp.status}` };
  }

  // Step 2: validate size + MIME before we accept the bytes.
  const contentLengthHeader = resp.headers.get('content-length');
  if (contentLengthHeader) {
    const declaredBytes = Number(contentLengthHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `image too large: ${declaredBytes} bytes (max ${MAX_FILE_BYTES})`,
      };
    }
  }

  const headerType = resp.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const fallbackType = mimeFromExtension(input.url);
  // Prefer the URL extension over the header — S3 sometimes returns
  // application/octet-stream when bucket policies don't set per-object
  // Content-Type. The extension is what we control on upload, so it's
  // more reliable than the header in our setup.
  const mime = fallbackType ?? (headerType && ALLOWED_MIME.has(headerType) ? headerType : null);
  if (!mime || !ALLOWED_MIME.has(mime)) {
    return {
      ok: false,
      reason: `unsupported MIME (header=${headerType ?? 'none'}, ext=${fallbackType ?? 'none'})`,
    };
  }

  // Step 3: read the body. arrayBuffer() copies the whole stream into
  // memory — fine for ≤15MB, but we still cap before reading so a
  // mis-declared content-length can't blow our heap.
  const buf = await resp.arrayBuffer();
  if (buf.byteLength > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `image too large after fetch: ${buf.byteLength} bytes`,
    };
  }
  if (buf.byteLength === 0) {
    return { ok: false, reason: 'empty image body' };
  }

  // Step 4: build the multipart payload. Square's SDK accepts a Blob.
  // The CatalogObject metadata (name, caption) goes alongside via the
  // `request` field. We deliberately don't set isPrimary because that
  // would replace whatever primary image the seller may have set in POS
  // — surprising behaviour. The resulting image is appended to the
  // item's image_ids list when we upsert with our mapped imageIds.
  const blob = new Blob([buf], { type: mime });
  const filename = filenameFor(input.url, mime);
  // The SDK's `imageFile` slot accepts File / ReadStream / Blob.
  // Wrap as File when available so the multipart filename is preserved
  // (some Node versions don't have a global File until the runtime
  // supports it; fall back to Blob with the right type).
  const fileLike: Blob =
    typeof File !== 'undefined' ? new File([blob], filename, { type: mime }) : blob;

  const start = Date.now();
  try {
    const result = await session.client.catalog.images.create({
      request: {
        idempotencyKey,
        // Don't pre-attach to an objectId — the upsert wires the
        // image into the item via item_data.image_ids.
        image: imageToCatalogObject(input.index, input.url, input.listingId),
      },
      imageFile: fileLike,
    });
    const id = result.image?.id;
    if (!id) {
      return { ok: false, reason: 'Square returned no image id' };
    }
    logger.info('square.catalog.image.uploaded', {
      listingId: input.listingId,
      index: input.index,
      bytes: buf.byteLength,
      mime,
      durationMs: Date.now() - start,
      squareImageId: id,
    });
    return { ok: true, squareImageId: id };
  } catch (err) {
    return { ok: false, reason: `Square upload failed: ${String(err)}` };
  }
}

function mimeFromExtension(url: string): string | null {
  // Strip any query string + fragment before sniffing.
  const path = url.split('?')[0].split('#')[0];
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return EXT_TO_MIME[ext] ?? null;
}

function filenameFor(url: string, mime: string): string {
  const path = url.split('?')[0].split('#')[0];
  const slash = path.lastIndexOf('/');
  const candidate = slash >= 0 ? path.slice(slash + 1) : path;
  // Strip non-printable chars; Square doesn't impose a strict limit but
  // keep filenames sensible for the seller's POS dashboard.
  const safe = candidate.replace(/[^\w.-]/g, '_');
  if (safe && safe.includes('.')) return safe;
  // No extension — synthesise one from the MIME so Square doesn't reject.
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'gif';
  return (safe || 'image') + '.' + ext;
}
