import type { NextConfig } from "next";

const S3_HOST =
  process.env.S3_IMAGE_HOST ||
  'electromarket-images-ol.s3.ap-southeast-2.amazonaws.com';

const nextConfig: NextConfig = {
  // Emit a minimal self-contained server under .next/standalone so the
  // production Docker image doesn't need to ship node_modules.
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: S3_HOST,
      },
    ],
  },
};

export default nextConfig;
