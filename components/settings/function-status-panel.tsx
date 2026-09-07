'use client';

/* @Codex WUL-674 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FUNCTION_META, FUNCTION_STATE_LABELS, parseFunctionStatus, type FunctionStatusSnapshot } from '@/lib/function-status';
import { SETTINGS_CARD_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from './settings-ui';

export function FunctionStatusPanel() {
    const [revision, setRevision] = useState(0);
    const [state, setState] = useState<{ kind: 'loading' | 'error' | 'unauthorized' } | { kind: 'ready'; snapshot: FunctionStatusSnapshot }>({ kind: 'loading' });
    useEffect(() => {
        const controller = new AbortController();
        void (async () => {
            setState({ kind: 'loading' });
            try {
                const response = await fetch('/api/system/function-status', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
                if (response.status === 401) { if (!controller.signal.aborted) setState({ kind: 'unauthorized' }); return; }
                if (!response.ok) throw new Error('Status unavailable');
                const snapshot = parseFunctionStatus(await response.json());
                if (!controller.signal.aborted) setState({ kind: 'ready', snapshot });
            } catch { if (!controller.signal.aborted) setState({ kind: 'error' }); }
        })();
        return () => controller.abort();
    }, [revision]);
    return (
        <section className={SETTINGS_CARD_CLASS} aria-labelledby="function-status-title" data-testid="function-status-panel">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 id="function-status-title" className="text-base font-semibold">Stato delle funzioni</h2>
                    <p className="mt-1 text-sm text-[color:var(--lume-ink-muted)]">Prerequisiti e azioni per questa postazione.</p>
                </div>
                <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={state.kind === 'loading'} onClick={() => setRevision(value => value + 1)}>Rileggi stato</button>
            </header>
            {state.kind === 'loading' && <p className="py-5 text-sm" role="status">Lettura dello stato…</p>}
            {state.kind === 'error' && <p className="py-5 text-sm" role="alert">Stato non disponibile. Riprova: un errore di lettura non significa che le funzioni siano spente.</p>}
            {state.kind === 'unauthorized' && <p className="py-5 text-sm" role="alert">Sblocca la sessione per leggere lo stato.</p>}
            {state.kind === 'ready' && <>
                <p className="mt-3 text-xs text-[color:var(--lume-ink-muted)]">Configurazione letta il <time dateTime={state.snapshot.checkedAt}>{new Date(state.snapshot.checkedAt).toLocaleString('it-IT')}</time>. Nessun modello eseguito da questo controllo.</p>
                <ul className="mt-4 divide-y divide-[color:var(--lume-border)]">
                    {state.snapshot.functions.map(row => {
                        const meta = FUNCTION_META[row.id];
                        const action = row.state === 'off' && row.id !== 'icd11' ? { href: '/settings/ai/funzioni', action: 'Apri gli interruttori' } : meta;
                        return <li key={row.id} data-testid={`function-state-${row.id}`} className="py-4 first:pt-0 last:pb-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-sm font-semibold">{meta.title}</h3>
                                <span className="inline-flex items-center border border-[color:var(--lume-border)] bg-[color:var(--lume-surface-field)]" data-lume-status data-state={row.state}>{FUNCTION_STATE_LABELS[row.state]}</span>
                            </div>
                            <p className="mt-1 text-sm text-[color:var(--lume-ink-muted)]">{meta.purpose}</p>
                            <p className="mt-2 text-sm leading-6">{row.reason}</p>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                                <details className="min-w-0 text-xs [overflow-wrap:anywhere] text-[color:var(--lume-ink-muted)]">
                                    <summary className="cursor-pointer">Dettagli del servizio</summary>
                                    <p className="mt-2">{row.provider}{row.model ? ` · ${row.model}` : ''}</p>
                                    <p className="mt-1">Ultima esecuzione: non rilevata da questa vista.</p>
                                </details>
                                <Link className={SETTINGS_SECONDARY_BUTTON_CLASS} href={action.href}>{action.action}</Link>
                            </div>
                        </li>;
                    })}
                </ul>
            </>}
        </section>
    );
}
