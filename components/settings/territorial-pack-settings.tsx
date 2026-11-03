'use client';

import { useState } from 'react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { changeTerritorialPreset, refreshTerritorialPacks, useTerritorialPacks } from '@/lib/territorial-pack-client';
import { TERRITORIAL_PACK_PRESETS, type TerritorialPackPreset } from '@/lib/territorial-pack-contract';
import { SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';

const PRESET_LABELS: Record<TerritorialPackPreset, { label: string; detail: string }> = {
    core: { label: 'Nucleo internazionale', detail: 'Cartella clinica, ICD, cataloghi caricati da file. Nessuna funzione regionale.' },
    'core+it': { label: 'Italia', detail: 'Aggiunge codice fiscale, esenzioni e catalogo AIFA.' },
    'core+it+lom': { label: 'Italia e Lombardia', detail: 'Aggiunge SISS e portali regionali, PRREG e protesica con le codifiche lombarde.' },
};

/** Assetto territoriale dell'installazione (ADR 0158, 0177): un'operazione dell'host con conferma esplicita. */
export function TerritorialPackSettings() {
    const confirm = useConfirm();
    const packs = useTerritorialPacks();
    const [choice, setChoice] = useState<TerritorialPackPreset | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const capability = packs.capability;
    const selected = choice ?? capability?.preset ?? 'core';

    async function apply() {
        if (!capability || capability.revision === null || selected === capability.preset) return;
        const turningOff = capability.preset === 'core+it+lom' && selected !== 'core+it+lom';
        const answer = await confirm({
            title: `Passare a «${PRESET_LABELS[selected].label}»?`,
            message: turningOff
                ? 'SISS, portali e PRREG scompaiono dalle schermate e i loro writer si fermano. Lo storico resta conservato e torna visibile riattivando la Lombardia.'
                : 'Le funzioni del pacchetto compaiono nelle schermate. Attivare un pacchetto non concede accesso ai servizi regionali.',
            confirmLabel: 'Cambia assetto', tone: turningOff ? 'danger' : 'default',
        });
        if (!answer.confirmed) return;
        setBusy(true); setMessage('');
        try {
            const next = await changeTerritorialPreset(selected, capability.revision);
            setChoice(null);
            setMessage(`Assetto attivo: ${PRESET_LABELS[next.preset].label}.`);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Cambio non riuscito; assetto invariato.');
            void refreshTerritorialPacks();
        } finally { setBusy(false); }
    }

    if (packs.status === 'loading') return <p className="text-sm">Lettura dell’assetto in corso…</p>;
    if (!capability || capability.status !== 'ready') {
        return <div className="space-y-2 text-sm">
            <p role="alert">Assetto territoriale non leggibile: restano attive solo le funzioni del nucleo.</p>
            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={() => void refreshTerritorialPacks()}>Rileggi</button>
        </div>;
    }
    return <div className="space-y-3 text-sm">
        <fieldset className="space-y-2" disabled={busy}>
            <legend className="sr-only">Assetto territoriale</legend>
            {TERRITORIAL_PACK_PRESETS.map(preset => <label key={preset} className="flex items-start gap-2">
                <input type="radio" name="territorial-preset" value={preset} checked={selected === preset}
                    onChange={() => { setChoice(preset); setMessage(''); }} />
                <span><span className="font-semibold">{PRESET_LABELS[preset].label}</span>
                    {preset === capability.preset ? ' (attivo)' : ''}<br />{PRESET_LABELS[preset].detail}</span>
            </label>)}
        </fieldset>
        <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy || selected === capability.preset} onClick={() => void apply()}>
            {busy ? 'Cambio in corso…' : 'Applica assetto'}
        </button>
        <p role="status" aria-live="polite">{message}</p>
    </div>;
}
