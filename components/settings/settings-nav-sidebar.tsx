'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { SETTINGS_NAV_GROUPS, isSettingsItemActive } from '@/lib/settings-navigation';
import { cn } from '@/lib/utils';

import styles from './settings-lume.module.css';

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
                            const isActive = isSettingsItemActive(item, pathname);
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

/* LUME-110/68 */
export function SettingsNavSidebar({ onSearchRequest }: { onSearchRequest?: () => void }) {
    const pathname = usePathname();
    return (
        <nav aria-label="Sezioni impostazioni" data-testid="settings-nav-sidebar" className={styles.navRoot}>
            <div className={styles.mobileStrip}>
                {SETTINGS_NAV_GROUPS.flatMap(group => group.items).map(item => {
                    const active = isSettingsItemActive(item, pathname);
                    return <Link key={item.id} href={item.href} data-testid={`settings-nav-mobile-${item.id}`}
                        data-state={active ? 'active' : 'idle'} aria-current={active ? 'page' : undefined}
                        className={cn(styles.navItem, active && styles.navItemActive)}>{item.label}</Link>;
                })}
            </div>
            {onSearchRequest && <button type="button" onClick={onSearchRequest} aria-label="Cerca impostazione" data-testid="settings-search-trigger-mobile" className={styles.mobileStripSearch}><Search size={16} aria-hidden="true" />Cerca impostazione</button>}

            <div className={styles.desktopSidebar}>
                {onSearchRequest ? (
                    <button
                        type="button"
                        onClick={onSearchRequest}
                        data-testid="settings-search-trigger"
                        className={styles.searchButton}
                    >
                        <span><Search aria-hidden="true" /> Cerca impostazione</span>
                        {/* mostra entrambi i modificatori già supportati. */}
                        <kbd className="lume-registro whitespace-nowrap">⌘/Ctrl + K</kbd>
                    </button>
                ) : null}
                <NavGroups pathname={pathname} testIdPrefix="settings-nav-" />
            </div>
        </nav>
    );
}
