import { S3Client } from '@aws-sdk/client-s3';

export const S3_REGION = process.env.AWS_REGION || 'ap-southeast-2';

export const s3 = new S3Client({
  region: S3_REGION,
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
});

export const S3_BUCKET = process.env.AWS_S3_BUCKET || '';
