import { MAX_RECOVERY_DATABASE_BYTES } from './recovery-backup';

export const RECOVERY_BACKUP_REFUSALS = {
    session_expired: { status: 401, message: 'La sessione è scaduta. Sblocca di nuovo MediFlow e riprova.' },
    administrator_required: { status: 403, message: 'Il backup completo si crea con l’account amministratore, dalla scheda del browser in cui hai sbloccato MediFlow.' },
    recovery_wrapping_missing: { status: 409,
        message: 'Questo account non ha ancora una chiave di recupero, quindi il backup non si potrebbe ripristinare. Passa alla passphrase in Impostazioni › Accesso.' },
    archive_too_large: { status: 413,
        message: `L’archivio supera ${MAX_RECOVERY_DATABASE_BYTES / (1024 * 1024)} MiB, il limite del backup completo creato dall’app. Usa il backup del Mac.` },
    archive_inconsistent: { status: 409,
        message: 'L’archivio non supera il controllo di integrità, quindi una sua copia non si potrebbe ripristinare. Non importare documenti e chiedi assistenza.' },
    archive_schema_unsupported: { status: 409, message: 'L’archivio non è nella versione attesa da questo MediFlow. Riavvia MediFlow e riprova.' },
    backup_failed: { status: 500, message: 'Il backup completo non è stato creato per un errore interno. Riprova; se si ripete, segnala il problema.' },
} as const satisfies Record<string, { status: number; message: string }>;

export type RecoveryBackupRefusal = keyof typeof RECOVERY_BACKUP_REFUSALS;

export class RecoverySnapshotRefusedError extends Error {
    constructor(readonly reason: RecoveryBackupRefusal) { super('RECOVERY_BACKUP_PREFLIGHT_FAILED'); }
}

export function isRecoveryBackupRefusal(value: unknown): value is RecoveryBackupRefusal {
    return typeof value === 'string' && Object.hasOwn(RECOVERY_BACKUP_REFUSALS, value);
}

export function recoveryBackupRefusalResponse(reason: RecoveryBackupRefusal): Response {
    const { status, message } = RECOVERY_BACKUP_REFUSALS[reason];
    return Response.json({ error: message, code: reason }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function recoveryBackupRefusalMessage(status: number, code: unknown): string {
    if (isRecoveryBackupRefusal(code) && RECOVERY_BACKUP_REFUSALS[code].status === status) return RECOVERY_BACKUP_REFUSALS[code].message;
    if (status === 401) return RECOVERY_BACKUP_REFUSALS.session_expired.message;
    if (status === 403) return RECOVERY_BACKUP_REFUSALS.administrator_required.message;
    return RECOVERY_BACKUP_REFUSALS.backup_failed.message;
}
