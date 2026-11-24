export const ARCHIVE_POLICY_MESSAGES = {
    legal_hold: 'Questo backup cambierebbe un fascicolo o un documento soggetto a un blocco di conservazione. Scegli una copia che lo conservi.',
    retention_unreadable: 'MediFlow non riesce a leggere i blocchi di conservazione di questo archivio.',
    retired_patient_material: 'Il backup contiene depositi o dati storici che potrebbero riguardare un fascicolo ritirato. Usa un backup successivo alla cancellazione oppure un backup completo cifrato per il recupero su una nuova destinazione.',
} as const;

export type ArchivePolicyReason = keyof typeof ARCHIVE_POLICY_MESSAGES;
export type BackupRestoreBlockedReason = ArchivePolicyReason | 'audit' | 'runtime_fence' | 'therapy_status_commands' | 'ambulatory_destructive_commands' | 'snapshot';

export class BackupRestoreBlockedError extends Error {
    readonly reason: BackupRestoreBlockedReason;

    constructor(reason: BackupRestoreBlockedReason, detail: string) {
        super(`Restore blocked: ${detail}`);
        this.name = 'BackupRestoreBlockedError';
        this.reason = reason;
    }
}
