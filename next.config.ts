import type { NextConfig } from "next";

/* @Codex */
const distDir = process.env.MEDIFLOW_NEXT_DIST_DIR || '.next';

/* WUL-343. La UI decifra PHI nel browser, quindi gli header valgono come
   riduzione di superficie, non come formalita'.

   Due scelte non ovvie, entrambe deliberate:

   - 'unsafe-inline' su script-src e style-src resta necessario finche' Next
     inietta lo script di bootstrap e gli stili critici inline. Toglierlo
     richiede il nonce per-richiesta, che a sua volta richiede un middleware:
     e' un lavoro a se', non un parametro da cambiare qui. Dichiararlo e'
     meglio che ometterlo e credersi coperti.
   - HSTS NON e' emesso di default. L'app e' local-first su 127.0.0.1 in HTTP:
     li' l'header viene ignorato, ma se un giorno la stessa origine venisse
     servita in HTTPS anche una sola volta il browser la inchioderebbe a TLS
     per max-age. Si attiva con MEDIFLOW_ENABLE_HSTS=1, cioe' quando davanti
     c'e' il proxy TLS (scripts/local-api-tls-proxy.mjs). */
const isProduction = process.env.NODE_ENV === 'production';
const hstsEnabled = process.env.MEDIFLOW_ENABLE_HSTS === '1';

/* Il percorso AI del browser passa da /api/proxy/ollama/chat (stessa origine,
   vedi lib/ai-providers/ollama.ts:113-123), ma il loopback resta ammesso per i
   runtime locali che i componenti raggiungono direttamente. ws: serve a HMR in
   sviluppo. */
const connectSrc = [
  "'self'",
  'http://127.0.0.1:*',
  'http://localhost:*',
  ...(isProduction ? [] : ['ws://127.0.0.1:*', 'ws://localhost:*']),
].join(' ');

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  `connect-src ${connectSrc}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(hstsEnabled
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  /* @Codex */
  distDir,
  output: "standalone",
  /* @Codex */
  outputFileTracingIncludes: {
    "/*": [
      "./package.json",
      "./scripts/anydoc-local-extraction-worker.mjs",
      "./node_modules/sharp/**/*",
      "./node_modules/@img/**/*",
      "./node_modules/@firecrawl/anydoc*/**/*",
    ],
  },
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
  /* WUL-343 */
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  turbopack: {},
  serverExternalPackages: ['pdfjs-dist', 'pm2'],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
