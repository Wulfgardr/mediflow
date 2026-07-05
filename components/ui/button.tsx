/* @Codex WUL-UIUX (STREAM E): bottone condiviso sopra le classi css esistenti
   (.ui-btn-primary, .mf-btn-secondary) piu i toni ghost/destructive derivati dai
   pattern ricorrenti. Non ridisegna: la resa e quella gia in uso. Le CTA primarie
   nel codice usano `ui-btn-primary px-5 py-2.5`; qui il padding di default e
   incapsulato. */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
    /* .ui-btn-primary porta gradiente, ombra, focus ring e text-white; qui aggiungo
       solo il padding che i call-site ripetevano. */
    primary: 'ui-btn-primary px-5 py-2.5 disabled:opacity-50',
    /* .mf-btn-secondary e la chrome calma companion definita in css. */
    secondary: 'mf-btn-secondary disabled:opacity-50',
    ghost:
        'inline-flex items-center justify-center gap-2 rounded-full border border-transparent px-3 py-2 text-sm font-semibold text-[color:var(--mf-muted)] transition-colors hover:bg-[color:rgba(112,106,100,0.08)] hover:text-[color:var(--mf-ink)] disabled:opacity-50',
    destructive:
        'inline-flex items-center justify-center gap-2 rounded-[18px] px-5 py-2.5 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primary', className, children, type = 'button', style, ...rest },
    ref,
) {
    const destructiveStyle =
        variant === 'destructive' ? { background: 'var(--mf-critical)', ...style } : style;
    return (
        <button
            ref={ref}
            type={type}
            className={cn(VARIANT_CLASSES[variant], className)}
            style={destructiveStyle}
            {...rest}
        >
            {children}
        </button>
    );
});
