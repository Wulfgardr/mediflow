'use client';
/* @Codex: presets are proposals; only a second explicit gesture persists settings. */
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { notifyDbChange } from '@/lib/live-query';
import { useSecurity } from '@/components/security-provider';
import { createPreferencesClient, names, providerName, type FunctionModelPreferences } from '@/lib/function-models/browser';
import { parseAccountBrowserStatus } from '@/lib/chatgpt-account/account-browser';
import type { AccountStatus } from '@/lib/chatgpt-account/account-contract';
import { SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import styles from './model-picker.module.css';
import { TreatmentReasoningPortableSetup } from '../treatment-reasoning-portable-setup';
type FunctionRow = FunctionModelPreferences['functions'][number];
function Description({ row }: { row: FunctionRow }) {
    const model = row.options.find(o => o.modelOptionId === row.defaultModelOptionId);
    return <p>{names[row.id]}: {row.enabled ? 'attivo' : 'spento'} · {model ? `${model.label} · ${providerName(model.provider)}` : 'modello non disponibile'}{row.defaultSource === 'host_configuration' ? ' · modello del computer' : ' · preferenza salvata'}</p>;
}
function PreferenceCard({ row, disabled, account, preview }: { row: FunctionRow; disabled: boolean; account: AccountStatus | null; preview: (enabled: boolean, id: string | null) => void }) {
    const [enabled, setEnabled] = useState(row.enabled);
    const [model, setModel] = useState<string | null>(row.defaultSource === 'host_configuration' ? null : row.defaultModelOptionId);
    const selected = model === null && row.defaultSource !== 'host_configuration' ? undefined : row.options.find(o => o.modelOptionId === (model ?? row.defaultModelOptionId));
    const computerDefault = row.defaultSource === 'host_configuration' ? row.options.find(o => o.modelOptionId === row.defaultModelOptionId) : undefined;
    const warning = model === null && row.defaultSource !== 'host_configuration' ? 'Il modello del computer sarà indicato nell’anteprima.' : row.bindingState === 'stale' ? 'Scelta salvata scaduta: serve una nuova decisione.' : row.bindingState === 'unsupported' ? 'Predefinito non disponibile.' : selected?.state === 'available_unqualified' ? '' : 'Provider locale non disponibile';
    return <article className={styles.card}>
        <div className={styles.row}><h3>{names[row.id]}</h3><span>{row.enabled ? 'Attivo' : 'Spento'}</span></div>
        {warning && <p className={styles.hint}>{warning}</p>}
        <label>Modello predefinito
            <select aria-label={`Modello predefinito · ${names[row.id]}`} value={model ?? ''} disabled={disabled} onChange={e => setModel(e.target.value || null)}>
                <option value="">{computerDefault ? `${computerDefault.label} · ${providerName(computerDefault.provider)} · predefinito` : 'Predefinito del computer'}</option>
                {row.defaultSource === 'saved_preference' && !row.options.some(o => o.modelOptionId === model) && model && <option value={model} disabled>Preferenza non più disponibile</option>}
                {row.options.map(o => <option key={o.modelOptionId} value={o.modelOptionId} disabled={enabled && o.state === 'unavailable'}>{o.label} · {providerName(o.provider)}{o.state === 'unavailable' ? ' · non disponibile' : ''}</option>)}
            </select>
        </label>
        {row.id === 'treatment_reasoning' && <TreatmentReasoningPortableSetup option={row.options.find(o => o.provider === 'athena_transformers')} />}
        {!selected && model !== null && <p>Nessun modello selezionabile</p>}
        <div className={styles.actions}><button type="button" role="switch" aria-checked={enabled} aria-label={`${names[row.id]} nella proposta`} className={`${SETTINGS_SECONDARY_BUTTON_CLASS} ${styles.switch}`} disabled={disabled} onClick={() => setEnabled(!enabled)}>{enabled ? 'Spegni' : 'Attiva'}</button>
            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={disabled || (enabled && model !== null && selected?.state !== 'available_unqualified')} onClick={() => preview(enabled, model)}>Anteprima modifica</button></div>
        <details><summary>Stato e dettagli</summary><Description row={row} /><p className={styles.hint}>La configurazione non prova la disponibilità del modello: viene verificata alla richiesta.</p><p className={styles.hint}>OpenAI · ChatGPT {account?.state === 'connected' ? 'collegato' : account?.state === 'awaiting_login' || account?.state === 'verifying' ? 'accesso in corso' : account?.state === 'starting' ? 'avvio accesso' : account?.state === 'disconnected' ? 'non collegato' : account?.state === 'error' ? 'errore nel collegamento' : 'stato non disponibile'}. Nessuna opzione di esecuzione ChatGPT abilitata.</p></details>
    </article>;
}
export function FunctionPreferencesContent({ active, onRead, session }: { active: boolean; session?: unknown; onRead?: (dto: FunctionModelPreferences) => void }) {
    const [client] = useState(() => createPreferencesClient());
    const view = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
    const proposalRef = useRef<HTMLDivElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const errorRef = useRef<HTMLParagraphElement>(null);
    const hadProposal = useRef(false);
    const [account, setAccount] = useState<AccountStatus | null>(null);
    useEffect(() => {
        if (view.busy) return;
        if (view.error) errorRef.current?.focus();
        else if (view.proposed) proposalRef.current?.focus();
        else if (hadProposal.current) headingRef.current?.focus();
        hadProposal.current = !!view.proposed;
    }, [view.proposed, view.busy, view.error]);
    useLayoutEffect(() => { client.reset(); if (active) void client.read(); return client.reset; }, [client, active, session]);
    useEffect(() => { if (view.saved) notifyDbChange('settings'); }, [view.saved]);
    const notifyRead = useEffectEvent((dto: FunctionModelPreferences) => onRead?.(dto));
    const deliveredRead = useRef<string | null>(null);
    useEffect(() => {
        if (!view.dto) { deliveredRead.current = null; return; }
        const revision = `${view.dto.revision}:${view.dto.catalogRevision}`;
        if (deliveredRead.current !== revision) { deliveredRead.current = revision; notifyRead(view.dto); }
    }, [view.dto]);
    useEffect(() => {
        if (!active) return;
        let alive = true; let timer: ReturnType<typeof setTimeout>; let controller: AbortController;
        const read = async () => { controller = new AbortController();
            try { const response = await fetch('/api/settings/ai/chatgpt/status', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
                const status = response.ok ? parseAccountBrowserStatus(await response.json()) : null; if (alive) setAccount(status);
            } catch { if (alive) setAccount(null); } finally { if (alive) timer = setTimeout(read, 5000); }
        }; void read(); return () => { alive = false; clearTimeout(timer); controller?.abort(); };
    }, [active, session]);
    useEffect(() => { const hide = () => client.reset(); window.addEventListener('pagehide', hide); return () => window.removeEventListener('pagehide', hide); }, [client]);
    return <section className={styles.panel} aria-label="Modelli e preferenze per esperienza" data-testid="function-preferences">
        <div className={styles.card}>
            <h3 ref={headingRef} tabIndex={-1}>Preferenze per esperienza</h3><p>Scegli i modelli e conferma le modifiche nell’anteprima.</p>
            <div className={styles.actions}>
                {view.dto?.presets.map(preset => <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={view.busy || !!view.proposed || !active} key={preset} onClick={() => void client.preview({ action: 'preset', presetId: preset })}>{preset === 'host_defaults' ? 'Ripristina predefiniti' : 'Spegni tutte'}</button>)}
                <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={!active || view.busy} onClick={() => void client.read()}>Rileggi impostazioni</button>
            </div>
            <p className={styles.hint}>Ripristina predefiniti usa i modelli del computer senza cambiare gli interruttori. Spegni tutte conserva i modelli. I preset hardware restano separati.</p>
            {!active && <p>Sblocca MediFlow per gestire le preferenze.</p>}
            {view.busy && <p role="status">Verifica impostazioni…</p>}
            {view.error && <p ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>{view.error}</p>}
            {active && view.saved && <p role="status">Impostazioni salvate e rilette. Nessuna modifica clinica.</p>}
        </div>
        {active && view.proposed && <div ref={proposalRef} tabIndex={-1} className={styles.card} role="region" aria-label="Anteprima impostazioni">
            <h3>Anteprima · non ancora applicata</h3>
            {view.proposed.functions.map(row => <Description key={row.id} row={row} />)}
            <div className={styles.actions}><button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={view.busy} onClick={() => void client.apply()}>Applica alle impostazioni</button><button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={view.busy} onClick={client.cancel}>Annulla proposta</button></div>
        </div>}
        {active && view.dto && <div className={styles.grid}>{view.dto.functions.map(row => <PreferenceCard key={`${view.dto!.revision}:${view.dto!.catalogRevision}:${row.id}`} row={row} account={account} disabled={view.busy || !!view.proposed} preview={(enabled, defaultModelOptionId) => void client.preview({ action: 'set', functionId: row.id, enabled, defaultModelOptionId })} />)}</div>}
    </section>;
}
export function FunctionPreferencesPanel({ onRead }: { onRead?: (dto: FunctionModelPreferences) => void }) {
    const { isAuthenticated, isLocked, authRecoveryState, user } = useSecurity();
    return <FunctionPreferencesContent session={user} active={isAuthenticated && !isLocked && authRecoveryState === 'ready'} onRead={onRead} />;
}
