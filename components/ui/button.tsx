'use client';

import { forwardRef, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from 'react';

import { useLumeAnello } from '@/hooks/use-lume-anello';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'destructive' | 'icon' | 'ghost';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
    primary: 'mf-button-primary',
    secondary: 'mf-button-secondary',
    text: 'mf-button-text',
    ghost: 'mf-button-text',
    destructive: 'mf-button-destructive',
    icon: 'mf-button-icon',
};

type CommonProps = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode };

export type ButtonProps = CommonProps & (
    | { variant: 'icon'; 'aria-label': string; confirmation?: never }
    | { variant: 'destructive'; confirmation?: boolean }
    | { variant?: Exclude<ButtonVariant, 'icon' | 'destructive'>; confirmation?: never }
);

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primary', confirmation, className, children, type = 'button', onPointerDown, ...rest },
    ref,
) {
    const { anello, onLumePointerDown } = useLumeAnello();

    const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        onLumePointerDown(event);
        onPointerDown?.(event);
    };

    return (
        <button
            {...rest}
            ref={ref}
            type={type}
            className={cn('relative', VARIANT_CLASSES[variant], className)}
            data-command-confirmation={variant === 'destructive' && confirmation ? 'true' : undefined}
            onPointerDown={handlePointerDown}
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
