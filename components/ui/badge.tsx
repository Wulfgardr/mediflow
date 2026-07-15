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
    info: 'border-[color:color-mix(in_srgb,var(--lume-accent)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-accent)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-accent)_60%,var(--lume-ink))]',
    success:
        'border-[color:color-mix(in_srgb,var(--lume-signal-success)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-success)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]',
    warning:
        'border-[color:color-mix(in_srgb,var(--lume-signal-warning)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]',
    danger:
        'border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]',
};

/* @Codex: compatibilita nominale per i consumatori legacy. I nomi della palette
   restano stabili, ma la resa converge sui ruoli Lume: warning, critical,
   accento minerale informativo, success e neutri d'inchiostro. */
export type BadgePalette =
    | 'amber'
    | 'red'
    | 'blue'
    | 'emerald'
    | 'slate'
    | 'slate-plain'
    | 'dashed';

const PALETTE_CLASSES: Record<BadgePalette, string> = {
    amber: TONE_CLASSES.warning,
    red: TONE_CLASSES.danger,
    blue: TONE_CLASSES.info,
    emerald:
        TONE_CLASSES.success,
    slate: TONE_CLASSES.neutral,
    'slate-plain':
        'border-[color:color-mix(in_srgb,var(--lume-ink)_18%,transparent)] bg-[color:var(--lume-surface-focal)] text-[color:var(--lume-ink-muted)]',
    dashed: 'border-dashed border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] bg-transparent text-[color:var(--lume-ink-muted)]',
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
    /** Alias nominale legacy, reso attraverso i ruoli semantici Lume. */
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
