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
        label: 'Active',
        className: 'border-[color:color-mix(in_srgb,var(--lume-accent)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-accent)_10%,transparent)] text-[color:var(--lume-accent)]',
    },
    review: {
        icon: ScanSearch,
        label: 'In review',
        className: 'border-[color:color-mix(in_srgb,var(--lume-signal-plum)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-plum)_10%,transparent)] text-[color:var(--lume-signal-plum)]',
    },
    completed: {
        icon: Check,
        label: 'Completed',
        className: 'border-[color:color-mix(in_srgb,var(--lume-signal-success)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-success)_10%,transparent)] text-[color:var(--lume-signal-success)]',
    },
    high: {
        icon: AlertTriangle,
        /* @Codex WUL-UIUX: 'high' (critico) deve gridare, non avere la stessa
           ricetta tenue di 'archived'. Bordo e fondo a piena forza + ombra. */
        label: 'High',
        className: 'border-[color:color-mix(in_srgb,var(--lume-signal-critical)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_16%,transparent)] text-[color:var(--lume-signal-critical)] shadow-[0_2px_10px_color-mix(in_srgb,var(--lume-signal-critical)_20%,transparent)]',
    },
    'follow-up': {
        icon: Clock3,
        label: 'Follow-up',
        className: 'border-[color:color-mix(in_srgb,var(--lume-signal-warning)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_10%,transparent)] text-[color:var(--lume-signal-warning)]',
    },
    archived: {
        icon: Archive,
        label: 'Archived',
        className: 'border-[color:color-mix(in_srgb,var(--lume-ink)_18%,transparent)] bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink-muted)]',
    },
    ambulatory: {
        icon: CircleDashed,
        label: 'Ambulatory',
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
