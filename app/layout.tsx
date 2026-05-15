import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import { getAppFingerprint } from '@/lib/app-revision';
import { RootRuntimeShell } from '@/components/root-runtime-shell';
import {
  UI_REDUCE_MOTION_STORAGE_KEY,
} from '@/lib/ui-accessibility-preferences';

export const metadata: Metadata = {
  title: 'MediFlow - Personal Medical Record',
  description: 'Secure, local-first medical record for district doctors.',
};

const uiStyleBootstrapScript = `
(() => {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  try {
    root.dataset.uiStyle = 'redesign';
    root.dataset.uiReduceMotion = localStorage.getItem('${UI_REDUCE_MOTION_STORAGE_KEY}') === 'true' ? 'true' : 'false';
    root.dataset.uiReduceTransparency = 'false';

    const stored = localStorage.getItem('mediflow-theme');
    const resolved = stored === 'dark' || stored === 'light' ? stored : (prefersDark ? 'dark' : 'light');
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  } catch (error) {
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
    <html lang="it" data-ui-style="redesign" suppressHydrationWarning>
      {/* @Codex: keep layout fully local/offline by avoiding remote Google Font fetches */}
      <head>
        <meta name="mediflow-app-fingerprint" content={appFingerprint} />
        <Script id="ui-style-bootstrap" strategy="beforeInteractive">
          {uiStyleBootstrapScript}
        </Script>
      </head>
      <body className="min-h-screen antialiased overflow-x-hidden" suppressHydrationWarning>
        <RootRuntimeShell fingerprint={appFingerprint}>
          {children}
        </RootRuntimeShell>
      </body>
    </html>
  );
}
