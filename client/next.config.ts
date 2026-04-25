import type { NextConfig } from "next";
import path from "node:path";

const S3_HOST =
  process.env.S3_IMAGE_HOST ||
  'electromarket-images-ol.s3.ap-southeast-2.amazonaws.com';

const nextConfig: NextConfig = {
  // Emit a minimal self-contained server under .next/standalone so the
  // production Docker image doesn't need to ship node_modules.
  output: 'standalone',
  // Pin Turbopack's workspace root to this client directory. Without this,
  // Next 16 walks up looking for a lockfile and picks the orphaned
  // package-lock.json one level above, which has no node_modules — module
  // resolution then fails for tailwindcss/etc.
  turbopack: {
    root: path.resolve(__dirname),
  },
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
