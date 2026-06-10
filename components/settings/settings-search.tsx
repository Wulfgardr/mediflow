'use client';

// WUL-297 — "Cerca impostazione": lightweight CMD+K quick-jump across the
// settings IA. No external dependencies: fuzzy matching lives in
// lib/settings-navigation.ts and navigation goes through next/navigation.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Search } from 'lucide-react';

import { searchSettingsNav } from '@/lib/settings-navigation';
import { cn } from '@/lib/utils';

export function SettingsSearchOverlay({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);

    const matches = useMemo(() => searchSettingsNav(query), [query]);

    useEffect(() => {
        if (open) {
            setQuery('');
            setActiveIndex(0);
            // Focus after the overlay is painted.
            window.setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [open]);

    useEffect(() => {
        setActiveIndex(0);
    }, [query]);

    const navigateTo = useCallback((href: string) => {
        onClose();
        router.push(href);
    }, [onClose, router]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) => Math.max(current - 1, 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const match = matches[activeIndex];
            if (match) navigateTo(match.item.href);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
        }
    };

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[1200] flex items-start justify-center bg-slate-950/35 px-4 pt-[12vh] backdrop-blur-[2px]"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Cerca impostazione"
                data-testid="settings-search-overlay"
                className="w-full max-w-lg overflow-hidden rounded-[20px] border shadow-2xl"
                style={{
                    borderColor: 'rgba(15, 23, 42, 0.12)',
                    background: 'var(--mf-card, #ffffff)',
                }}
            >
                <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'rgba(15, 23, 42, 0.08)' }}>
                    <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--mf-muted)' }} />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Cerca impostazione (es. PIN, backup, tema...)"
                        aria-label="Cerca impostazione"
                        data-testid="settings-search-input"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full bg-transparent text-sm focus:outline-none"
                        style={{ color: 'var(--mf-ink)' }}
                    />
                    <kbd
                        className="rounded-md border px-1.5 py-0.5 font-mono text-[10px]"
                        style={{ borderColor: 'rgba(15, 23, 42, 0.12)', color: 'var(--mf-muted)' }}
                    >
                        esc
                    </kbd>
                </div>

                <ul className="max-h-[320px] overflow-y-auto p-2" role="listbox" aria-label="Risultati impostazioni">
                    {matches.length === 0 ? (
                        <li className="px-3 py-6 text-center text-xs" style={{ color: 'var(--mf-muted)' }}>
                            Nessuna impostazione trovata per &ldquo;{query}&rdquo;.
                        </li>
                    ) : (
                        matches.map((match, index) => (
                            <li key={`${match.item.id}-${match.matchedLabel}`} role="option" aria-selected={index === activeIndex}>
                                <button
                                    type="button"
                                    onClick={() => navigateTo(match.item.href)}
                                    onMouseEnter={() => setActiveIndex(index)}
                                    data-testid={`settings-search-result-${match.item.id}`}
                                    className={cn(
                                        'flex w-full items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-left transition-colors',
                                        index === activeIndex && 'bg-[color:rgba(15,23,42,0.06)]',
                                    )}
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm font-semibold" style={{ color: match.item.tone === 'danger' ? 'var(--mf-critical)' : 'var(--mf-ink)' }}>
                                            {match.item.label}
                                        </span>
                                        <span className="mt-0.5 block truncate text-[11px]" style={{ color: 'var(--mf-muted)' }}>
                                            {match.groupLabel} · {match.matchedLabel}
                                        </span>
                                    </span>
                                    {index === activeIndex ? (
                                        <CornerDownLeft className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--mf-muted)' }} />
                                    ) : null}
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            </div>
        </div>
    );
}

// Hook that owns the open state + the global ⌘K / Ctrl+K shortcut.
export function useSettingsSearch() {
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                setIsSearchOpen((current) => !current);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    return {
        isSearchOpen,
        openSearch: useCallback(() => setIsSearchOpen(true), []),
        closeSearch: useCallback(() => setIsSearchOpen(false), []),
    };
}
