'use client';

// WUL-297 — settings shell: persistent sidebar + sub-routes.

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import { SettingsNavSidebar } from '@/components/settings/settings-nav-sidebar';
import { SettingsSearchOverlay, useSettingsSearch } from '@/components/settings/settings-search';

// Transitional: these routes still render their own full-screen shell while the
// monolithic settings page is dismantled. Removed at the end of the migration.
const LEGACY_FULL_SHELL_ROUTES = new Set(['/settings']);

export default function SettingsLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const { isSearchOpen, openSearch, closeSearch } = useSettingsSearch();

    if (LEGACY_FULL_SHELL_ROUTES.has(pathname)) {
        return <>{children}</>;
    }

    return (
        <Kree8WorkspaceShell
            eyebrow="Sistema"
            title="Impostazioni"
            subtitle="Accesso, AI locale, backup, repertori e servizi del Mac che ospita MediFlow."
            backHref="/"
            backLabel="Torna ai pazienti"
            statusLabel="I dati clinici e i servizi restano locali."
        >
            <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:items-start">
                <aside className="lg:sticky lg:top-2">
                    <SettingsNavSidebar onSearchRequest={openSearch} />
                </aside>
                <div className="min-w-0 space-y-8" data-testid="settings-subroute-content">
                    {children}
                </div>
            </div>

            {/* WUL-297 — CMD+K quick-jump across the settings IA. */}
            <SettingsSearchOverlay open={isSearchOpen} onClose={closeSearch} />
        </Kree8WorkspaceShell>
    );
}
