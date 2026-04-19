import type { NextConfig } from "next";

/* @Codex */
const distDir = process.env.MEDIFLOW_NEXT_DIST_DIR || '.next';

const nextConfig: NextConfig = {
  /* @Codex */
  distDir,
  output: "standalone",
  turbopack: {},
  serverExternalPackages: ['pdfjs-dist', 'pm2'],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
