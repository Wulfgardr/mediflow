'use client';
/* @Codex */
import { useEffect, useRef, useState } from 'react';
import { FUNCTION_META, FUNCTION_STATE_LABELS } from '@/lib/function-status';
import { createLocalProviderOnboardingWorkflow, INITIAL_LOCAL_ONBOARDING_VIEW } from './local-provider-onboarding-workflow';
import { SETTINGS_CARD_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from './settings-ui';

const messages: Record<string, string> = {
    reading_configuration: 'Lettura della configurazione salvata e dello stato locale. Nessuna attivazione in corso.',
    verifying: 'Verifica locale e possibile caricamento del modello in memoria in corso. La verifica host ha un limite di 30 secondi.',
    reading_result: 'Rilettura dello stato del collegamento prima di mostrare l’esito.',
    reading_functions: 'Lettura delle abilitazioni delle funzioni. Non viene eseguita una generazione.',
    missing: 'Collegamento locale da attivare. Controlla i passaggi preparatori, poi avvia la verifica.',
    available_unqualified: 'Collegamento locale attivo. Le funzioni mantengono le proprie abilitazioni e verifiche.',
    degraded: 'Collegamento da recuperare: controlla Ollama, poi avvia una nuova verifica.',
    revoked: 'Collegamento revocato. Questa pagina non può riattivarlo: rivolgiti all’operatore del computer.',
    configuration_missing: 'Scegli un modello Ollama già installato e salva la configurazione qui sopra, poi aggiorna lo stato.',
    configuration_changed: 'La configurazione o lo stato sono cambiati. Rileggi lo stato prima di confermare una nuova verifica.',
    owner_locked: 'Sessione scaduta o applicazione bloccata. Accedi di nuovo e rileggi lo stato; nessuna operazione riparte automaticamente.',
    provider_unreachable: 'Ollama non è raggiungibile o non è pronto. Apri Ollama, controlla la versione, poi rileggi lo stato prima di riprovare.',
    model_absent_or_not_local: 'Il modello salvato è assente o non verificabile come locale. Scegli un modello già installato, salva e rileggi lo stato.',
    locality_denied: 'La configurazione non identifica un modello locale consentito. Controlla il collegamento Ollama salvato.',
    verification_interrupted: 'Verifica interrotta o scaduta. Controlla che Ollama sia pronto e rileggi lo stato prima di una nuova verifica.',
    request_cancelled: 'Richiesta interrotta. L’interruzione non annulla un’attivazione già conclusa e non garantisce l’arresto del caricamento in Ollama. Riprendi dalla lettura dello stato.',
    request_timed_out: 'Risposta non ricevuta entro il limite di attesa della pagina. L’esito potrebbe essere già stato salvato: rileggi lo stato, senza ripetere automaticamente il comando.',
    provider_busy: 'Un’altra operazione sta aggiornando il collegamento. Rileggi lo stato prima di confermare una nuova verifica.',
    corrupt: 'Lo stato salvato non è leggibile. Rivolgiti all’operatore del computer; non è stato sostituito.',
    model_invalid: 'Il modello salvato non è valido. Scegli un modello locale già installato e salva la configurazione.',
    endpoint_invalid: 'Il collegamento salvato non è locale. Controlla l’indirizzo di Ollama.',
    provider_invalid: 'Salva una configurazione Ollama locale prima di attivare il collegamento.',
    credential_mismatch: 'Lo stato salvato non appartiene a un modello locale. Rivolgiti all’operatore del computer.',
    state_unavailable: 'Stato non disponibile. Rileggi lo stato; se il problema continua, rivolgiti all’operatore del computer.',
    functions_unavailable: 'Collegamento attivo alla rilettura; stato delle funzioni non disponibile. Controllalo nella pagina Funzioni. Non occorre ripetere l’attivazione per questo errore.',
};
const explain = (code: string) => Object.hasOwn(messages, code) ? messages[code] : messages.state_unavailable;

export function LocalProviderOnboardingPanel() {
    const [view, setView] = useState(INITIAL_LOCAL_ONBOARDING_VIEW);
    const workflow = useRef<ReturnType<typeof createLocalProviderOnboardingWorkflow> | null>(null);
    useEffect(() => {
        // One controller per effect lifetime; StrictMode cleanup cannot revive an
        // earlier request or dispose the replacement controller.
        const controller = createLocalProviderOnboardingWorkflow(setView);
        workflow.current = controller;
        void controller.refresh();
        return () => { controller.dispose(); if (workflow.current === controller) workflow.current = null; };
    }, []);
    const { status, functions, phase, busy } = view;
    const needsResume = ['interrupted', 'failed'].includes(phase);
    const canActivate = !busy && !!status?.canActivate && ['ready', 'completed'].includes(phase);
    const readingResult = phase === 'reading_result' || phase === 'reading_functions';
    const steps = [
        { title: 'Configurazione salvata', active: phase === 'reading_configuration',
            detail: phase === 'reading_configuration' ? 'Lettura in corso' : status || phase === 'verifying' || readingResult ? 'Letta per questo tentativo' : 'Da rileggere' },
        { title: 'Verifica locale e caricamento', active: phase === 'verifying',
            detail: phase === 'verifying' ? 'In corso: dettagli interni non disponibili' : readingResult || phase === 'completed' ? 'Comando concluso; esito riletto separatamente' : 'Solo con conferma esplicita' },
        { title: 'Esito e abilitazioni', active: readingResult,
            detail: readingResult ? 'Rilettura in corso' : phase === 'completed' ? functions ? 'Stato e funzioni riletti' : 'Stato riletto; funzioni non disponibili' : 'Da leggere dopo la verifica' },
    ];
    return <section id="local-provider-admission" className={`${SETTINGS_CARD_CLASS} space-y-3`} aria-labelledby="local-onboarding-title">
        <h3 id="local-onboarding-title" className="text-base font-semibold">4. Prepara e attiva il collegamento locale</h3>
        <p>Il percorso verifica il modello Ollama salvato e può caricarlo in memoria. Non scarica modelli e non genera testo.</p>
        <details>
            <summary>Prima di iniziare</summary>
            <ol className="list-decimal space-y-1 pl-5">
                <li>Apri Ollama sul computer che ospita MediFlow: la pagina non avvia né installa il servizio.</li>
                <li>Scegli un modello già installato e salva la configurazione qui sopra.</li>
                <li>Rileggi lo stato, controlla il modello mostrato e conferma la verifica.</li>
            </ol>
            <p>Se il caricamento non termina nel limite della verifica, prepara il modello con gli strumenti dell’host. Poi riprendi dalla lettura dello stato: non sono previsti tentativi automatici.</p>
        </details>
        {status?.model && <p>Modello salvato: <strong>{status.model}</strong></p>}
        <ol aria-label="Fasi del collegamento locale" className="list-decimal space-y-2 pl-5">
            {steps.map(step => <li key={step.title} aria-current={step.active ? 'step' : undefined}>
                <strong>{step.title}</strong><p className="text-sm text-muted-foreground">{step.detail}</p>
            </li>)}
        </ol>
        {/* Outside aria-busy: cancellation and live phase announcements remain accessible. */}
        <p role="status" aria-live="polite" aria-atomic="true">{explain(view.messageCode)}</p>
        <div className="flex flex-wrap gap-3">
            <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={!canActivate}
                onClick={() => void workflow.current?.activate()}>
                {phase === 'verifying' ? 'Verifica in corso…' : status?.state === 'degraded' ? 'Verifica e recupera locale' : 'Verifica e attiva locale'}
            </button>
            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy}
                onClick={() => void workflow.current?.refresh()}>{needsResume ? 'Riprendi dalla lettura dello stato' : 'Aggiorna stato'}</button>
            {busy && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={() => workflow.current?.cancel()}>Annulla operazione</button>}
        </div>
        {needsResume && <p className="text-sm">Riprendere legge soltanto lo stato attuale. Un nuovo comando richiede una conferma separata.</p>}
        {status?.receipt && !busy && <details><summary>Ricevuta del collegamento · versione {status.version}</summary><code className="break-all">{status.receipt}</code></details>}
        {functions && <div className="space-y-2">
            <p>Stato delle funzioni riletto. <a href="/settings/ai/funzioni" className="underline">Apri Funzioni</a> per controllarne le abilitazioni.</p>
            <ul className="space-y-2">{functions.functions.filter(row => row.provider === 'Ollama').map(row => <li key={row.id}>
                <strong>{FUNCTION_META[row.id].title}: {FUNCTION_STATE_LABELS[row.state]}</strong><p>{row.reason}</p>
            </li>)}</ul>
        </div>}
        <p className="text-sm text-muted-foreground">L’attivazione non prova una generazione riuscita né l’idoneità clinica del modello. Ogni proposta richiede revisione.</p>
    </section>;
}
