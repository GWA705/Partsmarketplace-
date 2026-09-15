/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Part photos come off a phone camera; server actions need room.
    serverActions: { bodySizeLimit: '12mb' },
  },
};
export default nextConfig;
