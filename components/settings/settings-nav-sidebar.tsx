'use client';

import { ChevronDown, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { SETTINGS_NAV_GROUPS } from '@/lib/settings-navigation';
import type { SettingsNavGroup, SettingsNavItem } from '@/lib/settings-navigation';
import { cn } from '@/lib/utils';

import styles from './settings-lume.module.css';

function isItemActive(item: SettingsNavItem, pathname: string): boolean {
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function findActiveEntry(pathname: string): { group: SettingsNavGroup; item: SettingsNavItem } | null {
    for (const group of SETTINGS_NAV_GROUPS) {
        for (const item of group.items) {
            if (isItemActive(item, pathname)) return { group, item };
        }
    }
    return null;
}

function NavGroups({
    pathname,
    testIdPrefix,
    onNavigate,
}: {
    pathname: string;
    testIdPrefix: string;
    onNavigate?: (isActive: boolean) => void;
}) {
    return (
        <div className={styles.navGroups}>
            {SETTINGS_NAV_GROUPS.map((group) => (
                <div key={group.id} className={styles.navGroup}>
                    <p className={styles.navGroupLabel}>{group.label}</p>
                    <ul className={styles.navItems}>
                        {group.items.map((item) => {
                            const isActive = isItemActive(item, pathname);
                            return (
                                <li key={item.id}>
                                    <Link
                                        href={item.href}
                                        aria-current={isActive ? 'page' : undefined}
                                        data-state={isActive ? 'active' : 'idle'}
                                        data-testid={`${testIdPrefix}${item.id}`}
                                        onClick={() => onNavigate?.(isActive)}
                                        className={cn(
                                            styles.navItem,
                                            isActive && styles.navItemActive,
                                            item.tone === 'danger' && styles.navItemDanger,
                                        )}
                                    >
                                        <span className={styles.navItemCopy}>
                                            <span className={styles.navItemLabel}>{item.label}</span>
                                            <span className={styles.navItemDescription}>{item.description}</span>
                                        </span>
                                        {isActive ? <span className={`${styles.currentLabel} lume-registro`}>Attiva</span> : null}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
}

/* @Codex LUME-110/68 */
export function SettingsNavSidebar({ onSearchRequest }: { onSearchRequest?: () => void }) {
    const pathname = usePathname();
    const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
    const mobileToggleRef = useRef<HTMLButtonElement>(null);
    const restoreFocusAfterNavigation = useRef(false);
    const activeEntry = findActiveEntry(pathname);

    useEffect(() => {
        setIsMobileNavOpen(false);
        if (!restoreFocusAfterNavigation.current) return;
        restoreFocusAfterNavigation.current = false;
        requestAnimationFrame(() => mobileToggleRef.current?.focus());
    }, [pathname]);

    const closeMobileNavigation = (isActive: boolean) => {
        if (isActive) {
            restoreFocusAfterNavigation.current = false;
            setIsMobileNavOpen(false);
            requestAnimationFrame(() => mobileToggleRef.current?.focus());
            return;
        }
        restoreFocusAfterNavigation.current = true;
        setIsMobileNavOpen(false);
    };

    const closeMobileDisclosure = () => {
        setIsMobileNavOpen(false);
        requestAnimationFrame(() => mobileToggleRef.current?.focus());
    };

    return (
        <nav aria-label="Sezioni impostazioni" data-testid="settings-nav-sidebar" className={styles.navRoot}>
            <div className={styles.mobileBar}>
                <button
                    ref={mobileToggleRef}
                    type="button"
                    onClick={() => setIsMobileNavOpen((current) => !current)}
                    aria-expanded={isMobileNavOpen}
                    aria-controls="settings-nav-mobile-groups"
                    aria-label={`${isMobileNavOpen ? 'Chiudi' : 'Apri'} navigazione impostazioni. Sezione attiva: ${activeEntry?.item.label ?? 'Panoramica'}`}
                    data-testid="settings-nav-mobile-toggle"
                    className={styles.mobileToggle}
                >
                    <span className={styles.mobileCurrent}>
                        <span>{activeEntry?.group.label ?? 'Impostazioni'}</span>
                        <strong>{activeEntry?.item.label ?? 'Panoramica'}</strong>
                    </span>
                    <ChevronDown
                        aria-hidden="true"
                        className={cn(styles.disclosureIcon, isMobileNavOpen && styles.disclosureIconOpen)}
                    />
                </button>
                {onSearchRequest ? (
                    <button
                        type="button"
                        onClick={onSearchRequest}
                        aria-label="Cerca impostazione"
                        data-testid="settings-search-trigger-mobile"
                        className={styles.mobileSearch}
                    >
                        <Search aria-hidden="true" />
                    </button>
                ) : null}
            </div>

            <div
                id="settings-nav-mobile-groups"
                hidden={!isMobileNavOpen}
                className={styles.mobileGroups}
                onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    closeMobileDisclosure();
                }}
            >
                <NavGroups pathname={pathname} testIdPrefix="settings-nav-mobile-" onNavigate={closeMobileNavigation} />
            </div>

            <div className={styles.desktopSidebar}>
                {onSearchRequest ? (
                    <button
                        type="button"
                        onClick={onSearchRequest}
                        data-testid="settings-search-trigger"
                        className={styles.searchButton}
                    >
                        <span><Search aria-hidden="true" /> Cerca impostazione</span>
                        <kbd className="lume-registro">⌘K</kbd>
                    </button>
                ) : null}
                <NavGroups pathname={pathname} testIdPrefix="settings-nav-" />
            </div>
        </nav>
    );
}
