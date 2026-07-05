/* @Codex WUL-UIUX (STREAM E): pannello ricorrente vetro+bordo. Consolida il
   pattern scritto a mano ~8 volte per le sottoschede paziente:
     rounded-[24px] border border-slate-200/70 bg-white/80 p-4
     dark:border-white/10 dark:bg-white/[0.04]
   Le shell di livello superiore restano su .glass-panel/.glass-card (gia in css);
   questo copre le card interne piu piccole. */

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface CardProps {
    children: ReactNode;
    className?: string;
    /** Padding interno predefinito (p-4). Passa false per gestirlo a mano. */
    padded?: boolean;
    as?: 'div' | 'section' | 'article' | 'li';
}

export function Card({ children, className, padded = true, as = 'div' }: CardProps) {
    const Component = as;
    return (
        <Component
            className={cn(
                'rounded-[24px] border border-slate-200/70 bg-white/80 dark:border-white/10 dark:bg-white/[0.04]',
                padded && 'p-4',
                className,
            )}
        >
            {children}
        </Component>
    );
}
