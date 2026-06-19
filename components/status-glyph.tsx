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
        className: 'border-[color:rgba(15,123,104,0.18)] bg-[color:rgba(15,123,104,0.1)] text-[color:var(--mf-primary)]',
    },
    review: {
        icon: ScanSearch,
        label: 'In review',
        className: 'border-[color:rgba(94,53,95,0.18)] bg-[color:rgba(94,53,95,0.1)] text-[color:var(--mf-plum)]',
    },
    completed: {
        icon: Check,
        label: 'Completed',
        className: 'border-[color:rgba(63,122,76,0.18)] bg-[color:rgba(63,122,76,0.1)] text-[color:var(--mf-success)]',
    },
    high: {
        icon: AlertTriangle,
        /* @Codex WUL-UIUX: 'high' (critico) deve gridare, non avere la stessa
           ricetta tenue di 'archived'. Bordo e fondo a piena forza + ombra. */
        label: 'High',
        className: 'border-[color:rgba(163,58,47,0.55)] bg-[color:rgba(163,58,47,0.16)] text-[color:var(--mf-critical)] shadow-[0_2px_10px_rgba(163,58,47,0.2)]',
    },
    'follow-up': {
        icon: Clock3,
        label: 'Follow-up',
        className: 'border-[color:rgba(197,138,47,0.2)] bg-[color:rgba(197,138,47,0.1)] text-[color:var(--mf-warning)]',
    },
    archived: {
        icon: Archive,
        label: 'Archived',
        className: 'border-[color:rgba(112,106,100,0.18)] bg-[color:rgba(112,106,100,0.1)] text-[color:var(--mf-muted)]',
    },
    ambulatory: {
        icon: CircleDashed,
        label: 'Ambulatory',
        className: 'border-[color:rgba(15,123,104,0.12)] bg-[color:rgba(15,123,104,0.06)] text-[color:var(--mf-primary)]',
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
