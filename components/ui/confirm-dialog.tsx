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

    const close = useCallback((result: ConfirmResult) => {
        resolverRef.current?.(result);
        resolverRef.current = null;
        setOptions(null);
        setReason('');
    }, []);

    useDialogA11y(options !== null, dialogRef, () => close({ confirmed: false }));

    const confirm = useCallback<ConfirmFn>((opts) => {
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
                <div className="mf-modal-backdrop animate-in fade-in duration-200">
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
                        tabIndex={-1}
                        className="mf-modal-shell relative w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200"
                    >
                        <div aria-hidden className="h-1.5 w-full" style={{ background: isDanger ? 'var(--mf-critical)' : 'var(--mf-primary)' }} />
                        <div className="p-6">
                            <div className="mb-4 flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    {isDanger ? (
                                        <span className="rounded-2xl p-3" style={{ background: 'rgba(163,58,47,0.12)', color: 'var(--mf-critical)' }}>
                                            <AlertTriangle className="h-5 w-5" />
                                        </span>
                                    ) : null}
                                    <h3 id={titleId} className="text-lg font-semibold tracking-tight text-[color:var(--mf-ink)]">
                                        {options.title}
                                    </h3>
                                </div>
                                <button onClick={() => close({ confirmed: false })} className="mf-btn-secondary !p-2 !rounded-full" aria-label="Chiudi">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            {options.message ? (
                                <p className="text-sm leading-6 text-[color:var(--mf-muted)]">{options.message}</p>
                            ) : null}

                            {options.requireReason ? (
                                <div className="mt-4">
                                    <label className="mf-field-label">
                                        {options.reasonLabel ?? 'Motivazione'} <span style={{ color: 'var(--mf-critical)' }}>*</span>
                                    </label>
                                    <textarea
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
                                    style={isDanger ? { background: 'var(--mf-critical)' } : undefined}
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
