'use client';
import { Disclosure } from '@/components/disclosure';
import { ChoiceField } from '@/components/choice-field';
import { isAiLaneEnabledValue } from '@/lib/ai-lane-kill-switch';
import type { OrdinaryBrowserView } from '@/lib/function-models/ordinary-browser';
import { useEffect, useId, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { useSecurity } from '@/components/security-provider';
import { createModelPreviewClient } from '@/lib/function-models/preview-client';
import { providerName, type FunctionModelId } from '@/lib/function-models/browser';
import { SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import styles from './model-picker.module.css';
import { TreatmentReasoningPortableSetup } from '../treatment-reasoning-portable-setup';
export function useFunctionModelPicker(functionId: FunctionModelId, context: unknown, selection?: unknown, enabled = true) {
    const security = useSecurity();
    const active = enabled && security.isAuthenticated && !security.isLocked && security.authRecoveryState === 'ready';
    const [client] = useState(() => createModelPreviewClient(functionId));
    const view = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
    useLayoutEffect(() => { client.reset(active); return () => client.reset(false); }, [client, active, context, selection, security.user]);
    useEffect(() => { const hide = () => client.reset(false); const show = () => client.reset(active);
        window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
        return () => { window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); }; }, [client, active]);
    const row = view.dto?.functions.find(f => f.id === functionId);
    const selected = row?.options.find(o => o.modelOptionId === (view.choice?.modelOptionId ?? row.defaultModelOptionId));
    const canGenerate = view.remote ? active && !view.consumed && !view.remote.loading && !view.remote.completed && view.remote.settings?.enabled === true && isAiLaneEnabledValue(view.remote.settings.lanes[functionId]) : active && !view.blocked && !view.loading && !view.consumed && (!row || (row.enabled && (view.choice !== null || row.bindingState === 'current') && selected?.state === 'available_unqualified'));
    return { client, view, active, functionId, canGenerate, selected };
}
export function FunctionModelPicker({ picker }: { picker: ReturnType<typeof useFunctionModelPicker> }) {
    const { client, view, active, functionId } = picker;
    const [editing, setEditing] = useState(false);
    const fieldId = useId();
    const f = view.dto?.functions.find(f => f.id === functionId);
    const defaultModel = f?.options.find(o => o.modelOptionId === f.defaultModelOptionId);
    const selected = f?.options.find(o => o.modelOptionId === (view.choice?.modelOptionId ?? f.defaultModelOptionId));
    const blockingStatus = view.remote ? (!active ? 'Sblocca MediFlow.' : !view.remote.settings?.enabled ? 'Consenti OpenAI esplicitamente prima di preparare il contesto.' : 'Account collegato, catalogo disponibile e funzione pronta sono verifiche distinte per ogni tentativo.') : !active ? 'Sblocca MediFlow per scegliere il modello.' : f && !f.enabled ? 'Esperienza spenta nelle impostazioni.'
        : view.loading ? 'Lettura modelli in corso…' : f?.options.length === 0 ? 'Nessun modello configurato.' : f && f.bindingState !== 'current' && !view.choice ? 'Predefinito non attuale: scegli un modello disponibile.'
        : f && selected?.state !== 'available_unqualified' ? 'Modello locale non disponibile.' : null;
    const confirmDefault = (view.blocked || view.consumed) && !!f?.enabled && f.bindingState === 'current' && defaultModel?.state === 'available_unqualified';
    const needsRefresh = !!view.error || (active && !!blockingStatus) || (view.blocked && !confirmDefault);
    const recoveryStatus = blockingStatus ?? (needsRefresh && !view.error ? 'Rileggi i modelli prima di preparare la proposta.' : null);
    if (f && !f.enabled && !view.remote) return <div className={styles.picker} data-testid={`model-picker-${functionId}`}>
        <p role="status">Esperienza spenta nelle impostazioni. <a href="/settings/ai/funzioni">Apri le funzioni cliniche</a></p>
    </div>;
    return <div className={styles.picker} data-testid={`model-picker-${functionId}`}>
        <div className={styles.summary}>
            <span>Modello: {view.remote ? 'OpenAI · abbonamento ChatGPT' : view.choice ? selected?.label ?? 'scelta non attuale' : 'predefinito'}</span>
            <span aria-hidden="true">·</span>
            <button type="button" className="mf-button-text" aria-expanded={editing} aria-controls={`${fieldId}-editor`}
                disabled={!active || view.loading} aria-describedby={blockingStatus ? `${fieldId}-status` : undefined}
                onClick={() => { setEditing(!editing); if (!editing && !view.remote && !f && !view.loading && !view.error) void client.read(); }}>Cambia</button>
        </div>
        <div id={`${fieldId}-editor`} hidden={!editing}>
        <div className={styles.pickerRow}>
            <ChoiceField label="Modello per questa proposta" value={view.remote ? 'chatgpt_subscription' : view.choice?.modelOptionId ?? ''}
                disabled={!active || view.loading || (!!f && !f.enabled)}
                aria-invalid={view.error ? true : undefined}
                aria-describedby={[blockingStatus && `${fieldId}-status`, view.error && `${fieldId}-error`].filter(Boolean).join(' ') || undefined}
                onFocus={() => { if (!view.remote && !f && !view.loading && !view.error) void client.read(); }}
                onChange={e => e.target.value === 'chatgpt_subscription' ? client.chooseRemote() : client.choose(e.target.value)}>
                <option value="">{view.loading ? 'Lettura modelli…' : defaultModel ? `Predefinito · ${defaultModel.label}${defaultModel.state === 'unavailable' ? ' · non disponibile' : ''}` : f ? 'Predefinito non disponibile' : 'Modello predefinito · scegli'}</option>
                <option value="chatgpt_subscription">OpenAI · abbonamento ChatGPT · prepara</option>
                {f?.options.map(o => <option key={o.modelOptionId} value={o.modelOptionId} disabled={o.state !== 'available_unqualified'}>{o.label}{o.modelOptionId !== view.choice?.modelOptionId ? ` · ${providerName(o.provider)}` : ''}{o.state === 'unavailable' ? ' · non disponibile' : ''}</option>)}
            </ChoiceField>
            {selected && <span className={styles.pickerProvider}>{providerName(selected.provider)}<small>{view.choice ? 'Solo questa proposta' : 'Predefinito'}</small></span>}
        </div>
        </div>
        {(recoveryStatus || view.error || confirmDefault) && <div className={styles.pickerRow}>
            {recoveryStatus && <p id={`${fieldId}-status`} role="status" className={styles.hint}>{recoveryStatus}</p>}
            {view.error && <p id={`${fieldId}-error`} role="alert" className={styles.error}>{view.error}</p>}
            {confirmDefault && !view.error && <p id={`${fieldId}-recovery`} role="status" className={styles.hint}>
                {view.consumed ? 'Proposta già preparata. Per ripetere, scegli nuovamente o riusa il predefinito.' : 'Conferma nuovamente il modello prima di preparare la proposta.'}
            </p>}
            {needsRefresh && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={!active || view.loading}
                aria-describedby={`${fieldId}-${view.error ? 'error' : 'status'}`} onClick={() => void client.read()}>Rileggi modelli</button>}
            {confirmDefault && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={!active || view.loading}
                aria-describedby={`${fieldId}-${view.error ? 'error' : 'recovery'}`} onClick={() => client.choose('')}>Riusa predefinito</button>}
        </div>}
            <Disclosure label="Dettagli modello" className={styles.pickerDetails} title="Dettagli">
            <div className={styles.pickerDetailBody}>
                <p>{selected ? `${selected.label} · ${providerName(selected.provider)}` : 'Il modello viene risolto dalle impostazioni correnti.'}</p>
                <p>{view.choice ? 'Scelta per una sola proposta; non salvata.' : 'Usa il modello predefinito delle impostazioni.'} {view.consumed ? 'Per ripetere, scegli nuovamente o riusa il predefinito.' : ''}</p>
                <p>La configurazione non prova la disponibilità del modello: viene verificata alla richiesta.</p>
                {!needsRefresh && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={!active || view.loading} onClick={() => void client.read()}>Rileggi modelli</button>}
            </div>
            </Disclosure>
        {view.remote && <OrdinaryFunctionControls client={client} view={view.remote} />}
        {!view.remote && functionId === 'treatment_reasoning' && <TreatmentReasoningPortableSetup option={selected?.provider === 'athena_transformers' ? selected : f?.options.find(o => o.provider === 'athena_transformers')} />}

    </div>;
}

/** The same picker owns the interaction; proposals return to the original card. */
function OrdinaryFunctionControls({ client, view }: { client: ReturnType<typeof createModelPreviewClient>; view: OrdinaryBrowserView }) {
    const phase = view.state?.phase;
    return <fieldset aria-label="OpenAI per questa proposta" style={{ border: 0, padding: 0 }}>
        {view.loading && <p role="status">Verifica in corso…</p>}
        {view.state?.quota && <p role="status">{view.state.quota.includedUsage === 'exhausted'
            ? 'Quota inclusa esaurita; crediti potenzialmente disponibili.' : 'Quota inclusa osservata disponibile.'} Il singolo tentativo richiede il tuo gesto e resta soggetto alla verifica di OpenAI; non garantisce accesso o disponibilità.</p>}
        {!view.state && !view.completed && <>
            <p>Il contesto scelto viene minimizzato e redatto sul computer host. OpenAI riceve il testo redatto solo dopo il consenso. Restano applicabili le condizioni e la conservazione del servizio ChatGPT; non è garantita conservazione zero.</p>
            {view.settings && <label><input type="checkbox" disabled={view.loading} checked={view.settings.enabled} onChange={e => void client.remote.policy(e.target.checked)} /> Consenti OpenAI su questo host (disattivato per default)</label>}
            <button type="button" disabled={view.loading} onClick={() => void client.remote.read()}>Rileggi configurazione OpenAI</button>
            {view.settings?.enabled && <p>Usa l’azione di proposta della funzione per preparare questo contesto. Nessun accesso o invio automatico.</p>}
        </>}
        {phase === 'needs_consent' && view.disclosure && <>
            <p>Contesto preparato e redatto: {view.disclosure.payloadBytes} byte. Questa proposta non modifica la cartella.</p>
            <Disclosure title="Identità del contesto preparato"><code style={{ overflowWrap: 'anywhere' }}>{view.disclosure.payloadSha256}</code></Disclosure>
            <button type="button" disabled={view.loading} onClick={() => void client.remote.action('consent')}>Consenti per questo contesto</button>
        </>}
        {phase === 'consented' && <button type="button" disabled={view.loading} onClick={() => void client.remote.action('login/start')}>Avvia accesso dedicato ChatGPT</button>}
        {phase === 'awaiting_login' && view.challenge && <>
            <p>Completa l’accesso sulla pagina ufficiale con il codice <strong>{view.challenge.userCode}</strong>.</p>
            <a href={view.challenge.verificationUrl} target="_blank" rel="noopener noreferrer">Apri accesso ufficiale</a>
            <button type="button" disabled={view.loading} onClick={() => void client.remote.action('login/complete')}>Ho completato: verifica accesso</button>
        </>}
        {phase === 'connected' && <button type="button" disabled={view.loading} onClick={() => void client.remote.action('models')}>Leggi catalogo di questo processo</button>}
        {phase === 'ready' && view.catalog && <>
            <ChoiceField label="Modello e ragionamento correnti" disabled={view.loading} disabledReason="Verifica in corso…" value={view.choice} onChange={e => client.remote.choose(e.target.value)}>
                <option value="">Scegli modello ed effort</option>
                {view.catalog.choices.map(choice => <option key={choice.optionId} value={choice.optionId}>{choice.model} · {choice.effort}</option>)}
            </ChoiceField>
            <button type="button" disabled={view.loading || !view.choice} onClick={() => void client.remote.action('generate')}>Genera questa proposta</button>
            <button type="button" disabled={view.loading || !view.choice} onClick={() => void client.remote.action('preference')}>Salva modello ed effort preferiti</button>
            <p>La preferenza non conserva accesso, consenso o disponibilità del modello.</p>
        </>}
        {(view.state || view.loading) && <button type="button" onClick={() => client.cancel()}>Annulla e chiudi preparazione</button>}
        {view.completed && <p>Risultato restituito alla funzione. Il processo è chiuso: una nuova proposta richiede nuova preparazione.</p>}
        {view.error && <p role="alert">{view.error}</p>}
    </fieldset>;
}
