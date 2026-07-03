/* @Codex WUL-UIUX (STREAM E): pillola di stato condivisa. Consolida le decine di
   varianti className scritte a mano (rounded-full border px-.. text-[11px]
   font-semibold + tinte semantiche) in un'unica API a toni. Le ricette dei toni
   derivano da status-glyph.tsx, che era la resa canonica del vocabolario
   --mf-* (primary / plum / success / critical / warning / muted). */

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<BadgeTone, string> = {
    neutral:
        'border-[color:rgba(112,106,100,0.18)] bg-[color:rgba(112,106,100,0.1)] text-[color:var(--mf-muted)]',
    info: 'border-[color:rgba(94,53,95,0.18)] bg-[color:rgba(94,53,95,0.1)] text-[color:var(--mf-plum)]',
    success:
        'border-[color:rgba(63,122,76,0.18)] bg-[color:rgba(63,122,76,0.1)] text-[color:var(--mf-success)]',
    warning:
        'border-[color:rgba(197,138,47,0.2)] bg-[color:rgba(197,138,47,0.1)] text-[color:var(--mf-warning)]',
    danger:
        'border-[color:rgba(163,58,47,0.28)] bg-[color:rgba(163,58,47,0.12)] text-[color:var(--mf-critical)]',
};

export interface BadgeProps {
    tone?: BadgeTone;
    children: ReactNode;
    className?: string;
    /** Glifo opzionale a sinistra (icona lucide o simile). */
    icon?: ReactNode;
    title?: string;
}

export function Badge({ tone = 'neutral', children, className, icon, title }: BadgeProps) {
    return (
        <span
            title={title}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-tight',
                TONE_CLASSES[tone],
                className,
            )}
        >
            {icon}
            <span>{children}</span>
        </span>
    );
}
