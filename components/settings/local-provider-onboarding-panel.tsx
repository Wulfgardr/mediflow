'use client';
/* @Codex */
import { useEffect, useRef, useState } from 'react';
import { FUNCTION_META, FUNCTION_STATE_LABELS, type FunctionStatusSnapshot } from '@/lib/function-status';
import type { LocalProviderOnboardingStatus } from '@/lib/ai-providers/fabric/local-provider-onboarding-service';
import { SETTINGS_CARD_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from './settings-ui';

const messages: Record<string, string> = {
    missing: 'Collegamento locale da attivare.',
    available_unqualified: 'Collegamento locale attivo. Le funzioni mantengono le proprie abilitazioni e verifiche.',
    degraded: 'Collegamento da recuperare: verifica di nuovo Ollama.',
    revoked: 'Collegamento revocato. Questa pagina non può riattivarlo: rivolgiti all’operatore del computer.',
    configuration_missing: 'Scegli un modello Ollama già installato e salva la configurazione qui sopra, poi aggiorna lo stato.',
    configuration_changed: 'La configurazione o lo stato sono cambiati. Aggiorna lo stato e verifica di nuovo.',
    owner_locked: 'Sessione scaduta o applicazione bloccata. Accedi di nuovo prima di verificare.',
    provider_unreachable: 'Ollama non è raggiungibile o non è pronto. Apri Ollama, controlla la versione e riprova.',
    model_absent_or_not_local: 'Il modello salvato è assente o non verificabile come locale. Scegli un modello già installato, salva e riprova.',
    locality_denied: 'La configurazione non identifica un modello locale consentito. Controlla il collegamento Ollama salvato.',
    verification_interrupted: 'Verifica interrotta o scaduta. Controlla che Ollama sia pronto e che la sessione sia attiva, poi riprova.',
    provider_busy: 'Un’altra operazione sta aggiornando il collegamento. Aggiorna lo stato tra poco.',
    corrupt: 'Lo stato salvato non è leggibile. Rivolgiti all’operatore del computer; non è stato sostituito.',
    model_invalid: 'Il modello salvato non è valido. Scegli un modello locale già installato e salva la configurazione.',
    endpoint_invalid: 'Il collegamento salvato non è locale. Controlla l’indirizzo di Ollama.',
    provider_invalid: 'Salva una configurazione Ollama locale prima di attivare il collegamento.',
    credential_mismatch: 'Lo stato salvato non appartiene a un modello locale. Rivolgiti all’operatore del computer.',
    state_unavailable: 'Stato non disponibile. Aggiorna lo stato; se il problema continua, rivolgiti all’operatore del computer.',
};
const explain = (code: string) => messages[code] ?? messages.state_unavailable;
const endpoint = '/api/ai/local-provider/onboarding';

export function LocalProviderOnboardingPanel() {
    const [status, setStatus] = useState<LocalProviderOnboardingStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('Lettura dello stato locale…');
    const [functionsRead, setFunctionsRead] = useState<FunctionStatusSnapshot | null>(null);
    const mounted = useRef(true);
    const inFlight = useRef(false);
    async function readStatus() {
        const response = await fetch(endpoint, { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'state_unavailable');
        if (mounted.current) { setStatus(body); setMessage(explain(body.state)); }
        return body as LocalProviderOnboardingStatus;
    }
    useEffect(() => {
        mounted.current = true;
        void readStatus().catch(error => { if (mounted.current) setMessage(explain(error.message)); });
        return () => { mounted.current = false; };
    }, []);
    async function run(activate: boolean) {
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true); setFunctionsRead(null);
        try {
            if (activate && status) {
                setMessage('Verifica e caricamento del modello in corso… Attendi fino a 30 secondi.');
                const response = await fetch(endpoint, { method: 'POST', cache: 'no-store',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ intent: 'verify_and_activate', expectedRevision: status.revision }) });
                const body = await response.json();
                if (!response.ok) throw new Error(body.error ?? 'state_unavailable');
            }
            await readStatus();
            if (activate) {
                const response = await fetch('/api/system/function-status', { cache: 'no-store' });
                if (response.ok) {
                    const functions = await response.json();
                    if (mounted.current) setFunctionsRead(functions);
                } else if (mounted.current) setMessage('Collegamento attivato; stato delle funzioni non disponibile. Aggiornalo nella pagina Funzioni.');
            }
        } catch (error) {
            if (mounted.current) {
                const code = error instanceof Error ? error.message : 'state_unavailable';
                if (!['provider_unreachable', 'model_absent_or_not_local', 'verification_interrupted', 'provider_busy'].includes(code)) setStatus(null);
                setMessage(explain(code));
            }
        } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
    }
    return <section id="local-provider-admission" className={`${SETTINGS_CARD_CLASS} space-y-3`} aria-labelledby="local-onboarding-title" aria-busy={busy}>
        <h3 id="local-onboarding-title" className="text-base font-semibold">4. Attiva il collegamento locale</h3>
        <p>Verifica il modello Ollama salvato e autorizza il collegamento con MediFlow. Il modello può essere caricato in memoria: non viene scaricato e non viene generato testo.</p>
        {status?.model && <p>Modello salvato: <strong>{status.model}</strong></p>}
        <p role="status" aria-live="polite">{message}</p>
        <div className="flex flex-wrap gap-3">
            <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy || !status?.canActivate} onClick={() => void run(true)}>
                {busy ? 'Verifica in corso…' : status?.state === 'degraded' ? 'Verifica e recupera locale' : 'Verifica e attiva locale'}
            </button>
            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => void run(false)}>Aggiorna stato</button>
        </div>
        {status?.receipt && <details><summary>Ricevuta di attivazione · versione {status.version}</summary><code className="break-all">{status.receipt}</code></details>}
        {functionsRead && <div className="space-y-2">
            <p>Stato delle funzioni riletto. <a href="/settings/ai/funzioni" className="underline">Apri Funzioni</a> per controllarne le abilitazioni.</p>
            <ul className="space-y-2">{functionsRead.functions.filter(row => row.provider === 'Ollama').map(row => <li key={row.id}>
                <strong>{FUNCTION_META[row.id].title}: {FUNCTION_STATE_LABELS[row.state]}</strong><p>{row.reason}</p>
            </li>)}</ul>
        </div>}
        <p className="text-sm text-muted-foreground">L’attivazione non prova una generazione riuscita né l’idoneità clinica del modello. Ogni proposta richiede revisione.</p>
    </section>;
}
