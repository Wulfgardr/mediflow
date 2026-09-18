'use client';

/* @Codex WUL-674 / WUL-684: presentation only; status/actions remain server-owned. */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FUNCTION_META, FUNCTION_STATE_LABELS, parseFunctionStatus, type FunctionId, type FunctionStatusRow, type FunctionStatusSnapshot } from '@/lib/function-status';
import { SETTINGS_SECONDARY_BUTTON_CLASS } from './settings-ui';
import styles from './function-status-panel.module.css';

/* @Codex: Fabric presents intelligent functions; ICD-11 belongs to Repertori.
   The complete seven-row API snapshot is still validated without modification. */
const FUNCTION_GROUPS: readonly { id: string; title: string; functions: readonly FunctionId[] }[] = [
    { id: 'summaries', title: 'Sintesi, importazione e revisione del trattamento', functions: ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'] },
    { id: 'reading', title: 'Lettura dei documenti', functions: ['document_text', 'document_ocr'] },
];

function FunctionCard({ row }: { row: FunctionStatusRow }) {
    const meta = FUNCTION_META[row.id];
    const action = row.state === 'off' && row.id !== 'icd11'
        ? { href: '/settings/ai/funzioni', action: 'Scegli le funzioni attive' } : meta;
    return (
        <li data-testid={`function-state-${row.id}`} className={styles.card}>
            <div className={styles.cardHeader}>
                <h4>{meta.title}</h4>
                <span className={styles.status} data-lume-status data-state={row.state}>{FUNCTION_STATE_LABELS[row.state]}</span>
            </div>
            <p className={styles.purpose}>{meta.purpose}</p>
            <div className={styles.provider}>
                <span className={styles.providerLabel}>{row.model ? 'Servizio e modello configurati' : 'Servizio previsto'}</span>
                <strong>{row.provider}{row.model ? ` · ${row.model}` : ''}</strong>
            </div>
            <p>{row.reason}</p>
            <div className={styles.footer}>
                <Link className={SETTINGS_SECONDARY_BUTTON_CLASS} href={action.href}>{action.action}</Link>
                <details>
                    <summary>Come leggere lo stato</summary>
                    <p>Questa vista legge la configurazione, non prova il funzionamento. «Da provare» non significa pronta all’uso clinico. Controlla il risultato e le fonti nella cartella: qui non è rilevata l’ultima esecuzione. Lo stato del collegamento account e l’esito della demo OpenAI non sostituiscono i controlli della singola funzione.</p>
                </details>
            </div>
        </li>
    );
}

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
        <section className={styles.panel} aria-labelledby="function-status-title" data-testid="function-status-panel">
            <header className={styles.header}>
                <div>
                    <h2 id="function-status-title">Le tue funzioni</h2>
                    <p>Per ogni attività: configurazione, eventuali blocchi e prossimo passo. Questa lettura non attiva funzioni e non autorizza l’invio di dati.</p>
                </div>
                <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={state.kind === 'loading'} onClick={() => setRevision(value => value + 1)}>Rileggi stato</button>
            </header>
            {state.kind === 'loading' && <p className="py-5 text-sm" role="status">Lettura dello stato…</p>}
            {state.kind === 'error' && <p className="py-5 text-sm" role="alert">Stato non disponibile. Premi «Rileggi stato»: un errore di lettura non significa che le funzioni siano spente.</p>}
            {state.kind === 'unauthorized' && <p className="py-5 text-sm" role="alert">Sblocca la sessione per leggere lo stato.</p>}
            {state.kind === 'ready' && <>
                <p className={styles.checkedAt}>Configurazione letta il <time dateTime={state.snapshot.checkedAt}>{new Date(state.snapshot.checkedAt).toLocaleString('it-IT')}</time>. Questo controllo non esegue modelli.</p>
                {FUNCTION_GROUPS.map(group => (
                    <section key={group.id} className={styles.group} aria-labelledby={`function-group-${group.id}`}>
                        <h3 id={`function-group-${group.id}`}>{group.title}</h3>
                        <ul className={styles.cards}>
                            {group.functions.map(id => <FunctionCard key={id} row={state.snapshot.functions.find(row => row.id === id)!} />)}
                        </ul>
                    </section>
                ))}
            </>}
        </section>
    );
}
