import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { copySqliteDatabaseSync, createVerifiedSqliteSnapshotSync, hasSqliteSwapArtifacts, replaceSqliteDatabase } from './sqlite-repair';
import { CURRENT_SQLITE_SCHEMA_VERSION, openVersionedSqliteDatabase } from './sqlite-schema-open';
import { readSqliteArchiveGeneration, rotateSqliteArchiveGeneration } from './archive-generation';
import { runWithSqliteMaintenance } from './sqlite-maintenance-admission.mjs';
import { assertRecoveryDatabaseBytes, decryptRecoveryBackup, MAX_RECOVERY_DATABASE_BYTES, type RecoveryKit } from './recovery-backup';
import { hashAccessVerifier, openRecoveryWrapping } from './security/unlock-credential';
import { validateRecoveryAuditSchema } from './sqlite-schema';

function fail(): never { throw new Error('RECOVERY_BACKUP_PREFLIGHT_FAILED'); }
function quote(identifier: string): string { return '"' + identifier.replaceAll('"', '""') + '"'; }

/** Validate only an isolated candidate; missing tables must never be rebuilt by a migration. */
function validateCandidate(file: string): Database.Database {
    const probe = new Database(file, { readonly: true, fileMustExist: true });
    try {
        if (probe.pragma('user_version', { simple: true }) !== CURRENT_SQLITE_SCHEMA_VERSION
            || probe.pragma('integrity_check', { simple: true }) !== 'ok'
            || (probe.pragma('foreign_key_check') as unknown[]).length !== 0) fail();
    } finally { probe.close(); }
    const candidate = openVersionedSqliteDatabase(file);
    try { validateRecoveryAuditSchema(candidate); return candidate; }
    catch (error) { candidate.close(); throw error; }
}

/** Called synchronously under the Web process's existing admission; no unowned source or raw file copy. */
export function createRecoverySnapshot(connection: Database.Database, actorId: string): Uint8Array {
    const root = fs.mkdtempSync(path.join(path.dirname(connection.name), '.recovery-backup-'));
    const file = path.join(root, 'snapshot.db');
    try {
        copySqliteDatabaseSync(connection.name, file);
        fs.chmodSync(file, 0o600);
        const candidate = validateCandidate(file);
        try {
            const account = candidate.prepare(`SELECT encrypted_master_key, recovery_wrapped_master_key, recovery_salt,
                recovery_verifier_hash FROM users WHERE id = ? AND role = 'admin'`).get(actorId) as Record<string, unknown> | undefined;
            if (!account || typeof account.encrypted_master_key !== 'string' || !account.encrypted_master_key.startsWith('v3:')
                || !account.recovery_wrapped_master_key || !account.recovery_salt || !account.recovery_verifier_hash) fail();
            // openVersionedSqliteDatabase can switch WAL on, but performs no schema writes at this version.
            candidate.pragma('wal_checkpoint(TRUNCATE)');
            candidate.pragma('journal_mode = DELETE');
        } finally { candidate.close(); }
        if (fs.statSync(file).size > MAX_RECOVERY_DATABASE_BYTES) fail();
        const bytes = fs.readFileSync(file);
        assertRecoveryDatabaseBytes(bytes);
        return bytes;
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

/** A blank canonical archive may contain its generation, and nothing else. No whitelist of clinical tables. */
function assertEmptyDestination(file: string): void {
    // A pre-existing native administrative bearer is authority, even without account rows.
    if (process.env.MEDIFLOW_LOCAL_API_TOKEN || fs.existsSync(path.join(path.dirname(file), 'local-api-token'))) fail();
    if (!fs.existsSync(file)) {
        // Admission validates its own sidecar; it is not evidence that clinical data existed.
        if (fs.readdirSync(path.dirname(file)).some(name => name.startsWith(path.basename(file))
            && name !== path.basename(file) + '.maintenance-admission')) fail();
        return;
    }
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || hasSqliteSwapArtifacts(file)) fail();
    const destination = new Database(file, { readonly: true, fileMustExist: true });
    try {
        if (destination.pragma('user_version', { simple: true }) !== CURRENT_SQLITE_SCHEMA_VERSION
            || destination.pragma('integrity_check', { simple: true }) !== 'ok') fail();
        readSqliteArchiveGeneration(destination);
        const tables = destination.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*'").all() as { name: string }[];
        for (const { name } of tables) {
            if (name !== 'archive_generation' && destination.prepare(`SELECT 1 FROM ${quote(name)} LIMIT 1`).get()) fail();
        }
    } finally { destination.close(); }
}

/** Offline only. The caller owns the local process, not a Web session or a second maintenance owner. */
export async function restoreRecoveryBackup(options: {
    artifact: Uint8Array; kit: RecoveryKit; recoveryKey: string; destination: string;
}): Promise<{ archiveGeneration: string; username: string }> {
    const requested = path.resolve(options.destination);
    const parent = fs.realpathSync(path.dirname(requested));
    if (path.basename(requested) !== 'medical.db') fail();
    const destination = path.join(parent, 'medical.db');
    // Wrong/missing key, truncated data and failed authentication never open the destination for writes.
    const recovered = await openRecoveryWrapping(options.kit.wrappedMasterKey, options.kit.salt, options.recoveryKey);
    const bytes = await decryptRecoveryBackup(options.artifact, recovered.masterKey);
    const root = fs.mkdtempSync(path.join(parent, '.recovery-restore-'));
    const source = path.join(root, 'snapshot.db');
    try {
        fs.writeFileSync(source, bytes, { flag: 'wx', mode: 0o600 });
        bytes.fill(0);
        const verifierHash = await hashAccessVerifier(recovered.verifier);
        const candidate = validateCandidate(source);
        try {
            const account = candidate.prepare(`SELECT recovery_wrapped_master_key, recovery_salt, recovery_verifier_hash
                FROM users WHERE username = ? AND role = 'admin' AND encrypted_master_key LIKE 'v3:%'`).get(options.kit.username) as Record<string, unknown> | undefined;
            if (!account || account.recovery_wrapped_master_key !== options.kit.wrappedMasterKey
                || account.recovery_salt !== options.kit.salt || account.recovery_verifier_hash !== verifierHash) fail();
        } finally { candidate.close(); }
        assertEmptyDestination(destination);
        let archiveGeneration = '';
        await runWithSqliteMaintenance(destination, { timeoutMs: 1000 }, async () => {
            // Recheck after exclusion; a competing setup must not be overwritten.
            assertEmptyDestination(destination);
            if (!fs.existsSync(destination)) {
                // Initialize only an isolated empty database, then publish it exclusively under admission.
                // The existing opener deliberately refuses missing files beside protocol artifacts.
                const blank = path.join(root, 'blank.db');
                openVersionedSqliteDatabase(blank).close();
                createVerifiedSqliteSnapshotSync(blank, destination);
            }
            const current = openVersionedSqliteDatabase(destination);
            let installed: Database.Database | undefined;
            try {
                await replaceSqliteDatabase({ sourcePath: source, destPath: destination, connection: current,
                    prepareReplacement: staging => {
                        const replacement = validateCandidate(staging);
                        try { replacement.transaction(() => {
                            archiveGeneration = rotateSqliteArchiveGeneration(replacement);
                            replacement.prepare('DELETE FROM archive_session_generations').run();
                        }).immediate(); } finally { replacement.close(); }
                    },
                    reopenConnection: () => { installed = validateCandidate(destination); return installed; },
                });
            } finally {
                if (current.open) current.close();
                if (installed?.open) installed.close();
            }
        });
        return { archiveGeneration, username: options.kit.username };
    } finally { bytes.fill(0); fs.rmSync(root, { recursive: true, force: true }); }
}
