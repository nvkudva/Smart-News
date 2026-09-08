import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  images: { unoptimized: true },
  // The category pages are force-dynamic, so the client cache would otherwise
  // discard a section the moment you leave it and re-fetch on every tap back.
  // 30s is shorter than the 15-minute pipeline: nobody sees a stale section.
  experimental: { staleTimes: { dynamic: 30, static: 300 } },
};

export default nextConfig;
