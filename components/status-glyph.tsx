'use client';

import {
    AlertTriangle,
    Archive,
    Check,
    CircleDashed,
    Clock3,
    HeartPulse,
    ScanSearch,
} from 'lucide-react';

import { cn } from '@/lib/utils';

type StatusGlyphKind =
    | 'active'
    | 'review'
    | 'completed'
    | 'high'
    | 'follow-up'
    | 'archived'
    | 'ambulatory';

interface StatusGlyphProps {
    kind: StatusGlyphKind;
    label?: string;
    className?: string;
}

const GLYPH_MAP: Record<
    StatusGlyphKind,
    {
        icon: typeof CircleDashed;
        label: string;
        className: string;
    }
> = {
    active: {
        icon: HeartPulse,
        label: 'Attivo',
        className: 'border-[color:color-mix(in_srgb,var(--lume-accent)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-accent)_10%,transparent)] text-[color:var(--lume-accent)]',
    },
    review: {
        icon: ScanSearch,
        label: 'Da rivedere',
        className: 'border-[color:color-mix(in_srgb,var(--lume-signal-plum)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-plum)_10%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-plum)_60%,var(--lume-ink))]',
    },
    completed: {
        icon: Check,
        label: 'Completato',
        className: 'border-[color:color-mix(in_srgb,var(--lume-signal-success)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-success)_10%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]',
    },
    high: {
        icon: AlertTriangle,
        /* @Codex WUL-UIUX: 'high' (critico) deve gridare, non avere la stessa
           ricetta tenue di 'archived'. Bordo e fondo a piena forza + ombra. */
        label: 'Priorità alta',
        className: 'border-[color:color-mix(in_srgb,var(--lume-signal-critical)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_10%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))] shadow-[var(--lume-shadow-focal)]',
    },
    'follow-up': {
        icon: Clock3,
        label: 'Da ricontattare',
        className: 'border-[color:color-mix(in_srgb,var(--lume-signal-warning)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_10%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]',
    },
    archived: {
        icon: Archive,
        label: 'Archiviato',
        className: 'border-[color:color-mix(in_srgb,var(--lume-ink)_18%,transparent)] bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink-muted)]',
    },
    ambulatory: {
        icon: CircleDashed,
        label: 'Ambulatorio',
        className: 'border-[color:color-mix(in_srgb,var(--lume-accent)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-accent)_6%,transparent)] text-[color:var(--lume-accent)]',
    },
};

export function StatusGlyph({ kind, label, className }: StatusGlyphProps) {
    const glyph = GLYPH_MAP[kind];
    const Icon = glyph.icon;

    return (
        <span
            className={cn(
                'status-glyph inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-tight',
                glyph.className,
                className,
            )}
        >
            <span className="status-glyph-icon flex h-4 w-4 items-center justify-center rounded-full bg-white/60 dark:bg-black/15">
                <Icon className="h-3 w-3" strokeWidth={2.3} />
            </span>
            <span>{label ?? glyph.label}</span>
        </span>
    );
}
