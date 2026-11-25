import type { UnlockParameters } from '@/lib/security/client-auth-api';

export const RECOVERY_BACKUP_REQUIREMENT = 'Prima passa alla passphrase e salva il kit nelle impostazioni di sicurezza, usando l’account amministratore.';

export function recoveryBackupAllowed(unlockCredential: UnlockParameters['credential'], role: string | undefined): boolean {
    return unlockCredential === 'passphrase' && role === 'admin';
}

export function recoveryBackupFailure(error: unknown): string {
    const reason = error instanceof Error && error.message ? error.message : 'Riprova.';
    return `Backup non creato. ${reason}`;
}

export async function createRecoveryBackupFile(recoveryBackup: () => Promise<Uint8Array | void>): Promise<string> {
    const bytes = await recoveryBackup();
    if (!bytes) throw new Error();
    const name = `mediflow-recovery-${new Date().toISOString().slice(0, 10)}.mediflow-recovery`;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    URL.revokeObjectURL(url);
    return name;
}
