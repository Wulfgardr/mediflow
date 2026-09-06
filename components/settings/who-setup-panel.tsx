'use client';

/* @Codex WUL-673: guides the existing disabled-by-default service; no credential entry in the browser. */
import { useEffect, useMemo, useState } from 'react';
import { createICDReferenceDataClient, icdClientErrorMessage, icdReadinessMessage, type ICDReadiness, type ICDSearchReceipt } from '@/lib/icd-service';
import { SETTINGS_CARD_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from './settings-ui';

export function WhoSetupPanel() {
    const [refresh, setRefresh] = useState(0);
    const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; readiness: ICDReadiness }>({ kind: 'loading' });
    const [probe, setProbe] = useState<{ kind: 'idle' | 'running' } | { kind: 'error'; message: string; at: string } | { kind: 'done'; receipt: ICDSearchReceipt }>({ kind: 'idle' });
    const client = useMemo(() => createICDReferenceDataClient((input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(8000) })), []);
    useEffect(() => {
        let cancelled = false;
        void client.readiness().then(readiness => { if (!cancelled) setState({ kind: 'ready', readiness }); })
            .catch(error => { if (!cancelled) setState({ kind: 'error', message: icdClientErrorMessage(error) }); });
        return () => { cancelled = true; };
    }, [client, refresh]);
    async function verify() {
        setProbe({ kind: 'running' });
        try {
            await client.search('cholera');
            const receipt = client.lastReceipt();
            if (!receipt) throw new Error('Missing receipt');
            setProbe({ kind: 'done', receipt });
        } catch (error) { setProbe({ kind: 'error', message: icdClientErrorMessage(error), at: new Date().toISOString() }); }
        setRefresh(value => value + 1);
    }
    const canVerify = state.kind === 'ready' && ['configured', 'available', 'unavailable'].includes(state.readiness.status);
    return <section id="who-setup" className={SETTINGS_CARD_CLASS} aria-labelledby="who-setup-title" data-testid="who-setup-panel">
        <h2 id="who-setup-title" className="text-base font-semibold">Terminologia WHO</h2>
        <p className="mt-1 text-sm text-[color:var(--lume-ink-muted)]">ICD-11 · MMS 2026-01 · inglese</p>
        {state.kind === 'loading' && <p className="mt-4 text-sm" role="status">Lettura della configurazione…</p>}
        {state.kind === 'error' && <p className="mt-4 text-sm" role="alert">{state.message}</p>}
        {state.kind === 'ready' && <p className="mt-4 text-sm font-medium">{icdReadinessMessage(state.readiness.status)}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={probe.kind === 'running'} onClick={() => { setState({ kind: 'loading' }); setRefresh(value => value + 1); }}>Rileggi configurazione</button>
            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={!canVerify || probe.kind === 'running'} onClick={() => void verify()}>{probe.kind === 'running' ? 'Verifica in corso…' : 'Verifica con termine di esempio'}</button>
        </div>
        <p className="mt-2 text-xs leading-5 text-[color:var(--lume-ink-muted)]">La verifica cerca il termine pubblico “cholera”. Non usa dati della cartella e non cambia la configurazione.</p>
        {probe.kind === 'done' && <p className="mt-3 text-sm" role="status">{probe.receipt.source === 'live' ? 'Risposta WHO ricevuta' : 'Risposta dalla cache locale: non verifica la rete'} · {probe.receipt.resultCount} risultati · <time dateTime={probe.receipt.completedAt}>{new Date(probe.receipt.completedAt).toLocaleString('it-IT')}</time>.</p>}
        {probe.kind === 'error' && <p className="mt-3 text-sm" role="alert">Verifica non riuscita: {probe.message} <time dateTime={probe.at}>{new Date(probe.at).toLocaleTimeString('it-IT')}</time></p>}
        <details className="mt-5 text-sm">
            <summary className="cursor-pointer font-medium">Configurazione sul server</summary>
            <ol className="mt-3 list-decimal space-y-2 pl-5 leading-6">
                <li>Registra un client nell’<a href="https://icd.who.int/icdapi" target="_blank" rel="noopener noreferrer" className="underline">API ufficiale WHO</a>.</li>
                <li>Configura client ID e secret nell’ambiente del processo server. Le credenziali non vanno inserite qui.</li>
                <li>Abilita esplicitamente il servizio e il collegamento di rete, riavvia il server e rileggi la configurazione.</li>
                <li>Esegui la verifica di esempio; una risposta dalla cache va distinta da una risposta WHO appena ricevuta.</li>
            </ol>
            <dl className="mt-4 space-y-2 break-words text-xs">
                <div><dt><code>MEDIFLOW_ICD_WHO_ENABLED</code></dt><dd>1, soltanto quando vuoi abilitare il servizio.</dd></div>
                <div><dt><code>MEDIFLOW_ICD_WHO_NETWORK</code></dt><dd>online, per consentire il collegamento WHO.</dd></div>
                <div><dt><code>MEDIFLOW_ICD_WHO_CLIENT_ID</code> / <code>MEDIFLOW_ICD_WHO_CLIENT_SECRET</code></dt><dd>Credenziali ufficiali, conservate esclusivamente sul server.</dd></div>
            </dl>
        </details>
    </section>;
}
