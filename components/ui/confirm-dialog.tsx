'use client';

/* @Codex WUL-UIUX: dialogo di conferma accessibile e tematizzato, con campo
   motivazione opzionale (sostituisce prompt() per l'eliminazione clinica). Riusa
   useDialogA11y (Escape, focus trap, restore) e lo stile mf-modal. useConfirm()
   ritorna una Promise: sostituisce confirm()/prompt() nativi. Fallback nativo se
   il provider non e montato, cosi nessuna superficie si rompe. */

import { createContext, useCallback, useContext, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

import { useDialogA11y } from './use-dialog-a11y';

export interface ConfirmOptions {
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'danger' | 'default';
    requireReason?: boolean;
    reasonLabel?: string;
    reasonPlaceholder?: string;
}

export interface ConfirmResult {
    confirmed: boolean;
    reason?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<ConfirmResult>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [options, setOptions] = useState<ConfirmOptions | null>(null);
    const [reason, setReason] = useState('');
    const resolverRef = useRef<((result: ConfirmResult) => void) | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const messageId = useId();
    const reasonId = useId();

    const close = useCallback((result: ConfirmResult) => {
        resolverRef.current?.(result);
        resolverRef.current = null;
        setOptions(null);
        setReason('');
    }, []);

    useDialogA11y(options !== null, dialogRef, () => close({ confirmed: false }));

    const confirm = useCallback<ConfirmFn>((opts) => {
        /* @Codex WUL-UIUX: se un dialogo e gia aperto, risolvi la Promise pendente
           come annullata prima di rimpiazzarla, altrimenti resterebbe irrisolta. */
        resolverRef.current?.({ confirmed: false });
        resolverRef.current = null;
        setOptions(opts);
        setReason('');
        return new Promise<ConfirmResult>((resolve) => {
            resolverRef.current = resolve;
        });
    }, []);

    const isDanger = options?.tone === 'danger';
    const reasonMissing = Boolean(options?.requireReason) && reason.trim().length === 0;

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            {options ? (
                <div className="mf-modal-backdrop animate-in fade-in duration-[var(--lume-dur-riga)]">
                    <button
                        type="button"
                        aria-label="Chiudi sfondo"
                        className="absolute inset-0 cursor-default"
                        onClick={() => close({ confirmed: false })}
                    />
                    <div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                        aria-describedby={options.message ? messageId : undefined}
                        tabIndex={-1}
                        className="mf-modal-shell lume-overlay-shadow relative w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-[var(--lume-dur-fuoco)]"
                    >
                        <div aria-hidden className="h-1.5 w-full" style={{ background: isDanger ? 'var(--lume-signal-critical)' : 'var(--lume-accent)' }} />
                        <div className="p-6">
                            <div className="mb-4 flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    {isDanger ? (
                                        <span className="rounded-[var(--lume-radius-control)] p-3" style={{ background: 'color-mix(in srgb, var(--lume-signal-critical) 12%, transparent)', color: 'var(--lume-signal-critical)' }}>
                                            <AlertTriangle className="h-5 w-5" />
                                        </span>
                                    ) : null}
                                    <h3 id={titleId} className="text-lg font-semibold tracking-tight text-[color:var(--lume-ink)]">
                                        {options.title}
                                    </h3>
                                </div>
                                <button onClick={() => close({ confirmed: false })} className="mf-btn-secondary !p-2 !rounded-full" aria-label="Chiudi">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            {options.message ? (
                                <p id={messageId} className="text-sm leading-6 text-[color:var(--lume-ink-muted)]">{options.message}</p>
                            ) : null}

                            {options.requireReason ? (
                                <div className="mt-4">
                                    <label htmlFor={reasonId} className="mf-field-label">
                                        {options.reasonLabel ?? 'Motivazione'} <span style={{ color: 'var(--lume-signal-critical)' }}>*</span>
                                    </label>
                                    <textarea
                                        id={reasonId}
                                        aria-required
                                        value={reason}
                                        onChange={(event) => setReason(event.target.value)}
                                        rows={3}
                                        className="mf-input"
                                        placeholder={options.reasonPlaceholder}
                                    />
                                </div>
                            ) : null}

                            <div className="mt-6 flex justify-end gap-3">
                                <button type="button" onClick={() => close({ confirmed: false })} className="mf-btn-secondary">
                                    {options.cancelLabel ?? 'Annulla'}
                                </button>
                                <button
                                    type="button"
                                    disabled={reasonMissing}
                                    onClick={() => close({ confirmed: true, reason: options.requireReason ? reason.trim() : undefined })}
                                    className="ui-btn-primary px-5 py-2.5 disabled:opacity-50"
                                    style={isDanger ? { background: 'var(--lume-signal-critical)' } : undefined}
                                >
                                    {options.confirmLabel ?? 'Conferma'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </ConfirmContext.Provider>
    );
}

export function useConfirm(): ConfirmFn {
    const context = useContext(ConfirmContext);
    if (context) return context;
    /* Fallback nativo se il provider non e montato: i chiamanti non si rompono. */
    return async (options) => {
        if (options.requireReason) {
            const reason = window.prompt(options.reasonLabel ?? options.title);
            return { confirmed: reason !== null && reason.trim().length > 0, reason: reason?.trim() };
        }
        return { confirmed: window.confirm(options.message ?? options.title) };
    };
}
