import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { s3, S3_BUCKET, S3_REGION } from '../config/s3.js';
import { authenticate } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { logger } from '../utils/logger.js';

const router = Router();

const LISTING_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// ID documents: images OR PDFs (common for government-issued scans).
const ID_DOCUMENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

// Avatars are public-facing profile photos; same image set as listings,
// no PDFs, tighter size cap since they're rendered at small dimensions.
const AVATAR_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Listing videos: MP4 + WebM only. MOV is omitted on purpose — its
// container is essentially the same `ftyp` box as MP4 but some MOV
// files use codecs (ProRes, HEVC variants) that don't play in non-Safari
// browsers without transcoding, and we don't have a transcode pipeline.
const LISTING_VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_LISTING_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB
const PRESIGNED_URL_EXPIRY = 300; // 5 minutes

const presignedUrlSchema = z.object({
  fileType: z.string(),
  fileSize: z.number().int().positive(),
  purpose: z
    .enum(['listing', 'id-document', 'avatar', 'listing-video'])
    .optional()
    .default('listing'),
});

const uploadLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many upload requests, please try again later' },
});

// POST /api/uploads/presigned-url — Generate a presigned S3 PUT URL
router.post(
  '/presigned-url',
  authenticate,
  uploadLimiter,
  async (req: Request, res: Response) => {
    try {
      if (!S3_BUCKET) {
        res.status(503).json({
          error: 'Image uploads are not available at this time.',
        });
        return;
      }

      const parsed = presignedUrlSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message });
        return;
      }

      const { fileType, fileSize, purpose } = parsed.data;

      // Per-purpose type + size limits. Avatars use a smaller cap than
      // listings because they're shown at thumbnail dimensions everywhere.
      // Videos get a much larger cap (100 MB) since 1080p H.264 runs
      // ~5-15 MB / 30s and we want sellers to be able to post a short
      // demo without aggressive transcoding on their end.
      const allowedTypes =
        purpose === 'id-document'
          ? ID_DOCUMENT_TYPES
          : purpose === 'avatar'
          ? AVATAR_TYPES
          : purpose === 'listing-video'
          ? LISTING_VIDEO_TYPES
          : LISTING_TYPES;
      const sizeCap =
        purpose === 'avatar'
          ? MAX_AVATAR_SIZE
          : purpose === 'listing-video'
          ? MAX_LISTING_VIDEO_SIZE
          : MAX_FILE_SIZE;
      if (fileSize > sizeCap) {
        res.status(400).json({
          error: `File size must be under ${Math.round(sizeCap / 1024 / 1024)} MB`,
        });
        return;
      }
      if (!(fileType in allowedTypes)) {
        const allowedList =
          purpose === 'id-document'
            ? 'image/jpeg, image/png, or application/pdf'
            : purpose === 'listing-video'
            ? 'video/mp4 or video/webm'
            : 'image/jpeg, image/png, or image/webp';
        res.status(400).json({ error: `File type must be ${allowedList}` });
        return;
      }
      const ext = allowedTypes[fileType];
      // Dev shortcut: avatars are stored under `listings/avatars/<userId>/`
      // rather than the semantically-cleaner `avatars/<userId>/` so they
      // piggy-back on the existing `listings/*` IAM PutObject + bucket
      // public-read policy. Before prod: widen both policies to include
      // `avatars/*` and flip this back to `avatars/${userId}`. Videos
      // sit under `listings/<userId>/videos/` for the same reason — same
      // IAM and bucket policy as listings/*, separate folder so search
      // tooling can distinguish images from videos by key prefix.
      const prefix =
        purpose === 'id-document'
          ? `id-documents/${req.userId}`
          : purpose === 'avatar'
          ? `listings/avatars/${req.userId}`
          : purpose === 'listing-video'
          ? `listings/${req.userId}/videos`
          : `listings/${req.userId}`;
      const key = `${prefix}/${crypto.randomUUID()}.${ext}`;

      const command = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ContentType: fileType,
        ContentLength: fileSize,
      });

      const uploadUrl = await getSignedUrl(s3, command, {
        expiresIn: PRESIGNED_URL_EXPIRY,
      });

      const fileUrl = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;

      res.json({ uploadUrl, fileUrl, key });
    } catch (err) {
      logger.error('uploads.presigned_url.failed', { err: String(err) });
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

export default router;
