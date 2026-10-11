import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openAdmittedSqlite, runWithSqliteMaintenance, runWithSqliteMaintenanceSync } from '../sqlite-maintenance-admission.mjs';
import { openVersionedSqliteDatabase } from '../sqlite-schema-open';
import { copySqliteDatabaseSync, hasSqliteSwapArtifacts, recoverSqliteSwapArtifacts, replaceSqliteDatabase } from '../sqlite-repair';
import { readSqliteArchiveGeneration, rotateSqliteArchiveGeneration } from '../archive-generation';

const REQUEST = 'mediflow:archive-maintenance:repair-legacy';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Only the existing supervisor's explicitly selected Web-only mode owns this lifecycle. */
export async function runArchiveMaintenanceWebOwner(root: string): Promise<void> {
    const configuredData = process.env.MEDIFLOW_DATA_DIR;
    if (!configuredData || !path.isAbsolute(configuredData)) throw new Error('archive_owner_data_directory_required');
    root = fs.realpathSync(root);
    const data = fs.realpathSync(configuredData);
    const server = path.join(root, '.next', 'standalone', 'server.js');
    if (!fs.existsSync(server)) throw new Error('archive_owner_requires_existing_production_build');
    const target = path.join(data, 'medical.db');
    const source = path.join(root, 'medical.db');
    let participant: ReturnType<typeof openAdmittedSqlite> | undefined;
    let child: ChildProcess | undefined;
    let closed: Promise<void> | undefined;
    let busy = false;
    let stopping = false;
    let result: Record<string, string> | undefined;
    let settle!: () => void;
    const lifetime = new Promise<void>(resolve => { settle = resolve; });

    const start = () => {
        if (hasSqliteSwapArtifacts(target)) runWithSqliteMaintenanceSync(target, () => {
            const recovery = recoverSqliteSwapArtifacts(target);
            if (recovery.status === 'HOLD') throw new Error('archive_recovery_required');
            const checked = openVersionedSqliteDatabase(target);
            checked.close();
            if (recovery.status === 'RECOVERED') recovery.complete();
        });
        // Schema admission runs in the owner, where platform durability helpers are allowed.
        const db = openVersionedSqliteDatabase(target, file => {
            participant = openAdmittedSqlite(file, { role: 'managed-web-owner', sqliteOptions: { fileMustExist: true } });
            return participant.database;
        });
        const generation = readSqliteArchiveGeneration(db);
        const env: NodeJS.ProcessEnv = { ...process.env, MEDIFLOW_DATA_DIR: data, MEDIFLOW_ARCHIVE_MANAGED_WEB: '1',
            MEDIFLOW_ARCHIVE_OWNER_GENERATION: generation,
            MEDIFLOW_ARCHIVE_MAINTENANCE_RESULT: result ? JSON.stringify(result) : '',
            NODE_ENV: 'production' };
        delete env.NODE_OPTIONS;
        // No allow-child-process: trusted product helpers cannot leave unobserved descendants.
        // Addons are necessary for SQLite; this is lifecycle containment, not a hostile-code sandbox.
        child = spawn(process.execPath, ['--permission', '--allow-addons', '--allow-worker',
            `--allow-fs-read=${root}`, `--allow-fs-read=${fs.realpathSync(process.execPath)}`,
            `--allow-fs-read=${data}`, `--allow-fs-write=${data}`,
            server], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        const owned = child!;
        closed = new Promise((resolve, reject) => {
            owned.once('error', reject);
            owned.once('close', () => { resolve(); });
        });
        owned.on('message', message => {
            if (!message || typeof message !== 'object' || Array.isArray(message)) return;
            const request = message as Record<string, unknown>;
            if (request.type !== REQUEST || Object.keys(request).sort().join(',') !== 'expectedGeneration,requestId,type'
                || typeof request.requestId !== 'string' || !UUID.test(request.requestId)
                || typeof request.expectedGeneration !== 'string' || !UUID.test(request.expectedGeneration)) return;
            if (busy || stopping || !participant || request.expectedGeneration !== readSqliteArchiveGeneration(participant.database)) {
                owned.send({ type: REQUEST + ':ack', requestId: request.requestId, accepted: false }); return;
            }
            busy = true;
            owned.send({ type: REQUEST + ':ack', requestId: request.requestId, accepted: true });
            // Let the accepting route return; this is not evidence of completion.
            setTimeout(() => { void repair(request.requestId as string, request.expectedGeneration as string); }, 250);
        });
        void closed.then(async () => {
            if (busy) return;
            await participant?.close();
            participant = undefined;
            settle();
        }).catch(() => { process.exitCode = 1; settle(); });
    };
    const stopOwned = async () => {
        if (!child || !closed) throw new Error('archive_owner_missing_child');
        // A signal, PID disappearance or IPC disconnection does not release the lease.
        child.kill('SIGTERM');
        const force = setTimeout(() => { child?.kill('SIGKILL'); }, 5000);
        try { await closed; } finally { clearTimeout(force); }
        await participant?.close();
        participant = undefined;
    };
    const repair = async (requestId: string, expectedGeneration: string) => {
        let preparedRoot: string | undefined;
        let preparedSource: string;
        try {
            // Reject an incompatible B while A is still serving. Only an isolated copy is migrated.
            preparedRoot = fs.mkdtempSync(path.join(data, '.archive-replacement-'));
            preparedSource = path.join(preparedRoot, 'replacement.db');
            copySqliteDatabaseSync(source, preparedSource);
            const prepared = openVersionedSqliteDatabase(preparedSource);
            prepared.close();
        } catch {
            if (preparedRoot) { try { fs.rmSync(preparedRoot, { recursive: true, force: true }); } catch { /* Preserve rejected isolated copy; A is still available. */ } }
            result = { requestId, status: 'rejected' };
            if (child?.connected) child.send({ type: REQUEST + ':result', ...result });
            busy = false;
            if (stopping) { try { await stopOwned(); } finally { settle(); } }
            return;
        }
        try {
            await runWithSqliteMaintenance(target, { timeoutMs: 15000, drain: stopOwned }, async () => {
                const current = openVersionedSqliteDatabase(target);
                let candidate: ReturnType<typeof openVersionedSqliteDatabase> | undefined;
                try {
                    if (readSqliteArchiveGeneration(current) !== expectedGeneration) throw new Error('archive_generation_changed');
                    await replaceSqliteDatabase({ sourcePath: preparedSource, destPath: target,
                        backupPath: `${target}.bak-${randomUUID()}`, connection: current,
                        prepareReplacement: staging => {
                            const replacement = openVersionedSqliteDatabase(staging);
                            try { replacement.transaction(() => rotateSqliteArchiveGeneration(replacement)).immediate(); }
                            finally { replacement.close(); }
                        },
                        reopenConnection: () => { candidate = openVersionedSqliteDatabase(target); return candidate; },
                    });
                    fs.rmSync(preparedRoot!, { recursive: true });
                    result = { requestId, status: 'committed', archiveGeneration: readSqliteArchiveGeneration(candidate!) };
                } finally {
                    if (current.open) current.close();
                    if (candidate?.open) candidate.close();
                }
            });
            busy = false;
            if (stopping) settle(); else start();
        } catch {
            // An uncertain drain, callback or durability failure retains the protocol evidence.
            process.stderr.write('MediFlow archive maintenance requires recovery; Web was not restarted.\n');
            process.exitCode = 1;
            stopping = true;
            if (child && closed) { try { await stopOwned(); } catch { /* Retain lease on ambiguity. */ } }
            settle();
        }
    };
    const onSignal = () => {
        if (stopping) return;
        stopping = true;
        if (!busy) { busy = true; void stopOwned().then(settle, () => { process.exitCode = 1; settle(); }); }
    };
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(signal, onSignal);
    try { start(); await lifetime; }
    finally {
        for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.off(signal, onSignal);
    }
}

export function archiveMaintenanceAvailable(): boolean {
    return process.env.MEDIFLOW_ARCHIVE_MANAGED_WEB === '1' && typeof process.send === 'function' && process.connected;
}

export async function requestArchiveRepair(expectedGeneration: string): Promise<string> {
    if (!archiveMaintenanceAvailable()) throw new Error('archive_maintenance_owner_unavailable');
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
        const finish = (accepted: boolean) => {
            clearTimeout(timer); process.off('message', receive);
            if (!accepted) process.off('message', receiveResult);
            if (accepted) resolve(requestId); else reject(new Error('archive_maintenance_not_accepted'));
        };
        const receive = (message: unknown) => {
            if (!message || typeof message !== 'object') return;
            const ack = message as Record<string, unknown>;
            if (ack.type === REQUEST + ':ack' && ack.requestId === requestId) finish(ack.accepted === true);
        };
        const receiveResult = (message: unknown) => {
            if (!message || typeof message !== 'object') return;
            const terminal = message as Record<string, unknown>;
            if (terminal.type !== REQUEST + ':result' || terminal.requestId !== requestId || terminal.status !== 'rejected') return;
            process.env.MEDIFLOW_ARCHIVE_MAINTENANCE_RESULT = JSON.stringify({ requestId, status: 'rejected' });
            process.off('message', receiveResult);
        };
        const timer = setTimeout(() => { finish(false); }, 1000);
        process.on('message', receive);
        process.on('message', receiveResult);
        try { process.send!({ type: REQUEST, expectedGeneration, requestId }, undefined, {}, (error: Error | null) => { if (error) finish(false); }); }
        catch { finish(false); }
    });
}
