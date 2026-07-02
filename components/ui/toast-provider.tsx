'use client';

/* @Codex WUL-UIUX: sistema toast unico. Sostituisce gli alert() nativi per il
   feedback non bloccante (esiti di salvataggio, errori). Regione aria-live polite
   cosi gli screen reader annunciano l'esito. Stile Vetro Clinico, token semantici.
   Niente dipendenze nuove. */

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

interface Toast {
    id: string;
    message: string;
    tone: ToastTone;
}

interface ToastContextValue {
    showToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastCounter = 0;

const TONE_STYLE: Record<ToastTone, { color: string; tint: string; Icon: typeof Info }> = {
    success: { color: 'var(--mf-success)', tint: 'rgba(45, 122, 90, 0.12)', Icon: CheckCircle2 },
    error: { color: 'var(--mf-critical)', tint: 'rgba(163, 58, 47, 0.12)', Icon: AlertTriangle },
    info: { color: 'var(--mf-primary)', tint: 'rgba(15, 123, 104, 0.12)', Icon: Info },
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    const { color, tint, Icon } = TONE_STYLE[toast.tone];
    return (
        <div
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[14px] border border-[color:rgba(15,23,42,0.12)] bg-[color:var(--glass-bg,rgba(255,255,255,0.92))] px-4 py-3 shadow-[0_18px_45px_rgba(15,23,42,0.18)] backdrop-blur dark:border-white/10 dark:bg-[color:rgba(28,31,40,0.92)]"
        >
            <span className="mt-0.5 shrink-0 rounded-full p-1" style={{ background: tint, color }}>
                <Icon className="h-4 w-4" />
            </span>
            <p className="min-w-0 flex-1 text-sm leading-5 text-[color:var(--mf-ink)]">{toast.message}</p>
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
        (message: string, tone: ToastTone = 'info') => {
            toastCounter += 1;
            const id = `toast-${toastCounter}`;
            setToasts((prev) => [...prev, { id, message, tone }]);
            timers.current[id] = setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
        },
        [dismiss],
    );

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div
                className="pointer-events-none fixed inset-x-0 bottom-4 z-[200] flex flex-col items-center gap-2 px-4"
                role="status"
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
        showToast: (message, tone) => {
            console.warn(`[toast:${tone ?? 'info'}] ${message}`);
        },
    };
}
