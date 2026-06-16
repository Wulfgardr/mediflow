'use client';

// WUL-297: grouped sidebar for the settings information architecture.
// Below lg the full nav collapses into a compact disclosure bar (current
// section + accordion) so sub-route content stays above the fold.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Search } from 'lucide-react';

import { SETTINGS_NAV_GROUPS } from '@/lib/settings-navigation';
import type { SettingsNavGroup, SettingsNavItem } from '@/lib/settings-navigation';
import { cn } from '@/lib/utils';

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

function NavGroups({ pathname, testIdPrefix }: { pathname: string; testIdPrefix: string }) {
    return (
        <>
            {SETTINGS_NAV_GROUPS.map((group) => (
                <div key={group.id} className="space-y-1.5">
                    <p className="section-kicker px-1">{group.label}</p>
                    <ul className="space-y-1">
                        {group.items.map((item) => {
                            const isActive = isItemActive(item, pathname);
                            const isDanger = item.tone === 'danger';
                            return (
                                <li key={item.id}>
                                    <Link
                                        href={item.href}
                                        aria-current={isActive ? 'page' : undefined}
                                        data-testid={`${testIdPrefix}${item.id}`}
                                        className={cn(
                                            'block rounded-[14px] border px-3 py-2 transition-colors',
                                            !isActive && 'border-transparent hover:border-[color:var(--glass-border)]',
                                        )}
                                        style={isActive
                                            ? isDanger
                                                ? { borderColor: 'rgba(192, 57, 43, 0.3)', background: 'rgba(192, 57, 43, 0.08)' }
                                                : { borderColor: 'var(--glass-border)', background: 'var(--mf-bg-elevated)' }
                                            : undefined}
                                    >
                                        <span
                                            className="block text-[13px] font-semibold"
                                            style={{ color: isDanger ? 'var(--mf-critical)' : 'var(--mf-ink)' }}
                                        >
                                            {item.label}
                                        </span>
                                        <span className="mt-0.5 block text-[11px] leading-4" style={{ color: 'var(--mf-muted)' }}>
                                            {item.description}
                                        </span>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </>
    );
}

export function SettingsNavSidebar({ onSearchRequest }: { onSearchRequest?: () => void }) {
    const pathname = usePathname();
    const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

    // Collapse the mobile accordion as soon as navigation lands on a route.
    useEffect(() => {
        setIsMobileNavOpen(false);
    }, [pathname]);

    const activeEntry = findActiveEntry(pathname);
    const isDangerActive = activeEntry?.item.tone === 'danger';

    return (
        <nav aria-label="Sezioni impostazioni" data-testid="settings-nav-sidebar">
            {/* Compact treatment for narrow viewports (<lg): disclosure bar + accordion. */}
            <div className="flex items-stretch gap-2 lg:hidden">
                <button
                    type="button"
                    onClick={() => setIsMobileNavOpen((current) => !current)}
                    aria-expanded={isMobileNavOpen}
                    aria-controls="settings-nav-mobile-groups"
                    data-testid="settings-nav-mobile-toggle"
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-[14px] border px-3 py-2 text-left transition-colors"
                    style={{
                        borderColor: isDangerActive ? 'rgba(192, 57, 43, 0.3)' : 'var(--glass-border)',
                        background: isDangerActive ? 'rgba(192, 57, 43, 0.08)' : 'var(--mf-bg-elevated)',
                    }}
                >
                    <span className="min-w-0">
                        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--mf-muted)' }}>
                            {activeEntry ? activeEntry.group.label : 'Impostazioni'}
                        </span>
                        <span
                            className="block truncate text-[13px] font-semibold"
                            style={{ color: isDangerActive ? 'var(--mf-critical)' : 'var(--mf-ink)' }}
                        >
                            {activeEntry ? activeEntry.item.label : 'Panoramica'}
                        </span>
                    </span>
                    <ChevronDown
                        aria-hidden="true"
                        className={cn('h-4 w-4 shrink-0 transition-transform', isMobileNavOpen && 'rotate-180')}
                        style={{ color: 'var(--mf-muted)' }}
                    />
                </button>
                {onSearchRequest ? (
                    <button
                        type="button"
                        onClick={onSearchRequest}
                        aria-label="Cerca impostazione"
                        data-testid="settings-search-trigger-mobile"
                        className="flex w-11 shrink-0 items-center justify-center rounded-[14px] border transition-colors"
                        style={{
                            borderColor: 'var(--glass-border)',
                            background: 'var(--mf-bg-elevated)',
                            color: 'var(--mf-muted)',
                        }}
                    >
                        <Search className="h-4 w-4" />
                    </button>
                ) : null}
            </div>
            <div
                id="settings-nav-mobile-groups"
                hidden={!isMobileNavOpen}
                className="mt-2 space-y-5 rounded-[18px] border p-3 lg:hidden"
                style={{
                    borderColor: 'var(--glass-border)',
                    background: 'var(--mf-bg-elevated)',
                }}
            >
                <NavGroups pathname={pathname} testIdPrefix="settings-nav-mobile-" />
            </div>

            {/* Full sidebar from lg up. */}
            <div className="hidden space-y-5 lg:block">
                {onSearchRequest ? (
                    <button
                        type="button"
                        onClick={onSearchRequest}
                        data-testid="settings-search-trigger"
                        className="flex w-full items-center justify-between gap-2 rounded-[14px] border px-3 py-2 text-left text-xs font-medium transition-colors"
                        style={{
                            borderColor: 'var(--glass-border)',
                            background: 'var(--mf-bg-elevated)',
                            color: 'var(--mf-muted)',
                        }}
                    >
                        <span className="inline-flex items-center gap-2">
                            <Search className="h-3.5 w-3.5" />
                            Cerca impostazione
                        </span>
                        <kbd
                            className="rounded-md border px-1.5 py-0.5 font-mono text-[10px]"
                            style={{ borderColor: 'var(--glass-border)', color: 'var(--mf-muted)' }}
                        >
                            ⌘K
                        </kbd>
                    </button>
                ) : null}

                <NavGroups pathname={pathname} testIdPrefix="settings-nav-" />
            </div>
        </nav>
    );
}
