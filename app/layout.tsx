import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { cn } from '@/lib/utils';
import { PrivacyProvider } from '@/components/privacy-provider';
import { ThemeProvider } from '@/components/theme-provider';

export const metadata: Metadata = {
  title: 'MediFlow - Personal Medical Record',
  description: 'Secure, local-first medical record for district doctors.',
};

import { SecurityProvider } from '@/components/security-provider';
import { LockScreen } from '@/components/lock-screen';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" suppressHydrationWarning>
      {/* @Codex: keep layout fully local/offline by avoiding remote Google Font fetches */}
      <body className={cn("antialiased overflow-x-hidden")} suppressHydrationWarning>
        <ThemeProvider defaultTheme="system" storageKey="mediflow-theme">
          <SecurityProvider>
            <LockScreen />
            <PrivacyProvider>
              <div className="flex">
                <Sidebar />
                {/* @Codex: align main offset with updated sidebar width */}
                <main className="flex-1 ml-80 p-8 min-h-screen">
                  {/* Main Content Area - adding a max-width container for readability */}
                  <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
                    {children}
                  </div>
                </main>
              </div>
            </PrivacyProvider>
          </SecurityProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
