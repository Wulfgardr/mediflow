'use client';

/* @Codex WUL-UIUX (STREAM E): shell modale condivisa, costruita su useDialogA11y
   e visivamente allineata a confirm-dialog.tsx (backdrop mf-modal-backdrop, shell
   mf-modal-shell, barra d'accento in cima, titolo + sottotitolo, bottone chiudi).
   Sostituisce i dialoghi role="dialog" scritti a mano che ripetevano lo stesso
   markup e la stessa logica di focus trap. confirm-dialog resta com'e. */

import { useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useDialogA11y } from './use-dialog-a11y';

export type ModalAccent = 'primary' | 'critical' | 'warning' | 'success';

const ACCENT_VAR: Record<ModalAccent, string> = {
    primary: 'var(--lume-accent)',
    critical: 'var(--lume-signal-critical)',
    warning: 'var(--lume-signal-warning)',
    success: 'var(--lume-signal-success)',
};

export interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: ReactNode;
    /** Sottotitolo opzionale sotto al titolo (es. nome paziente). */
    subtitle?: ReactNode;
    /** Glifo opzionale accanto al titolo. */
    icon?: ReactNode;
    accent?: ModalAccent;
    children: ReactNode;
    /** Barra azioni opzionale in fondo. */
    footer?: ReactNode;
    className?: string;
    /** Larghezza massima della shell (default max-w-md). */
    maxWidthClassName?: string;
}

export function Modal({
    open,
    onClose,
    title,
    subtitle,
    icon,
    accent = 'primary',
    children,
    footer,
    className,
    maxWidthClassName = 'max-w-md',
}: ModalProps) {
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);

    useDialogA11y(open, dialogRef, onClose);

    if (!open) return null;

    return (
        <div className="mf-modal-backdrop animate-in fade-in duration-[var(--lume-dur-riga)]">
            <button
                type="button"
                aria-label="Chiudi sfondo"
                className="absolute inset-0 cursor-default"
                onClick={onClose}
            />
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className={cn(
                    'mf-modal-shell lume-overlay-shadow relative w-full overflow-hidden animate-in fade-in zoom-in-95 duration-[var(--lume-dur-fuoco)]',
                    maxWidthClassName,
                    className,
                )}
            >
                <div aria-hidden className="h-1.5 w-full" style={{ background: ACCENT_VAR[accent] }} />
                <div className="p-6">
                    <div className="mb-5 flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                            {icon ? (
                                <span
                                    className="flex shrink-0 items-center justify-center rounded-2xl p-3"
                                    style={{ background: `${ACCENT_VAR[accent]}1f`, color: ACCENT_VAR[accent] }}
                                >
                                    {icon}
                                </span>
                            ) : null}
                            <div>
                                <h3
                                    id={titleId}
                                    className="text-lg font-semibold tracking-tight text-[color:var(--lume-ink)]"
                                >
                                    {title}
                                </h3>
                                {subtitle ? (
                                    <p className="text-xs font-medium text-[color:var(--lume-ink-muted)]">{subtitle}</p>
                                ) : null}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="mf-btn-secondary !rounded-full !p-2"
                            aria-label="Chiudi"
                            title="Chiudi"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    {children}

                    {footer ? <div className="mt-6 flex justify-end gap-3">{footer}</div> : null}
                </div>
            </div>
        </div>
    );
}
