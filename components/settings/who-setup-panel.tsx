'use client';

/* @Codex WUL-672: local Search only; provisioning and activation are host-owned. */
import { useEffect, useMemo, useState } from 'react';
import { createICDReferenceDataClient, icdClientErrorMessage, icdReadinessMessage, type ICDReadiness, type ICDSearchReceipt } from '@/lib/icd-service';
import { SETTINGS_CARD_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from './settings-ui';
import { WhoLocalSetupGuide } from './who-local-setup-guide';
import { WhoCodeCheckForm } from '@/components/who-code-check';

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
        {probe.kind === 'done' && <p className="mt-3 text-sm" role="status">{probe.receipt.source === 'live' ? ('deployment' in probe.receipt ? 'Risposta dal servizio WHO locale' : 'Risposta WHO ricevuta') : 'Risposta dalla cache: non verifica il servizio corrente'} · {probe.receipt.resultCount} risultati · <time dateTime={probe.receipt.completedAt}>{new Date(probe.receipt.completedAt).toLocaleString('it-IT')}</time>.</p>}
        {state.kind === 'ready' && 'deployment' in state.readiness && <p className="mt-2 text-xs">
            Modalità locale · {state.readiness.lastLiveObservedAt
                ? <>Ultima risposta diretta: <time dateTime={state.readiness.lastLiveObservedAt}>{new Date(state.readiness.lastLiveObservedAt).toLocaleString('it-IT')}</time>.</>
                : 'Nessuna risposta diretta ancora osservata.'}
        </p>}
        {probe.kind === 'error' && <p className="mt-3 text-sm" role="alert">Verifica non riuscita: {probe.message} <time dateTime={probe.at}>{new Date(probe.at).toLocaleTimeString('it-IT')}</time></p>}
        <WhoCodeCheckForm />
        <WhoLocalSetupGuide status={state.kind === 'ready' ? state.readiness.status : state.kind} onRefresh={() => { setState({ kind: 'loading' }); setRefresh(value => value + 1); }} />
        <details className="mt-5 text-sm">
            <summary className="cursor-pointer font-medium">Per chi gestisce il server</summary>
            <p className="mt-3 leading-6">Il setup host conserva manifesto, consenso, snapshot e prove nella cartella privata MediFlow/WHO. Non espone Docker al Web. Per controllare o riprendere le verifiche del solo servizio creato dalla procedura:</p>
            <pre className="mt-3 whitespace-pre-wrap break-all text-xs leading-5"><code>{'node scripts/who-local-onboarding.mjs status\nnode scripts/who-local-onboarding.mjs qualify'}</code></pre>
            <p className="mt-3 leading-6">La procedura completa è in docs/icd-who-setup.md. La CLI tecnica precedente resta disponibile per deployment gestiti separatamente; le prove di un altro deployment non si ereditano.</p>
            <dl className="mt-4 space-y-2 break-words text-xs">
                <div><dt><code>MEDIFLOW_ICD_WHO_ENABLED</code></dt><dd>1, soltanto quando vuoi abilitare il servizio.</dd></div>
                <div><dt><code>MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST</code></dt><dd>Digest verificato dell’immagine; non viene scaricata da questa pagina.</dd></div>
                <div><dt><code>MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID</code></dt><dd>Impronta dello snapshot installato; nessun valore è precompilato.</dd></div>
            </dl>
        </details>
    </section>;
}
