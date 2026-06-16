import type { NextConfig } from "next";

/* @Codex */
const distDir = process.env.MEDIFLOW_NEXT_DIST_DIR || '.next';

const nextConfig: NextConfig = {
  /* @Codex */
  distDir,
  output: "standalone",
  /* @Codex */
  outputFileTracingExcludes: {
    "/*": [
      "./*.db",
      "./*.sqlite",
      "./*.sqlite3",
      "./tmp",
      "./tmp/**/*",
      "./tmp-*",
      "./tmp-*/**/*",
      "./docs/**/*",
      "./oss-assets/**/*",
      "./PLANS.md",
      "./README.md",
      "./ARCHITECTURE.md",
      "./SECURITY.md",
      "./CONTRIBUTING.md",
      "./CHANGELOG.md",
    ],
    "/api/*": [
      "./*.db",
      "./*.sqlite",
      "./*.sqlite3",
      "./tmp",
      "./tmp/**/*",
      "./tmp-*",
      "./tmp-*/**/*",
      "./docs/**/*",
      "./oss-assets/**/*",
      "./PLANS.md",
      "./README.md",
      "./ARCHITECTURE.md",
      "./SECURITY.md",
      "./CONTRIBUTING.md",
      "./CHANGELOG.md",
    ],
  },
  turbopack: {},
  serverExternalPackages: ['pdfjs-dist', 'pm2'],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
