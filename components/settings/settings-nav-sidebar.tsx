'use client';

// WUL-297 — grouped sidebar for the settings information architecture.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search } from 'lucide-react';

import { SETTINGS_NAV_GROUPS } from '@/lib/settings-navigation';
import { cn } from '@/lib/utils';

export function SettingsNavSidebar({ onSearchRequest }: { onSearchRequest?: () => void }) {
    const pathname = usePathname();

    return (
        <nav aria-label="Sezioni impostazioni" data-testid="settings-nav-sidebar" className="space-y-5">
            {onSearchRequest ? (
                <button
                    type="button"
                    onClick={onSearchRequest}
                    data-testid="settings-search-trigger"
                    className="flex w-full items-center justify-between gap-2 rounded-[14px] border px-3 py-2 text-left text-xs font-medium transition-colors"
                    style={{
                        borderColor: 'rgba(15, 23, 42, 0.1)',
                        background: 'rgba(248, 250, 252, 0.85)',
                        color: 'var(--mf-muted)',
                    }}
                >
                    <span className="inline-flex items-center gap-2">
                        <Search className="h-3.5 w-3.5" />
                        Cerca impostazione
                    </span>
                    <kbd
                        className="rounded-md border px-1.5 py-0.5 font-mono text-[10px]"
                        style={{ borderColor: 'rgba(15, 23, 42, 0.12)', color: 'var(--mf-muted)' }}
                    >
                        ⌘K
                    </kbd>
                </button>
            ) : null}

            {SETTINGS_NAV_GROUPS.map((group) => (
                <div key={group.id} className="space-y-1.5">
                    <p className="section-kicker px-1">{group.label}</p>
                    <ul className="space-y-1">
                        {group.items.map((item) => {
                            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                            const isDanger = item.tone === 'danger';
                            return (
                                <li key={item.id}>
                                    <Link
                                        href={item.href}
                                        aria-current={isActive ? 'page' : undefined}
                                        data-testid={`settings-nav-${item.id}`}
                                        className={cn(
                                            'block rounded-[14px] border px-3 py-2 transition-colors',
                                            !isActive && 'border-transparent hover:border-[color:rgba(15,23,42,0.1)]',
                                        )}
                                        style={isActive
                                            ? isDanger
                                                ? { borderColor: 'rgba(192, 57, 43, 0.3)', background: 'rgba(192, 57, 43, 0.08)' }
                                                : { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(248, 250, 252, 0.92)' }
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
        </nav>
    );
}
