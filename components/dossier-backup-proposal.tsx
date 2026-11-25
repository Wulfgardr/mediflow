'use client';

import { useState } from 'react';
import { useSecurity } from '@/components/security-provider';
import { createRecoveryBackupFile, RECOVERY_BACKUP_REQUIREMENT, recoveryBackupAllowed, recoveryBackupFailure } from '@/components/recovery-backup-download';
import type { DossierDraftGroup } from '@/lib/document-dossier-session';
import { formatCountLabel } from '@/lib/format-count';
import styles from './patient-bulk-import-panel.module.css';

export const DOSSIER_BACKUP_PROPOSAL_MIN_PATIENTS = 5;

export type DossierBackupChoice = { kind: 'pending' } | { kind: 'made'; fileName: string } | { kind: 'skipped' };

export function dossierWritablePatientCount(groups: readonly DossierDraftGroup[]): number {
    return groups.filter((group) => group.sources.some((source) => source.status === 'ready')).length;
}

export function dossierBackupProposed(groups: readonly DossierDraftGroup[], choice: DossierBackupChoice): boolean {
    return choice.kind === 'pending' && dossierWritablePatientCount(groups) >= DOSSIER_BACKUP_PROPOSAL_MIN_PATIENTS;
}

export function DossierBackupProposal({ patients, disabled, onChoice }: {
    patients: number; disabled: boolean; onChoice: (choice: Exclude<DossierBackupChoice, { kind: 'pending' }>) => void;
}) {
    const { recoveryBackup, unlockCredential, user } = useSecurity();
    const [working, setWorking] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const allowed = recoveryBackupAllowed(unlockCredential, user?.role);
    const backup = async () => {
        setWorking(true); setFailure(null);
        try { onChoice({ kind: 'made', fileName: await createRecoveryBackupFile(recoveryBackup) }); }
        catch (error) { setFailure(recoveryBackupFailure(error)); }
        finally { setWorking(false); }
    };
    return <div className={styles.notice} role="group" aria-label="Backup prima dell’importazione" data-testid="dossier-backup-proposal">
        <p>Stai per scrivere in {formatCountLabel(patients, 'scheda', 'schede')}. Prima conviene un backup completo cifrato.</p>
        {!allowed && <p>{RECOVERY_BACKUP_REQUIREMENT}</p>}
        {failure && <p role="alert">{failure}</p>}
        <div className={styles.actions}>
            <button type="button" className="mf-button-primary" disabled={!allowed || working || disabled} onClick={() => { void backup(); }}>
                {working ? 'Backup in corso…' : 'Fai un backup adesso'}</button>
            <button type="button" className="mf-button-secondary" disabled={working || disabled} onClick={() => onChoice({ kind: 'skipped' })}>Continua senza backup</button>
        </div>
    </div>;
}
