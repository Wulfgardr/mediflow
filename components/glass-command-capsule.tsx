'use client';

import Link from 'next/link';
import { Filter, LayoutGrid, ListFilter, Plus, Search } from 'lucide-react';

import { cn } from '@/lib/utils';

interface GlassCommandCapsuleProps {
    /* @Codex */
    variant?: 'atlas' | 'workbench';
    search: string;
    onSearchChange: (value: string) => void;
    viewMode: 'active' | 'archived';
    onViewModeChange: (next: 'active' | 'archived') => void;
    sortMode: 'alpha' | 'recent';
    onSortModeChange: (next: 'alpha' | 'recent') => void;
    density?: 'compact' | 'wide';
    onDensityChange?: (next: 'compact' | 'wide') => void;
    className?: string;
}

export function GlassCommandCapsule({
    variant = 'atlas',
    search,
    onSearchChange,
    viewMode,
    onViewModeChange,
    sortMode,
    onSortModeChange,
    density,
    onDensityChange,
    className,
}: GlassCommandCapsuleProps) {
    /* @Codex */
    const isWorkbench = variant === 'workbench';
    const controlGridClassName = isWorkbench
        ? 'grid gap-2 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2'
        : 'grid gap-2 sm:grid-cols-2';

    return (
        <div
            className={cn(
                'glass-command-capsule relative overflow-hidden border border-[color:var(--glass-border)] bg-[color:var(--glass-bg)] shadow-[var(--glass-panel-shadow)] backdrop-blur-3xl',
                isWorkbench ? 'rounded-[18px] p-2.5' : 'rounded-[26px] p-3',
                className,
            )}
        >
            <div className={cn(
                'grid gap-2.5 lg:grid-cols-2 2xl:items-center',
                onDensityChange
                    ? '2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_auto]'
                    : '2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]',
            )}>
                <label className="relative block">
                    <span className="sr-only">Cerca casi</span>
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--mf-muted)]" />
                    <input
                        id="patients-search-input"
                        data-testid="patients-search-input"
                        type="search"
                        value={search}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder="Cerca paziente, codice fiscale o diagnosi…"
                        className={cn(
                            'glass-command-search w-full border border-[color:rgba(112,106,100,0.16)] bg-white/78 pl-10 pr-4 text-sm text-[color:var(--mf-ink)] outline-none transition-[border-color,box-shadow] placeholder:text-[color:rgba(112,106,100,0.74)] focus:border-[color:rgba(15,123,104,0.38)] focus:shadow-[0_0_0_4px_rgba(15,123,104,0.08)] dark:bg-white/6',
                            isWorkbench ? 'h-10 rounded-[14px]' : 'h-11 rounded-[18px]',
                        )}
                    />
                </label>

                <div className={controlGridClassName}>
                    <div className={cn(
                        'glass-command-cluster min-w-0 border border-[color:rgba(112,106,100,0.14)] bg-white/58 dark:bg-white/6',
                        isWorkbench ? 'rounded-[14px] p-1' : 'rounded-[18px] p-1',
                    )}>
                        <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            <Filter className="h-3 w-3" />
                            Ambito
                        </div>
                        <div className="flex gap-1">
                            {(['active', 'archived'] as const).map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => onViewModeChange(mode)}
                                    className={cn(
                                        'min-w-0 flex-1 px-3 py-2 text-[12px] font-semibold transition-[background-color,color,box-shadow]',
                                        isWorkbench ? 'rounded-[10px]' : 'rounded-[14px]',
                                        viewMode === mode
                                            ? 'bg-[color:rgba(15,123,104,0.1)] text-[color:var(--mf-primary)] shadow-[0_10px_20px_rgba(15,123,104,0.08)]'
                                            : 'text-[color:var(--mf-muted)] hover:bg-white/72 dark:hover:bg-white/8',
                                    )}
                                >
                                    {mode === 'active' ? 'Attivi' : 'Archiviati'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className={cn(
                        'glass-command-cluster min-w-0 border border-[color:rgba(112,106,100,0.14)] bg-white/58 dark:bg-white/6',
                        isWorkbench ? 'rounded-[14px] p-1' : 'rounded-[18px] p-1',
                    )}>
                        <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            <ListFilter className="h-3 w-3" />
                            Ordinamento
                        </div>
                        <div className="flex gap-1">
                            {(['recent', 'alpha'] as const).map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => onSortModeChange(mode)}
                                    className={cn(
                                        'min-w-0 flex-1 px-3 py-2 text-[12px] font-semibold transition-[background-color,color,box-shadow]',
                                        isWorkbench ? 'rounded-[10px]' : 'rounded-[14px]',
                                        sortMode === mode
                                            ? 'bg-[color:rgba(94,53,95,0.1)] text-[color:var(--mf-plum)] shadow-[0_10px_20px_rgba(94,53,95,0.08)]'
                                            : 'text-[color:var(--mf-muted)] hover:bg-white/72 dark:hover:bg-white/8',
                                    )}
                                >
                                    {mode === 'recent' ? 'Recenti' : 'A-Z'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {onDensityChange && (
                    <div className={cn(
                        'glass-command-cluster flex items-center gap-2 border border-[color:rgba(112,106,100,0.14)] bg-white/58 dark:bg-white/6',
                        isWorkbench ? 'rounded-[14px] p-1.5' : 'rounded-[18px] p-1.5',
                    )}>
                        <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            Densità
                        </div>
                        <div className="ml-auto flex gap-1">
                            {(['compact', 'wide'] as const).map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => onDensityChange(mode)}
                                    className={cn(
                                        'inline-flex h-9 items-center gap-1.5 px-3 text-[12px] font-semibold transition-[background-color,color,box-shadow]',
                                        isWorkbench ? 'rounded-[10px]' : 'rounded-[14px]',
                                        density === mode
                                            ? 'bg-[color:rgba(182,106,60,0.12)] text-[color:var(--mf-accent)] shadow-[0_10px_20px_rgba(182,106,60,0.08)]'
                                            : 'text-[color:var(--mf-muted)] hover:bg-white/72 dark:hover:bg-white/8',
                                    )}
                                >
                                    <LayoutGrid className="h-3.5 w-3.5" />
                                    {mode === 'compact' ? 'Compatta' : 'Ampia'}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <Link
                    href="/patients/new"
                    className={cn(
                        'glass-command-primary ui-btn-primary flex items-center justify-center gap-2 px-5 text-[13px] font-semibold',
                        isWorkbench ? 'h-10 rounded-[12px]' : 'h-11',
                    )}
                >
                    <Plus className="h-4 w-4" />
                    Nuovo caso
                </Link>
            </div>
        </div>
    );
}
