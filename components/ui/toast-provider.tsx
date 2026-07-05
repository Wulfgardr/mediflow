'use client';

/* @Codex WUL-UIUX: sistema toast unico. Sostituisce gli alert() nativi per il
   feedback non bloccante (esiti di salvataggio, errori). Regione aria-live polite
   cosi gli screen reader annunciano l'esito. Stile Vetro Clinico, token semantici.
   Niente dipendenze nuove. Due firme equivalenti:
   showToast('Messaggio', 'success') oppure
   showToast({ tone: 'warning', title: 'Titolo', description: 'Dettaglio' }). */

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
    tone?: ToastTone;
    title: string;
    description?: string;
}

export type ToastInput = string | ToastOptions;

interface Toast {
    id: string;
    tone: ToastTone;
    title: string;
    description?: string;
}

interface ToastContextValue {
    showToast: (input: ToastInput, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastCounter = 0;

const TONE_STYLE: Record<ToastTone, { color: string; tint: string; Icon: typeof Info }> = {
    success: { color: 'var(--mf-success)', tint: 'rgba(45, 122, 90, 0.12)', Icon: CheckCircle2 },
    error: { color: 'var(--mf-critical)', tint: 'rgba(163, 58, 47, 0.12)', Icon: XCircle },
    warning: { color: 'var(--mf-warning)', tint: 'rgba(154, 106, 47, 0.12)', Icon: AlertTriangle },
    info: { color: 'var(--mf-primary)', tint: 'rgba(15, 123, 104, 0.12)', Icon: Info },
};

const TONE_DURATION: Record<ToastTone, number> = {
    success: 4000,
    info: 4000,
    warning: 5500,
    error: 7000,
};

function normalizeToast(input: ToastInput, tone?: ToastTone): Omit<Toast, 'id'> {
    if (typeof input === 'string') {
        return { title: input, tone: tone ?? 'info' };
    }
    return { title: input.title, description: input.description, tone: input.tone ?? tone ?? 'info' };
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    const { color, tint, Icon } = TONE_STYLE[toast.tone];
    return (
        <div
            role={toast.tone === 'error' || toast.tone === 'warning' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[14px] border border-[color:rgba(15,23,42,0.12)] bg-[color:var(--glass-bg,rgba(255,255,255,0.92))] px-4 py-3 shadow-[0_18px_45px_rgba(15,23,42,0.18)] backdrop-blur dark:border-white/10 dark:bg-[color:rgba(28,31,40,0.92)]"
        >
            <span className="mt-0.5 shrink-0 rounded-full p-1" style={{ background: tint, color }}>
                <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-5 text-[color:var(--mf-ink)]">{toast.title}</p>
                {toast.description ? (
                    <p className="mt-0.5 text-xs leading-4 text-[color:var(--mf-muted)]">{toast.description}</p>
                ) : null}
            </div>
            <button
                type="button"
                onClick={onDismiss}
                aria-label="Chiudi notifica"
                className="shrink-0 rounded-lg p-1 text-[color:var(--mf-muted)] transition-colors hover:text-[color:var(--mf-ink)]"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const dismiss = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
        const timer = timers.current[id];
        if (timer) {
            clearTimeout(timer);
            delete timers.current[id];
        }
    }, []);

    const showToast = useCallback(
        (input: ToastInput, tone?: ToastTone) => {
            toastCounter += 1;
            const id = `toast-${toastCounter}`;
            const normalized = normalizeToast(input, tone);
            setToasts((prev) => [...prev, { id, ...normalized }]);
            timers.current[id] = setTimeout(() => dismiss(id), TONE_DURATION[normalized.tone]);
        },
        [dismiss],
    );

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div
                className="pointer-events-none fixed inset-x-0 bottom-4 z-[200] flex flex-col items-center gap-2 px-4"
                aria-live="polite"
                aria-atomic="false"
            >
                {toasts.map((toast) => (
                    <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
                ))}
            </div>
        </ToastContext.Provider>
    );
}

/* Ritorna sempre una funzione: se il provider non e montato, degrada a console
   invece di lanciare (nessuna superficie deve rompersi per un toast mancante). */
export function useToast(): ToastContextValue {
    const context = useContext(ToastContext);
    if (context) return context;
    return {
        showToast: (input, tone) => {
            const normalized = normalizeToast(input, tone);
            console.warn(`[toast:${normalized.tone}] ${normalized.title}${normalized.description ? ` - ${normalized.description}` : ''}`);
        },
    };
}
