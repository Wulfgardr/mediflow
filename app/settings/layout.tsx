'use client';

// WUL-297 — settings shell: persistent sidebar + sub-routes.

import type { ReactNode } from 'react';

import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import { SettingsNavSidebar } from '@/components/settings/settings-nav-sidebar';
import { SettingsSearchOverlay, useSettingsSearch } from '@/components/settings/settings-search';

export default function SettingsLayout({ children }: { children: ReactNode }) {
    const { isSearchOpen, openSearch, closeSearch } = useSettingsSearch();

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
