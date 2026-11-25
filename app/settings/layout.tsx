'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import styles from '@/components/settings/settings-lume.module.css';
import navigation from '@/components/settings/settings-navigation.module.css';
import surface from '@/components/record-surface.module.css';

import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import { SettingsNavSidebar } from '@/components/settings/settings-nav-sidebar';
import { SettingsSearchOverlay, useSettingsSearch } from '@/components/settings/settings-search';

export default function SettingsLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const isSubroute = pathname?.startsWith('/settings/') && pathname !== '/settings/';
    const { isSearchOpen, openSearch, closeSearch } = useSettingsSearch();

    return (
        <Kree8WorkspaceShell
            title="Impostazioni"
        >
            <div data-runtime-settings className={navigation.workspace}>
                <aside className={navigation.indexPane}>
                    <SettingsNavSidebar onSearchRequest={openSearch} />
                </aside>
                <div className={navigation.content} data-testid="settings-subroute-content">
                    {isSubroute ? (
                        <>
                            <Link href="/settings" className={navigation.returnLink} data-priority={pathname === '/settings/zona-pericolo' ? 'return' : undefined}>
                                <ArrowLeft size={16} aria-hidden="true" />
                                Torna alle impostazioni
                            </Link>
                            <div className={`${surface.tray} ${styles.subroute}`} data-record-tray="settings">{children}</div>
                        </>
                    ) : children}
                </div>
            </div>

            <SettingsSearchOverlay open={isSearchOpen} onClose={closeSearch} />
        </Kree8WorkspaceShell>
    );
}
