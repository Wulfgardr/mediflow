import fs from 'fs';
import {
    BackupArtifact,
    BackupArtifactError,
    type BackupArtifactErrorCode,
    parseBackupArtifact,
} from './backup-artifact';

/* @Codex */
export type BackupRestorePreflightCheckId =
    | 'artifact-document-currentness'
    | 'artifact-json'
    | 'artifact-format'
    | 'artifact-version'
    | 'artifact-manifest'
    | 'artifact-checksum'
    | 'artifact-references'
    | 'data-dir-accessible'
    | 'target-db-readable'
    | 'target-db-writable';

/* @Codex */
export type BackupRestorePreflightCheck = {
    id: BackupRestorePreflightCheckId;
    status: 'pass' | 'fail';
    message: string;
    remediation?: string;
};

/* @Codex */
export type BackupRestorePreflightResult = {
    ok: boolean;
    error?: string;
    checks: BackupRestorePreflightCheck[];
    target: {
        dataDir: string | null;
        dbPath: string | null;
        dbExists: boolean;
    };
};

type FsLike = {
    accessSync: (path: string, mode?: number) => void;
    existsSync: (path: string) => boolean;
    constants: Pick<typeof fs.constants, 'R_OK' | 'W_OK'>;
};

type PreflightDeps = {
    fs: FsLike;
    getDataDir: () => string;
    resolveDataPath: (...segments: string[]) => string;
};

type DataDirModule = {
    getDataDir: () => string;
    resolveDataPath: (...segments: string[]) => string;
};

function loadDataDirModule(): DataDirModule {
    // @Codex Load server-only filesystem helpers lazily so injected test deps stay isolated.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./data-dir') as DataDirModule;
}

const defaultDeps: PreflightDeps = {
    fs,
    getDataDir: () => loadDataDirModule().getDataDir(),
    resolveDataPath: (...segments) => loadDataDirModule().resolveDataPath(...segments),
};

function pass(
    id: BackupRestorePreflightCheckId,
    message: string,
): BackupRestorePreflightCheck {
    return { id, status: 'pass', message };
}

function fail(
    id: BackupRestorePreflightCheckId,
    message: string,
    remediation: string,
): BackupRestorePreflightCheck {
    return { id, status: 'fail', message, remediation };
}

function artifactFailureToCheck(error: BackupArtifactError): BackupRestorePreflightCheck {
    const map: Record<BackupArtifactErrorCode, BackupRestorePreflightCheck> = {
        'backup-document-currentness-unsupported': fail(
            'artifact-document-currentness',
            'BACKUP_DOCUMENT_CURRENTNESS_UNSUPPORTED',
            'Riesporta il backup da una sorgente che conserva la currentness documentale.',
        ),
        'invalid-json': fail(
            'artifact-json',
            error.message,
            'Seleziona un file backup `.mediflow` valido esportato da MediFlow.',
        ),
        'invalid-format': fail(
            'artifact-format',
            error.message,
            'Usa un artifact con formato `mediflow-backup` esportato dall’app.',
        ),
        'unsupported-version': fail(
            'artifact-version',
            error.message,
            'Rigenera il backup con una versione supportata del formato v1.',
        ),
        'invalid-manifest': fail(
            'artifact-manifest',
            error.message,
            'Rigenera il backup e verifica che il file non sia stato modificato manualmente.',
        ),
        'collection-mismatch': fail(
            'artifact-manifest',
            error.message,
            'Rigenera il backup: il set di collezioni non coincide con il contratto atteso.',
        ),
        'count-mismatch': fail(
            'artifact-manifest',
            error.message,
            'Rigenera il backup: i conteggi del manifest non sono coerenti con il payload.',
        ),
        'checksum-mismatch': fail(
            'artifact-checksum',
            error.message,
            'Il file risulta corrotto o alterato. Riesporta il backup dal sistema sorgente.',
        ),
    };

    return map[error.code];
}

function canAccess(targetPath: string, mode: number, deps: PreflightDeps): boolean {
    try {
        deps.fs.accessSync(targetPath, mode);
        return true;
    } catch {
        return false;
    }
}

/* @Codex */
export async function runBackupRestorePreflight(
    value: unknown,
    deps: PreflightDeps = defaultDeps,
): Promise<{ artifact: BackupArtifact | null; result: BackupRestorePreflightResult }> {
    const checks: BackupRestorePreflightCheck[] = [];
    let artifact: BackupArtifact | null = null;

    let dataDir: string | null = null;
    let dbPath: string | null = null;
    let dbExists = false;

    try {
        dataDir = deps.getDataDir();
        dbPath = deps.resolveDataPath('medical.db');
        dbExists = deps.fs.existsSync(dbPath);

        if (canAccess(dataDir, deps.fs.constants.R_OK | deps.fs.constants.W_OK, deps)) {
            checks.push(pass('data-dir-accessible', 'Cartella dati locale accessibile in lettura e scrittura.'));
        } else {
            checks.push(fail(
                'data-dir-accessible',
                'La cartella dati locale non è accessibile in lettura/scrittura.',
                'Verifica permessi e percorso di `MEDIFLOW_DATA_DIR` prima del restore.',
            ));
        }

        if (!dbExists || canAccess(dbPath, deps.fs.constants.R_OK, deps)) {
            checks.push(pass(
                'target-db-readable',
                dbExists
                    ? 'Database target leggibile.'
                    : 'Database target non presente: il restore può crearne uno nuovo nella cartella dati.',
            ));
        } else {
            checks.push(fail(
                'target-db-readable',
                'Il database target non è leggibile.',
                'Controlla permessi e proprietà del file `medical.db` prima del restore.',
            ));
        }

        if ((dbExists && canAccess(dbPath, deps.fs.constants.W_OK, deps)) || (!dbExists && dataDir && canAccess(dataDir, deps.fs.constants.W_OK, deps))) {
            checks.push(pass(
                'target-db-writable',
                dbExists
                    ? 'Database target scrivibile.'
                    : 'Cartella dati scrivibile: il restore può creare il database target.',
            ));
        } else {
            checks.push(fail(
                'target-db-writable',
                'Il database target non è scrivibile.',
                'Controlla permessi e proprietà del file `medical.db` o della cartella dati prima del restore.',
            ));
        }
    } catch (error) {
        checks.push(fail(
            'data-dir-accessible',
            error instanceof Error ? error.message : 'Impossibile risolvere la cartella dati locale.',
            'Verifica percorso e permessi della cartella dati locale prima del restore.',
        ));
    }

    try {
        artifact = await parseBackupArtifact(value);
        checks.push(pass('artifact-json', 'Artifact JSON leggibile.'));
        checks.push(pass('artifact-format', 'Formato artifact valido.'));
        checks.push(pass('artifact-version', `Versione artifact ${artifact.version} supportata.`));
        checks.push(pass('artifact-manifest', 'Manifest e record counts coerenti con il payload.'));
        checks.push(pass('artifact-checksum', 'Checksum artifact valida.'));
        checks.push(pass('artifact-references', 'Riferimenti interni del payload coerenti.'));
    } catch (error) {
        if (error instanceof BackupArtifactError) {
            checks.push(artifactFailureToCheck(error));
        } else {
            checks.push(fail(
                'artifact-json',
                error instanceof Error ? error.message : 'Artifact non leggibile.',
                'Verifica che il file backup sia un JSON `.mediflow` valido.',
            ));
        }
    }

    const failure = checks.find((check) => check.status === 'fail');
    const result: BackupRestorePreflightResult = {
        ok: !failure,
        error: failure ? `${failure.message}${failure.remediation ? ` ${failure.remediation}` : ''}` : undefined,
        checks,
        target: {
            dataDir,
            dbPath,
            dbExists,
        },
    };

    return { artifact, result };
}
