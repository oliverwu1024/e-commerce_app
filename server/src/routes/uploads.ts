import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { s3, S3_BUCKET, S3_REGION } from '../config/s3.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const PRESIGNED_URL_EXPIRY = 300; // 5 minutes

const presignedUrlSchema = z.object({
  fileType: z.string().refine((t) => t in ALLOWED_TYPES, {
    message: 'File type must be image/jpeg, image/png, or image/webp',
  }),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(MAX_FILE_SIZE, 'File size must be under 5 MB'),
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many upload requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
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

      const { fileType, fileSize } = parsed.data;
      const ext = ALLOWED_TYPES[fileType];
      const key = `listings/${req.userId}/${crypto.randomUUID()}.${ext}`;

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
      console.error('Presigned URL error:', err);
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

export default router;
