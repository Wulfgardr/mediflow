import type { Metadata } from 'next';
import { connection } from 'next/server';
import { isPluginLocalUiRuntime } from '@/lib/security/plugin-local-ui-runtime';
import localFont from 'next/font/local';
import Script from 'next/script';
import './globals.css';
// WUL-55: Lume runtime token mirror loads after globals so its --lume-* custom
// properties are the first design-token input available to the live cockpit.
import './lume-tokens.css';
import './lume-motion.css';
import './runtime-twin.css';
import { getAppFingerprint } from '@/lib/app-revision';
import { RootRuntimeShell } from '@/components/root-runtime-shell';
import { RuntimeTwinToolbar } from '@/components/runtime-twin-toolbar';
import { RuntimeTwinDesignProvider } from '@/components/runtime-twin-design';
import {
  UI_REDUCE_MOTION_STORAGE_KEY,
} from '@/lib/ui-accessibility-preferences';

/* font Lume bundled locally so the layout remains usable offline. */
const voce = localFont({
  src: './fonts/Newsreader-Variable.ttf',
  variable: '--font-voce',
  display: 'swap',
  weight: '200 800',
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
  title: 'MediFlow',
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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  const pluginLocalUi = isPluginLocalUiRuntime();
  /* expose a stable revision fingerprint so stale browser tabs can self-heal after branch/server changes */
  const appFingerprint = getAppFingerprint();
  /* ADR 0123: the flag controls comparison chrome, not the official UI. */
  const runtimeTwin = process.env.MEDIFLOW_RUNTIME_TWIN === '1';

  return (
    <html lang="it" className={`${voce.variable} ${registro.variable}`} data-ui-style="redesign" data-lume="true" data-plugin-local-ui={pluginLocalUi ? 'true' : undefined} data-runtime-twin={runtimeTwin ? 'true' : undefined} data-runtime-twin-design="proposal" data-twin-composition="stream" suppressHydrationWarning>
      {/* keep layout fully local/offline by avoiding remote Google Font fetches */}
      <head>
        <meta name="mediflow-app-fingerprint" content={appFingerprint} />
        <Script id="ui-style-bootstrap" strategy="beforeInteractive">
          {uiStyleBootstrapScript}
        </Script>
      </head>
      <body
        className="min-h-screen overflow-x-hidden antialiased"
        suppressHydrationWarning
      >
        <RuntimeTwinDesignProvider comparisonEnabled={runtimeTwin}>
          <RootRuntimeShell fingerprint={appFingerprint}>
            {children}
          </RootRuntimeShell>
          {runtimeTwin ? <RuntimeTwinToolbar /> : null}
        </RuntimeTwinDesignProvider>
      </body>
    </html>
  );
}
