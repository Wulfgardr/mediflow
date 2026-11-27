import type { UnlockParameters } from '@/lib/security/client-auth-api';

export const RECOVERY_BACKUP_REQUIREMENT = 'Prima passa alla passphrase e salva il kit nelle impostazioni di sicurezza, usando l’account amministratore.';
export const RECOVERY_BACKUP_BROWSER_REQUIREMENT = 'Per creare il backup completo, apri MediFlow in Chrome o Edge e sblocca l’archivio.';

export type RecoveryBackupAction = { kind: 'create'; output: WritableStream<Uint8Array<ArrayBuffer>> }
    | { kind: 'verify'; artifact: File };

type SavePicker = (options: {
    suggestedName: string;
    excludeAcceptAllOption: boolean;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<FileSystemFileHandle>;

function savePicker(): SavePicker | undefined {
    return typeof window === 'undefined' ? undefined
        : (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
}

export function recoveryBackupSaveSupported(): boolean { return !!savePicker(); }

export function recoveryBackupAllowed(unlockCredential: UnlockParameters['credential'], role: string | undefined): boolean {
    return unlockCredential === 'passphrase' && role === 'admin';
}

export function recoveryBackupFailure(error: unknown): string {
    if (error instanceof DOMException && error.name === 'AbortError') return 'Salvataggio annullato.';
    const reason = error instanceof Error && error.message ? error.message : 'Riprova.';
    if (reason === 'RECOVERY_BACKUP_INVALID') return 'Backup non creato. La copia ricevuta è incompleta. Riprova.';
    return `Backup non creato. ${reason}`;
}

export async function createRecoveryBackupFile(recoveryBackup: (action: RecoveryBackupAction) => Promise<void>): Promise<string> {
    const name = `mediflow-recovery-${new Date().toISOString().slice(0, 10)}.mediflow-recovery`;
    const pick = savePicker();
    if (!pick) throw new Error(RECOVERY_BACKUP_BROWSER_REQUIREMENT);
    const file = await pick.call(window, {
        suggestedName: name, excludeAcceptAllOption: true, types: [{ description: 'Backup MediFlow', accept: { 'application/octet-stream': ['.mediflow-recovery'] } }],
    });
    const output = await file.createWritable();
    try { await recoveryBackup({ kind: 'create', output }); }
    catch (error) {
        await output.abort().catch(() => {});
        throw error;
    }
    return file.name;
}
