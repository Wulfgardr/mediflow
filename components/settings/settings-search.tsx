'use client';

// WUL-297 "Cerca impostazione": lightweight CMD+K quick-jump across the
// settings IA. No external dependencies: fuzzy matching lives in
// lib/settings-navigation.ts and navigation goes through next/navigation.
// Accessibility: the dialog traps focus while open and the input is wired as
// a combobox (aria-expanded / aria-controls / aria-activedescendant) so
// arrow-key selection is announced by screen readers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Search } from 'lucide-react';

import { searchSettingsNav } from '@/lib/settings-navigation';
import { cn } from '@/lib/utils';

const LISTBOX_ID = 'settings-search-listbox';

function optionDomId(itemId: string): string {
    return `settings-search-option-${itemId}`;
}

const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SettingsSearchOverlay({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const router = useRouter();
    const dialogRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);

    const matches = useMemo(() => searchSettingsNav(query), [query]);

    useEffect(() => {
        if (!open) return;
        // Remember the opener (search trigger, sidebar button…) and restore
        // focus to it when the dialog closes, as a modal must.
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setQuery('');
        setActiveIndex(0);
        // Focus after the overlay is painted.
        window.setTimeout(() => inputRef.current?.focus(), 0);
        return () => {
            previouslyFocused?.focus();
        };
    }, [open]);

    useEffect(() => {
        setActiveIndex(0);
    }, [query]);

    const navigateTo = useCallback((href: string) => {
        onClose();
        router.push(href);
    }, [onClose, router]);

    const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
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
        }
    };

    // WUL-297 modal behavior: Escape closes, Tab/Shift+Tab cycle within the
    // dialog instead of escaping into the aria-hidden background page.
    const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        if (event.key !== 'Tab') return;
        const container = dialogRef.current;
        if (!container) return;
        const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        if (focusable.length === 0) {
            event.preventDefault();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey) {
            if (active === first || !container.contains(active)) {
                event.preventDefault();
                last.focus();
            }
        } else if (active === last || !container.contains(active)) {
            event.preventDefault();
            first.focus();
        }
    };

    if (!open) return null;

    const activeMatch = matches[activeIndex];

    return (
        <div
            className="fixed inset-0 z-[1200] flex items-start justify-center bg-slate-950/35 px-4 pt-[12vh] backdrop-blur-[2px]"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label="Cerca impostazione"
                data-testid="settings-search-overlay"
                onKeyDown={handleDialogKeyDown}
                className="w-full max-w-lg overflow-hidden rounded-[20px] border shadow-2xl"
                style={{
                    borderColor: 'color-mix(in srgb, var(--lume-ink) 14%, transparent)',
                    background: 'var(--lume-surface-focal)',
                    boxShadow: '0 12px 30px color-mix(in srgb, var(--lume-ink) 18%, transparent)',
                }}
            >
                <div className="flex items-center gap-2 border-b bg-[color:var(--lume-surface-field)] px-4 py-3" style={{ borderColor: 'color-mix(in srgb, var(--lume-ink) 10%, transparent)' }}>
                    <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--lume-ink-muted)' }} />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        placeholder="Cerca impostazione (es. PIN, backup, tema...)"
                        aria-label="Cerca impostazione"
                        role="combobox"
                        aria-expanded={matches.length > 0}
                        aria-controls={LISTBOX_ID}
                        aria-autocomplete="list"
                        aria-activedescendant={activeMatch ? optionDomId(activeMatch.item.id) : undefined}
                        data-testid="settings-search-input"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full bg-transparent text-sm focus:outline-none"
                        style={{ color: 'var(--lume-ink)' }}
                    />
                    <kbd
                        className="lume-registro rounded-md border px-1.5 py-0.5 text-[10px]"
                        style={{ borderColor: 'color-mix(in srgb, var(--lume-ink) 14%, transparent)', color: 'var(--lume-ink-muted)' }}
                    >
                        esc
                    </kbd>
                </div>

                {matches.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs" style={{ color: 'var(--lume-ink-muted)' }}>
                        Nessuna impostazione trovata per &ldquo;{query}&rdquo;.
                    </p>
                ) : (
                    <ul id={LISTBOX_ID} className="max-h-[320px] overflow-y-auto p-2" role="listbox" aria-label="Risultati impostazioni">
                        {matches.map((match, index) => (
                            // Options are intentionally non-focusable (no inner button):
                            // focus stays on the combobox input and the active option is
                            // exposed via aria-activedescendant.
                            <li
                                key={`${match.item.id}-${match.matchedLabel}`}
                                id={optionDomId(match.item.id)}
                                role="option"
                                aria-selected={index === activeIndex}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => navigateTo(match.item.href)}
                                onMouseEnter={() => setActiveIndex(index)}
                                data-testid={`settings-search-result-${match.item.id}`}
                                className={cn(
                                    'flex w-full cursor-pointer items-center justify-between gap-3 rounded-[var(--lume-radius-control)] px-3 py-2 text-left transition-colors',
                                    index === activeIndex && 'bg-[color:var(--lume-surface-field)]',
                                )}
                            >
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-semibold" style={{ color: match.item.tone === 'danger' ? 'var(--lume-signal-critical)' : 'var(--lume-ink)' }}>
                                        {match.item.label}
                                    </span>
                                    <span className="mt-0.5 block truncate text-[11px]" style={{ color: 'var(--lume-ink-muted)' }}>
                                        {match.groupLabel} · {match.matchedLabel}
                                    </span>
                                </span>
                                {index === activeIndex ? (
                                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--lume-ink-muted)' }} />
                                ) : null}
                            </li>
                        ))}
                    </ul>
                )}
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
