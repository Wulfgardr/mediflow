'use client';

import { useState } from 'react';
import { parseRecoveryKit, type RecoveryKit } from '@/lib/recovery-backup';
export type { RecoveryKit } from '@/lib/recovery-backup';
import { checkPassphrase } from '@/lib/security/unlock-credential';
import { SETTINGS_CARD_CLASS, SETTINGS_INPUT_CLASS, SETTINGS_LABEL_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from './settings/settings-ui';

export type PreparedRecoveryKit = { kit: RecoveryKit; recoveryKey: string };
export type AccessResult = { ok: true } | { ok: false; message: string };

export function RecoveryKitPanel({ prepared, onCommit, onCancel }: {
    prepared: PreparedRecoveryKit; onCommit: () => Promise<AccessResult>; onCancel: () => void;
}) {
    const [saved, setSaved] = useState(false);
    const [paper, setPaper] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const download = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(prepared.kit, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'mediflow-recovery-kit.json'; link.click();
        URL.revokeObjectURL(url); setSaved(true);
    };
    return <section className={`${SETTINGS_CARD_CLASS} space-y-4`} aria-labelledby="recovery-kit-title" data-testid="recovery-kit">
        <h1 id="recovery-kit-title" className="text-lg font-semibold">Conserva il nuovo kit prima di continuare</h1>
        <p>Scarica il kit e scrivi questa chiave su carta. Conservali separatamente: insieme permettono di recuperare l’archivio. La chiave non è inclusa nel file.</p>
        <output className="block break-all type-code" aria-label="Chiave di recupero">{prepared.recoveryKey}</output>
        <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={download}>Scarica kit di recupero</button>
        <label className="mf-choice-target gap-2"><input type="checkbox" checked={paper} disabled={busy} onChange={e => setPaper(e.target.checked)} />Ho salvato il kit e scritto la chiave su carta; li conserverò separati.</label>
        <p className="text-sm">La nuova credenziale non è ancora attiva. Backup e copie Time Machine precedenti non vengono ripuliti: possono conservare vecchi dati e credenziali. Questa operazione non sostituisce un backup.</p>
        {error && <p role="alert">{error}</p>}
        <div className="flex flex-wrap gap-3">
            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={onCancel}>Annulla</button>
            <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={!saved || !paper || busy} onClick={async () => {
                setBusy(true); setError('');
                try { const result = await onCommit(); if (!result.ok) setError(result.message); }
                finally { setBusy(false); }
            }}>{busy ? 'Attendi…' : 'Attiva la nuova passphrase'}</button>
        </div>
    </section>;
}

/** Shared input for change, adoption and recovery; no secret is persisted or sent here. */
export function PassphraseAccessForm({ mode, onPrepare }: {
    mode: 'adopt' | 'change' | 'recover';
    onPrepare: (secret: string, passphrase: string, kit?: RecoveryKit) => Promise<AccessResult>;
}) {
    const [secret, setSecret] = useState('');
    const [passphrase, setPassphrase] = useState('');
    const [confirm, setConfirm] = useState('');
    const [kit, setKit] = useState<RecoveryKit>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const matched = passphrase.normalize('NFKC') === confirm.normalize('NFKC');
    const prefix = `access-${mode}`;
    return <form className="space-y-4" onSubmit={async e => {
        e.preventDefault(); if (busy || !secret || !checkPassphrase(passphrase).ok || !matched || (mode === 'recover' && !kit)) return;
        setBusy(true); setError('');
        try { const result = await onPrepare(secret, passphrase, kit); if (!result.ok) setError(result.message); else { setSecret(''); setPassphrase(''); setConfirm(''); } }
        catch { setError('Preparazione non riuscita. Rinnova l’accesso e riprova.'); }
        finally { setBusy(false); }
    }}>
        {mode === 'recover' && <div><label className={SETTINGS_LABEL_CLASS} htmlFor={`${prefix}-kit`}>Kit di recupero</label>
            <input id={`${prefix}-kit`} type="file" accept="application/json,.json" disabled={busy} onChange={async e => {
                setKit(undefined); setError(''); const input = e.currentTarget; const file = input.files?.[0]; if (!file) return;
                try {
                    if (file.size > 4096) throw new Error();
                    const value = parseRecoveryKit(await file.text());
                    if (input.files?.[0] === file) setKit(value);
                } catch { if (input.files?.[0] === file) setError('Kit di recupero non valido.'); }
            }} /></div>}
        <div><label className={SETTINGS_LABEL_CLASS} htmlFor={`${prefix}-secret`}>{mode === 'recover' ? 'Chiave di recupero' : mode === 'adopt' ? 'PIN attuale' : 'Passphrase attuale'}</label>
            <input id={`${prefix}-secret`} className={SETTINGS_INPUT_CLASS} type="password" autoComplete="off" spellCheck={false} value={secret} disabled={busy} onChange={e => setSecret(e.target.value)} /></div>
        <p className="text-sm">Nuova passphrase: da 15 a 128 caratteri, anche spazi. I caratteri equivalenti sono normalizzati; gli spazi non vengono rimossi.</p>
        <div><label className={SETTINGS_LABEL_CLASS} htmlFor={`${prefix}-new`}>Nuova passphrase</label>
            <input id={`${prefix}-new`} className={SETTINGS_INPUT_CLASS} type="password" autoComplete="new-password" spellCheck={false} value={passphrase} disabled={busy} onChange={e => setPassphrase(e.target.value)} /></div>
        <div><label className={SETTINGS_LABEL_CLASS} htmlFor={`${prefix}-confirm`}>Conferma nuova passphrase</label>
            <input id={`${prefix}-confirm`} className={SETTINGS_INPUT_CLASS} type="password" autoComplete="new-password" spellCheck={false} value={confirm} disabled={busy} onChange={e => setConfirm(e.target.value)} /></div>
        {confirm && !matched && <p role="status">Le passphrase non corrispondono.</p>}
        {error && <p role="alert">{error}</p>}
        <button className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={busy || !secret || !checkPassphrase(passphrase).ok || !matched || (mode === 'recover' && !kit)}>{busy ? 'Preparazione…' : 'Prepara il nuovo kit'}</button>
    </form>;
}
