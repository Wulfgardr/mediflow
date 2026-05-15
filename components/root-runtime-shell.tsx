'use client';

/* @Codex */

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppRevisionGuard } from '@/components/app-revision-guard';
import { FlowFieldBackground } from '@/components/flow-field-background';
import { MobileShellChrome } from '@/components/mobile-shell-chrome';
import { PrivacyProvider } from '@/components/privacy-provider';
import { SecurityProvider } from '@/components/security-provider';
import { Sidebar } from '@/components/sidebar';
import { ThemeProvider } from '@/components/theme-provider';
import { UIAccessibilityProvider } from '@/components/ui-accessibility-provider';
import { UIStyleProvider } from '@/components/ui-style-provider';

const MOCKUP_ROUTE_ALLOWLIST = new Set(['/mockups/kree8']);

export function RootRuntimeShell({
  children,
  fingerprint,
}: {
  children: ReactNode;
  fingerprint: string;
}) {
  const pathname = usePathname();

  if (MOCKUP_ROUTE_ALLOWLIST.has(pathname)) {
    return <>{children}</>;
  }

  return (
    <>
      <FlowFieldBackground />
      <ThemeProvider defaultTheme="system" storageKey="mediflow-theme">
        <AppRevisionGuard fingerprint={fingerprint} />
        <SecurityProvider>
          <UIAccessibilityProvider>
            <UIStyleProvider>
              <PrivacyProvider>
                <div className="relative z-10 xl:flex">
                  <div className="hidden xl:block">
                    <Sidebar />
                  </div>
                  <main className="min-h-screen flex-1 px-4 pb-28 pt-4 sm:px-6 sm:pt-6 xl:ml-[21rem] xl:px-10 xl:pb-10 xl:pt-8">
                    <div className="mx-auto max-w-[1520px] animate-in fade-in slide-in-from-bottom-4 duration-700">
                      <MobileShellChrome />
                      {children}
                    </div>
                  </main>
                </div>
              </PrivacyProvider>
            </UIStyleProvider>
          </UIAccessibilityProvider>
        </SecurityProvider>
      </ThemeProvider>
    </>
  );
}
