'use client';
import { useState } from 'react';
import { useSecurity } from './security-provider';
import { Disclosure } from './disclosure';
import composition from './settings/backup-composition.module.css';
import { MAX_RECOVERY_BACKUP_BYTES, MAX_RECOVERY_DATABASE_BYTES } from '@/lib/recovery-backup';

export function RecoveryBackupUI({ primary = true }: { primary?: boolean }) {
    const { recoveryBackup, unlockCredential, user } = useSecurity();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const allowed = unlockCredential === 'passphrase' && user?.role === 'admin';
    return <section className={composition.section} aria-labelledby="recovery-backup-heading">
        <h3 id="recovery-backup-heading" className={composition.sectionTitle}>Backup completo di recupero</h3>
        <p>Copia cifrata dell’intero archivio, compresi account, chiavi protette e storico. Per recuperarla servono il kit corrispondente a questo backup e la sua chiave su carta, conservata separatamente. Limite: {MAX_RECOVERY_DATABASE_BYTES / (1024 * 1024)} MiB.</p>
        {!allowed && <p>Prima passa alla passphrase e salva il kit nelle impostazioni di sicurezza, usando l’account amministratore.</p>}
        <div className={composition.actions}>
            <button className={primary ? 'ui-btn-primary' : 'mf-btn-secondary'} data-backup-primary={primary || undefined} disabled={!allowed || busy} onClick={async () => {
                setBusy(true); setMessage('Creazione in corso…');
                try {
                    const bytes = await recoveryBackup();
                    if (!bytes) throw new Error();
                    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
                    const link = document.createElement('a'); link.href = url;
                    link.download = `mediflow-recovery-${new Date().toISOString().slice(0, 10)}.mediflow-recovery`; link.click();
                    URL.revokeObjectURL(url);
                    setMessage('Backup creato. Seleziona il file per verificarne la cifratura e conserva una copia fuori da questo computer, con il kit corrispondente. Non è ancora stato provato un ripristino.');
                } catch { setMessage('Backup non creato. Rinnova l’accesso e verifica che archivio e kit siano disponibili.'); }
                finally { setBusy(false); }
            }}>{busy ? 'Attendi…' : 'Crea backup completo cifrato'}</button>
            <label className={`mf-btn-secondary ${composition.fileControl}`}>Verifica il file cifrato
                <input type="file" accept=".mediflow-recovery" disabled={!allowed || busy} data-testid="recovery-backup-verify" className="sr-only" onChange={async event => {
                    const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!file || busy) return;
                    setBusy(true); setMessage('Verifica in corso…');
                    try {
                        if (file.size > MAX_RECOVERY_BACKUP_BYTES) throw new Error();
                        await recoveryBackup(new Uint8Array(await file.arrayBuffer()));
                        setMessage('Cifratura e integrità del file verificate con la chiave sbloccata. Il ripristino non è ancora provato: serve una prova su un archivio vuoto, con kit e chiave cartacea.');
                    } catch { setMessage('File non verificato: è incompleto, alterato o appartiene a un’altra chiave. Non usarlo per recuperare l’archivio.'); }
                    finally { setBusy(false); }
                }} />
            </label>
        </div>
        {message && <p role="status">{message}</p>}
        <Disclosure title="Recupero su un computer nuovo">
            <p className="mt-3">Non completare il primo avvio. Chiudi MediFlow, usa un volume cifrato e recupera in una cartella locale vuota con il comando seguente dalla cartella del programma. Il comando chiede la chiave senza mostrarla. Poi avvia MediFlow con la stessa cartella dati e scegli «Recupera con kit e chiave» per impostare una nuova passphrase.</p>
            <code className="mt-3 block overflow-x-auto">npm run recovery:restore -- --backup /percorso/backup.mediflow-recovery --kit /percorso/kit.json --data-dir /percorso/archivio-vuoto --source-retired</code>
            <p className="mt-3">L’opzione finale conferma che il vecchio archivio non sarà più usato. Se recuperi il computer originale, ritiralo prima di lavorare sul nuovo: il programma non può impedire l’uso di una copia su un altro computer. I dispositivi abbinati devono essere abbinati di nuovo.</p>
        </Disclosure>
    </section>;
}
