import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { cn } from '@/lib/utils';
import { PrivacyProvider } from '@/components/privacy-provider';
import { ThemeProvider } from '@/components/theme-provider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'MediFlow - Personal Medical Record',
  description: 'Secure, local-first medical record for district doctors.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it">
      <body className={cn(inter.className, "antialiased overflow-x-hidden")}>
        <ThemeProvider defaultTheme="system" storageKey="mediflow-theme">
          <PrivacyProvider>
            <div className="flex">
              <Sidebar />
              <main className="flex-1 ml-64 p-8 min-h-screen">
                {/* Main Content Area - adding a max-width container for readability */}
                <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
                  {children}
                </div>
              </main>
            </div>
          </PrivacyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
