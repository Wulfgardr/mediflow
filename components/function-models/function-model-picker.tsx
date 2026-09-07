'use client';
/* @Codex */
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { useSecurity } from '@/components/security-provider';
import { createModelPreviewClient } from '@/lib/function-models/preview-client';
import { providerName, type FunctionModelId } from '@/lib/function-models/browser';
import { SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import styles from './model-picker.module.css';
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
    const canGenerate = active && !view.blocked && !view.loading && !view.consumed && (!row || (row.enabled && (view.choice !== null || row.bindingState === 'current') && selected?.state === 'available_unqualified'));
    return { client, view, active, functionId, canGenerate };
}
export function FunctionModelPicker({ picker }: { picker: ReturnType<typeof useFunctionModelPicker> }) {
    const { client, view, active, functionId } = picker;
    const f = view.dto?.functions.find(f => f.id === functionId);
    const defaultModel = f?.options.find(o => o.modelOptionId === f.defaultModelOptionId);
    const selected = f?.options.find(o => o.modelOptionId === (view.choice?.modelOptionId ?? f.defaultModelOptionId));
    const blockingStatus = !active ? 'Sblocca MediFlow per scegliere il modello.' : f && !f.enabled ? 'Esperienza spenta nelle impostazioni.'
        : f?.options.length === 0 ? 'Nessun modello configurato.' : f && f.bindingState !== 'current' && !view.choice ? 'Predefinito non attuale: scegli un modello disponibile.'
        : f && selected?.state !== 'available_unqualified' ? 'Modello locale non disponibile.' : null;
    const confirmDefault = (view.blocked || view.consumed) && !!f?.enabled && f.bindingState === 'current' && defaultModel?.state === 'available_unqualified';
    const needsRefresh = !!view.error || (active && !!blockingStatus) || (view.blocked && !confirmDefault);
    return <div className={styles.picker} data-testid={`model-picker-${functionId}`}>
        <div className={styles.pickerRow}>
            <select title={selected?.label} aria-label="Modello per questa proposta" value={view.choice?.modelOptionId ?? ''}
                disabled={!active || view.loading || (!!f && !f.enabled)}
                onFocus={() => { if (!f && !view.loading && !view.error) void client.read(); }}
                onChange={e => client.choose(e.target.value)}>
                <option value="">{view.loading ? 'Lettura modelli…' : defaultModel ? `Predefinito · ${defaultModel.label}` : f ? 'Predefinito non disponibile' : 'Modello predefinito · scegli'}</option>
                {f?.options.map(o => <option key={o.modelOptionId} value={o.modelOptionId} disabled={o.state !== 'available_unqualified'}>{o.label}{o.modelOptionId !== view.choice?.modelOptionId ? ` · ${providerName(o.provider)}` : ''}{o.state === 'unavailable' ? ' · non disponibile' : ''}</option>)}
            </select>
            {selected && <span className={styles.pickerProvider}>{providerName(selected.provider)}<small>{view.choice ? 'Solo questa proposta' : 'Predefinito'}</small></span>}
            {needsRefresh && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={!active || view.loading} onClick={() => void client.read()}>Rileggi modelli</button>}
            {confirmDefault && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={!active || view.loading} onClick={() => client.choose('')}>Riusa predefinito</button>}
            <details className={styles.pickerDetails}>
            <summary aria-label="Dettagli modello">Dettagli</summary>
            <div className={styles.pickerDetailBody}>
                <p>{selected ? `${selected.label} · ${providerName(selected.provider)}` : 'Il modello viene risolto dalle impostazioni correnti.'}</p>
                <p>{view.choice ? 'Scelta per una sola proposta; non salvata.' : 'Usa il modello predefinito delle impostazioni.'} {view.consumed ? 'Per ripetere, scegli nuovamente o riusa il predefinito.' : ''}</p>
                <p>La configurazione non prova la disponibilità del modello: viene verificata alla richiesta.</p>
                {!needsRefresh && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={!active || view.loading} onClick={() => void client.read()}>Rileggi modelli</button>}
            </div>
            </details>
        </div>
        {blockingStatus && <p role="status" className={styles.hint}>{blockingStatus}</p>}
        {view.error && <p role="alert" className={styles.error}>{view.error}</p>}

    </div>;
}
