/* @Codex WUL-UIUX (STREAM E): bottone condiviso sopra le classi css esistenti
   (.ui-btn-primary, .mf-btn-secondary) piu i toni ghost/destructive derivati dai
   pattern ricorrenti. Non ridisegna: la resa e quella gia in uso. Le CTA primarie
   nel codice usano `ui-btn-primary px-5 py-2.5`; qui il padding di default e
   incapsulato. */

'use client';

import { forwardRef, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from 'react';

import { useLumeAnello } from '@/hooks/use-lume-anello';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
    /* La CTA primaria usa l'accento minerale e il gesto condiviso. */
    primary: 'ui-btn-primary px-5 py-2.5 disabled:opacity-50',
    /* Compagna quieta, in penombra opaca. */
    secondary: 'mf-btn-secondary disabled:opacity-50',
    ghost:
        'inline-flex items-center justify-center gap-2 rounded-full border border-transparent px-3 py-2 text-sm font-semibold text-[color:var(--lume-ink-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--lume-ink)_5%,transparent)] hover:text-[color:var(--lume-ink)] disabled:opacity-50',
    destructive:
        'inline-flex items-center justify-center gap-2 rounded-[18px] px-5 py-2.5 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primary', className, children, type = 'button', style, onPointerDown, ...rest },
    ref,
) {
    // @Codex: the anello is only a transient response to the direct gesture.
    const { anello, onLumePointerDown } = useLumeAnello();
    const destructiveStyle =
        variant === 'destructive' ? { background: 'var(--lume-signal-critical)', ...style } : style;

    const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        onLumePointerDown(event);
        onPointerDown?.(event);
    };

    return (
        <button
            ref={ref}
            type={type}
            className={cn(VARIANT_CLASSES[variant], 'lume-press', className)}
            style={destructiveStyle}
            onPointerDown={handlePointerDown}
            {...rest}
        >
            {children}
            {anello ? (
                <span
                    aria-hidden="true"
                    className="lume-anello"
                    style={{ left: anello.x, top: anello.y }}
                />
            ) : null}
        </button>
    );
});
