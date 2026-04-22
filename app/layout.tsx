import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
/* @Codex */
import PreviewProfileChrome from '@/components/preview-profile-chrome';
import { AppRevisionGuard } from '@/components/app-revision-guard';
import { FlowFieldBackground } from '@/components/flow-field-background';
import { MobileShellChrome } from '@/components/mobile-shell-chrome';
import { Sidebar } from '@/components/sidebar';
import { getAppFingerprint } from '@/lib/app-revision';
import { cn } from '@/lib/utils';
import { PrivacyProvider } from '@/components/privacy-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { UIAccessibilityProvider } from '@/components/ui-accessibility-provider';
import { UIStyleProvider } from '@/components/ui-style-provider';
import {
  UI_REDUCE_MOTION_STORAGE_KEY,
  UI_REDUCE_TRANSPARENCY_STORAGE_KEY,
} from '@/lib/ui-accessibility-preferences';

export const metadata: Metadata = {
  title: 'MediFlow - Personal Medical Record',
  description: 'Secure, local-first medical record for district doctors.',
};

import { SecurityProvider } from '@/components/security-provider';

const uiStyleBootstrapScript = `
(() => {
  try {
    const root = document.documentElement;
    root.dataset.uiStyle = 'redesign';
    root.dataset.uiReduceMotion = localStorage.getItem('${UI_REDUCE_MOTION_STORAGE_KEY}') === 'true' ? 'true' : 'false';
    root.dataset.uiReduceTransparency = localStorage.getItem('${UI_REDUCE_TRANSPARENCY_STORAGE_KEY}') === 'true' ? 'true' : 'false';
  } catch (error) {
    document.documentElement.dataset.uiStyle = 'redesign';
    document.documentElement.dataset.uiReduceMotion = 'false';
    document.documentElement.dataset.uiReduceTransparency = 'false';
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
      <body className={cn("min-h-screen antialiased overflow-x-hidden")} suppressHydrationWarning>
        <FlowFieldBackground />
        <ThemeProvider defaultTheme="system" storageKey="mediflow-theme">
          <AppRevisionGuard fingerprint={appFingerprint} />
          <UIAccessibilityProvider>
            <SecurityProvider>
              <UIStyleProvider>
              {/* @Codex: lock overlay is rendered by SecurityProvider to avoid duplicate instances */}
                <PrivacyProvider>
                  <div className="relative z-10 xl:flex">
                    <div className="hidden xl:block">
                      <Sidebar />
                    </div>
                    {/* @Codex: use dedicated mobile chrome instead of shrinking the desktop sidebar */}
                    <main className="min-h-screen flex-1 px-4 pb-28 pt-4 sm:px-6 sm:pt-6 xl:ml-[21rem] xl:px-10 xl:pb-10 xl:pt-8">
                      <div className="mx-auto max-w-[1520px] animate-in fade-in slide-in-from-bottom-4 duration-700">
                        <MobileShellChrome />
                        <PreviewProfileChrome />
                        {children}
                      </div>
                    </main>
                  </div>
                </PrivacyProvider>
              </UIStyleProvider>
            </SecurityProvider>
          </UIAccessibilityProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
