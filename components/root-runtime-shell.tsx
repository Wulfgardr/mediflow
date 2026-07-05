'use client';

/* @Codex */

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppRevisionGuard } from '@/components/app-revision-guard';
import { FlowFieldBackground } from '@/components/flow-field-background';
import { PrivacyProvider } from '@/components/privacy-provider';
import { SecurityProvider } from '@/components/security-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { UIAccessibilityProvider } from '@/components/ui-accessibility-provider';
import { UIStyleProvider } from '@/components/ui-style-provider';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast-provider';

const MOCKUP_ROUTE_ALLOWLIST = new Set(['/mockups/kree8', '/mockups/scheda']);

export function RootRuntimeShell({
  children,
  fingerprint,
}: {
  children: ReactNode;
  fingerprint: string;
}) {
  const pathname = usePathname();

  /* @Codex WUL-UIUX: i mockup non autenticati renderizzano nudi. */
  if (MOCKUP_ROUTE_ALLOWLIST.has(pathname)) {
    return <>{children}</>;
  }

  /* @Codex WUL-UIUX: layout fullscreen unico per tutte le route reali. La vecchia
     shell con Sidebar + MobileShellChrome era di fatto codice morto (nessuna route
     la raggiungeva: cockpit, settings e patient coprivano gia tutto) e portava un
     secondo sistema di navigazione divergente con un h1 di brand concorrente.
     Rimossa: il cambio sede rapido vive in /settings/ambulatories. */
  return (
    <>
      <FlowFieldBackground />
      <ThemeProvider defaultTheme="system" storageKey="mediflow-theme">
        <AppRevisionGuard fingerprint={fingerprint} />
        <SecurityProvider>
          <UIAccessibilityProvider>
            <UIStyleProvider>
              <PrivacyProvider>
                <ToastProvider>
                  <ConfirmProvider>
                    <main className="relative z-10 min-h-screen">{children}</main>
                  </ConfirmProvider>
                </ToastProvider>
              </PrivacyProvider>
            </UIStyleProvider>
          </UIAccessibilityProvider>
        </SecurityProvider>
      </ThemeProvider>
    </>
  );
}
