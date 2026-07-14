/* @Codex WUL-UIUX (STREAM E): pillola di stato condivisa. Consolida le decine di
   varianti className scritte a mano (rounded-full border px-.. text-[11px]
   font-semibold + tinte semantiche) in un'unica API a toni. Le ricette dei toni
   derivano da status-glyph.tsx, che era la resa canonica del vocabolario
   Lume (accento minerale, plum, success, critical, warning e inchiostro). */

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<BadgeTone, string> = {
    neutral:
        'border-[color:color-mix(in_srgb,var(--lume-ink)_18%,transparent)] bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink-muted)]',
    info: 'border-[color:color-mix(in_srgb,var(--lume-signal-plum)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-plum)_10%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-plum)_60%,var(--lume-ink))]',
    success:
        'border-[color:color-mix(in_srgb,var(--lume-signal-success)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-success)_10%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]',
    warning:
        'border-[color:color-mix(in_srgb,var(--lume-signal-warning)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_10%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]',
    danger:
        'border-[color:color-mix(in_srgb,var(--lume-signal-critical)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_10%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]',
};

/* @Codex WUL-UIUX (STREAM W2-B): dimensione "palette" a famiglie di colore Tailwind.
   Le pillole di stato fuori dal cockpit non parlano il vocabolario semantico Lume
   ma tinte Tailwind con override dark-mode scritti a mano (amber/emerald/blue/red/
   slate). Invece di forzarle sui toni semantici (che sarebbe un ridisegno), qui le
   riproduco fedelmente, classe per classe, cosi i call-site possono migrare senza
   deriva visiva. Chi vuole la resa semantica continua a usare `tone`. */
export type BadgePalette =
    | 'amber'
    | 'red'
    | 'blue'
    | 'emerald'
    | 'slate'
    | 'slate-plain'
    | 'dashed';

const PALETTE_CLASSES: Record<BadgePalette, string> = {
    amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-900/20 dark:text-amber-300',
    red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-950/20 dark:text-red-300',
    blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-950/20 dark:text-blue-300',
    emerald:
        'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-950/20 dark:text-emerald-300',
    slate: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-slate-300',
    'slate-plain':
        'border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300',
    dashed: 'border-dashed border-slate-300 bg-transparent text-slate-500 dark:border-white/15 dark:text-slate-400',
};

/* Le pillole a palette usano una geometria piu compatta di quelle semantiche:
   micro-testo maiuscolo (px-2 py-0.5 text-[10px] font-bold uppercase) contro
   il default (px-2.5 py-1 text-[11px] font-semibold). `size` la seleziona. */
export type BadgeSize = 'default' | 'xs';

const SIZE_CLASSES: Record<BadgeSize, string> = {
    default: 'gap-1.5 px-2.5 py-1 text-[11px] font-semibold tracking-tight',
    xs: 'gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
};

export interface BadgeProps {
    /** Resa semantica sui token Lume. Ignorata quando `palette` e presente. */
    tone?: BadgeTone;
    /** Resa a famiglia di colore Tailwind (con dark-mode), per le pillole legacy. */
    palette?: BadgePalette;
    size?: BadgeSize;
    children: ReactNode;
    className?: string;
    /** Glifo opzionale a sinistra (icona lucide o simile). */
    icon?: ReactNode;
    title?: string;
    'data-testid'?: string;
}

export function Badge({
    tone = 'neutral',
    palette,
    size = 'default',
    children,
    className,
    icon,
    title,
    'data-testid': dataTestId,
}: BadgeProps) {
    return (
        <span
            title={title}
            data-testid={dataTestId}
            className={cn(
                'inline-flex items-center rounded-full border',
                SIZE_CLASSES[size],
                palette ? PALETTE_CLASSES[palette] : TONE_CLASSES[tone],
                className,
            )}
        >
            {icon}
            <span>{children}</span>
        </span>
    );
}
