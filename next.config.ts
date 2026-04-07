import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Increase body size limit for PDF uploads (10MB)
  serverExternalPackages: ['jszip'],

  // Turbopack config (Next 16 uses Turbopack by default)
  turbopack: {},

  webpack: (config) => {
    // Fix for canvas dependency in pdfjs-dist
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;
    return config;
  },
};

export default nextConfig;
