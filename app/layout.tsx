import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
/* @Codex */
import PreviewProfileChrome from '@/components/preview-profile-chrome';
import { Sidebar } from '@/components/sidebar';
import { cn } from '@/lib/utils';
import { PrivacyProvider } from '@/components/privacy-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { UIStyleProvider } from '@/components/ui-style-provider';
import { UI_STYLE_STORAGE_KEY } from '@/lib/ui-style-mode';

export const metadata: Metadata = {
  title: 'MediFlow - Personal Medical Record',
  description: 'Secure, local-first medical record for district doctors.',
};

import { SecurityProvider } from '@/components/security-provider';

const uiStyleBootstrapScript = `
(() => {
  try {
    const storageKey = '${UI_STYLE_STORAGE_KEY}';
    const root = document.documentElement;
    const savedStyle = localStorage.getItem(storageKey);
    const styleMode = savedStyle === 'liquid' ? 'liquid' : 'clinical';
    root.dataset.uiStyle = styleMode;
  } catch (error) {
    document.documentElement.dataset.uiStyle = 'clinical';
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" data-ui-style="clinical" suppressHydrationWarning>
      {/* @Codex: keep layout fully local/offline by avoiding remote Google Font fetches */}
      <head>
        <Script id="ui-style-bootstrap" strategy="beforeInteractive">
          {uiStyleBootstrapScript}
        </Script>
      </head>
      <body className={cn("antialiased overflow-x-hidden")} suppressHydrationWarning>
        <ThemeProvider defaultTheme="system" storageKey="mediflow-theme">
          <SecurityProvider>
            <UIStyleProvider>
              {/* @Codex: lock overlay is rendered by SecurityProvider to avoid duplicate instances */}
              <PrivacyProvider>
                <div className="flex">
                  <Sidebar />
                  {/* @Codex: align main offset with updated sidebar width */}
                  <main className="flex-1 ml-80 p-8 min-h-screen">
                    {/* Main Content Area - adding a max-width container for readability */}
                    <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
                      <PreviewProfileChrome />
                      {children}
                    </div>
                  </main>
                </div>
              </PrivacyProvider>
            </UIStyleProvider>
          </SecurityProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
