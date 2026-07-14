import type { Metadata } from 'next';
import localFont from 'next/font/local';
import Script from 'next/script';
import './globals.css';
// WUL-55: Lume runtime token mirror loads after globals so its --lume-* custom
// properties are the first design-token input available to the live cockpit.
import './lume-tokens.css';
import './lume-motion.css';
import { getAppFingerprint } from '@/lib/app-revision';
import { RootRuntimeShell } from '@/components/root-runtime-shell';
import {
  UI_REDUCE_MOTION_STORAGE_KEY,
} from '@/lib/ui-accessibility-preferences';

/* @Codex: font Lume bundled locally so the layout remains usable offline. */
const voce = localFont({
  src: './fonts/Inter-Variable-Latin.woff2',
  variable: '--font-voce',
  display: 'swap',
  weight: '100 900',
  style: 'normal',
});

const registro = localFont({
  src: [
    { path: './fonts/IBM-Plex-Mono-400-Latin.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBM-Plex-Mono-500-Latin.woff2', weight: '500', style: 'normal' },
    { path: './fonts/IBM-Plex-Mono-600-Latin.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-registro',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MediFlow - Personal Medical Record',
  description: 'Secure, local-first medical record for district doctors.',
};

const uiStyleBootstrapScript = `
(() => {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  try {
    root.dataset.lume = 'true';
    root.dataset.uiStyle = 'redesign';
    root.dataset.uiReduceMotion = localStorage.getItem('${UI_REDUCE_MOTION_STORAGE_KEY}') === 'true' ? 'true' : 'false';
    root.dataset.uiReduceTransparency = 'false';

    const stored = localStorage.getItem('mediflow-theme');
    const resolved = stored === 'dark' || stored === 'light' ? stored : (prefersDark ? 'dark' : 'light');
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  } catch (error) {
    root.dataset.lume = 'true';
    root.dataset.uiStyle = 'redesign';
    root.dataset.uiReduceMotion = 'false';
    root.dataset.uiReduceTransparency = 'false';
    const fallback = prefersDark ? 'dark' : 'light';
    root.classList.remove('light', 'dark');
    root.classList.add(fallback);
    root.style.colorScheme = fallback;
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /* @Codex: expose a stable revision fingerprint so stale browser tabs can self-heal after branch/server changes */
  const appFingerprint = getAppFingerprint();

  return (
    <html lang="it" data-ui-style="redesign" data-lume="true" suppressHydrationWarning>
      {/* @Codex: keep layout fully local/offline by avoiding remote Google Font fetches */}
      <head>
        <meta name="mediflow-app-fingerprint" content={appFingerprint} />
        <Script id="ui-style-bootstrap" strategy="beforeInteractive">
          {uiStyleBootstrapScript}
        </Script>
      </head>
      <body
        className={`${voce.variable} ${registro.variable} min-h-screen overflow-x-hidden antialiased`}
        suppressHydrationWarning
      >
        <RootRuntimeShell fingerprint={appFingerprint}>
          {children}
        </RootRuntimeShell>
      </body>
    </html>
  );
}
