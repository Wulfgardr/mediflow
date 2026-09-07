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
    const selected = f?.options.find(o => o.modelOptionId === (view.choice?.modelOptionId ?? f.defaultModelOptionId));
    return <div className={styles.picker} data-testid={`model-picker-${functionId}`}>
        {!f ? <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={!active || view.loading} onClick={() => void client.read()}>{view.loading ? 'Lettura modelli…' : 'Modello per questa proposta'}</button> : <>
            <label>Modello per questa proposta
                <select aria-label="Modello per questa proposta" value={view.choice?.modelOptionId ?? ''} disabled={!active || view.loading || !f.enabled} onChange={e => client.choose(e.target.value)}>
                    <option value="">Default impostazioni{f.options.find(o => o.modelOptionId === f.defaultModelOptionId) ? ` · ${f.options.find(o => o.modelOptionId === f.defaultModelOptionId)!.label}` : ' · non disponibile'}</option>
                    {f.options.map(o => <option key={o.modelOptionId} value={o.modelOptionId} disabled={o.state !== 'available_unqualified'}>{o.label} · {providerName(o.provider)}{o.state === 'unavailable' ? ' · non disponibile' : ''}</option>)}
                </select>
            </label>
            <p>{view.choice ? 'Solo questa proposta · non salvato' : 'Default delle impostazioni'}{selected ? ` · ${selected.label} · ${providerName(selected.provider)}` : ''}</p>
            <p className={styles.hint}>{!f.enabled ? 'Esperienza spenta nelle impostazioni.' : f.options.length === 0 ? 'Nessun modello configurato.' : f.bindingState !== 'current' && !view.choice ? 'Default non attuale. Scegli un modello disponibile o aggiorna le impostazioni.' : selected?.state !== 'available_unqualified' ? 'Modello locale non disponibile.' : 'Configurazione locale; esecuzione da verificare.'}</p>
            <div className={styles.actions}><button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={view.loading || !active} onClick={() => void client.read()}>Rileggi modelli</button>
                {(view.blocked || view.consumed) && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={!active || view.loading || !f.enabled || f.bindingState !== 'current' || f.options.find(o => o.modelOptionId === f.defaultModelOptionId)?.state !== 'available_unqualified'} onClick={() => client.choose('')}>Conferma il default attuale</button>}</div>
        </>}
        {view.consumed && <p>Scelta usata per questa proposta. Scegli di nuovo o conferma il default prima di ripetere.</p>}
        {view.error && <p role="alert" className={styles.error}>{view.error}</p>}
    </div>;
}
