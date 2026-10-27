import type { ServerSession } from './security/server-session';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { readTherapyStatusCommandRows, readTherapyCommandAudits, validateTherapyStatusCommandRows, planTherapyStatusCommandUnion, captureTherapyStatusCommands, preserveTherapyStatusCommands } from './therapy-status-command-backup.ts';
import { openVersionedSqliteDatabase, CURRENT_SQLITE_SCHEMA_VERSION } from './sqlite-schema-open.ts';
import { createEmptyDataset, createBackupArtifact, parseBackupArtifact } from './backup-artifact.ts';
import { replaceSqliteDatabase, createVerifiedSqliteSnapshotSync } from './sqlite-repair.ts';
import { rotateSqliteArchiveGeneration } from './archive-generation.ts';
const load = createRequire(import.meta.url);
const data = mkdtempSync(join(tmpdir(), 'mediflow-command-backup-')); process.env.MEDIFLOW_DATA_DIR = data;
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const { users, patients, therapies } = load('./schema.ts') as typeof import('./schema.ts');
const { bindSyntheticArchiveSessions, issueSyntheticWebSession } = load('./security/web-auth-lifecycle-owner-test-fixture.ts') as typeof import('./security/web-auth-lifecycle-owner-test-fixture.ts');
const { executeTherapyStatusCommand, closeTherapyStatusCommand, readTherapyStatusReceipt } = load('./therapy-status-command-service.ts') as typeof import('./therapy-status-command-service.ts');
const { restoreBackupArtifact } = load('./backup-restore-executor.ts') as typeof import('./backup-restore-executor.ts');
const generation = bindSyntheticArchiveSessions('synthetic-backup-session');
const syntheticUsername = 'synthetic-backup';
let session: ServerSession = { id: 'synthetic-backup-session', userId: 'synthetic-backup-actor', username: syntheticUsername, role: 'admin', authChannel: 'web' as const, createdAt: Date.now(), expiresAt: Date.now() + 600000 };
dbServer.insert(users).values({ id: session.userId, username: session.username, role: 'admin', passwordHash: 'synthetic', salt: 'synthetic', encryptedMasterKey: 'synthetic' }).run();
session = issueSyntheticWebSession({ id: session.userId, username: session.username, role: 'admin' }, 'therapy-command');
const sql = openDbServer();
function fixture() {
    const patientId = randomUUID(), therapyId = randomUUID();
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: randomUUID() }).run();
    dbServer.insert(therapies).values({ id: therapyId, patientId, drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose', status: 'active', version: 1, startDate: new Date() }).run();
    return { commandId: randomUUID(), protocol: 'therapy.status.change.v1' as const, archiveGeneration: generation, patientId, therapyId, expectedVersion: 1 };
}
const applied = fixture(); executeTherapyStatusCommand(session, { ...applied, target: 'completed' });
const closed = fixture(); closeTherapyStatusCommand(session, closed);
const rejected = fixture(); executeTherapyStatusCommand(session, { ...rejected, expectedVersion: 2, target: 'suspended' });
function dataset() { return { ...createEmptyDataset(), therapyStatusCommands: readTherapyStatusCommandRows(sql), auditEvents: readTherapyCommandAudits(sql) }; }
test('Web and scheduled serializer preserve all terminals and closed NULL without current clinical parents', async () => {
    const payload = dataset(); const artifact = await createBackupArtifact(payload);
    const parsed = await parseBackupArtifact(JSON.parse(JSON.stringify(artifact)));
    assert.deepEqual(parsed.payload.therapyStatusCommands, payload.therapyStatusCommands);
    const scheduled = await import('../scripts/run-scheduled-backup.mjs') as { serializeBackupArtifact: (payload: unknown) => Promise<string> };
    const other = await parseBackupArtifact(JSON.parse(await scheduled.serializeBackupArtifact(payload)));
    assert.deepEqual(other.payload.therapyStatusCommands, payload.therapyStatusCommands);
    assert.equal(other.payload.therapyStatusCommands!.find(row => row.outcome === 'closed')!.target, null);
});
test('each immutable field, missing or divergent audit and malformed result are denied without mutation', () => {
    const payload = dataset(), before = readTherapyStatusCommandRows(sql);
    const row = payload.therapyStatusCommands.find(row => row.outcome === 'closed')!;
    for (const patch of [{ actorRef: 'other' }, { patientId: 'other' }, { therapyId: 'other' }, { expectedVersion: 50 }, { archiveGeneration: randomUUID() }, { committedAt: 1 }]) {
        const incoming = payload.therapyStatusCommands.map(value => value === row ? { ...value, ...patch } : value);
        assert.throws(() => planTherapyStatusCommandUnion(sql, incoming, payload.auditEvents), /collision/);
        assert.deepEqual(readTherapyStatusCommandRows(sql), before);
    }
    assert.throws(() => validateTherapyStatusCommandRows(payload.therapyStatusCommands, []), /audit/);
    assert.throws(() => validateTherapyStatusCommandRows(payload.therapyStatusCommands.map(value => value.outcome === 'closed' ? { ...value, target: 'active' } : value), payload.auditEvents), /closed/);
    const audits = payload.auditEvents.map(row => row.eventId === payload.therapyStatusCommands.find(value => value.outcome === 'applied')!.auditEventId ? { ...row, actorRef: 'other' } : row);
    assert.throws(() => validateTherapyStatusCommandRows(payload.therapyStatusCommands, audits), /audit/);
});
test('raw replacement preserves postbackup applied and closed rows in staging without replaying their clinical effect', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mediflow-command-raw-')), source = join(root, 'old.db'), destination = join(root, 'medical.db');
    const original = openVersionedSqliteDatabase(source); original.close();
    createVerifiedSqliteSnapshotSync(sql.name, destination);
    const current = openVersionedSqliteDatabase(destination); let installed: Database.Database | undefined;
    const before = readTherapyStatusCommandRows(current), captured = captureTherapyStatusCommands(current);
    await replaceSqliteDatabase({ sourcePath: source, destPath: destination, connection: current,
        prepareReplacement: staging => { const replacement = openVersionedSqliteDatabase(staging, undefined, { prepareReplacement: true }); try { preserveTherapyStatusCommands(captured, replacement); replacement.transaction(() => rotateSqliteArchiveGeneration(replacement)).immediate(); } finally { replacement.close(); } },
        reopenConnection: () => { installed = openVersionedSqliteDatabase(destination); return installed; } });
    assert.deepEqual(readTherapyStatusCommandRows(installed!), before);
    assert.equal((installed!.prepare('SELECT count(*) n FROM therapies').get() as {n:number}).n, 0);
    validateTherapyStatusCommandRows(before, readTherapyCommandAudits(installed!));
    installed!.close();
});
test('v4 to current migration adds ledgers once and preserves original snapshot', () => {
    const root = mkdtempSync(join(tmpdir(), 'mediflow-command-migrate-')), file = join(root, 'medical.db');
    const before = openVersionedSqliteDatabase(file); before.exec('DROP TABLE ambulatory_destructive_commands; DROP TABLE therapy_status_commands; PRAGMA user_version=4;'); before.close();
    const after = openVersionedSqliteDatabase(file);
    assert.equal(after.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
    assert.deepEqual(readTherapyStatusCommandRows(after), []); after.close();
    const snapshots = readdirSync(root).filter(name => name.includes('.schema-original-v4-'));
    assert.equal(snapshots.length, 1);
    const old = new Database(join(root, snapshots[0]!), { readonly: true }); assert.equal(old.pragma('user_version', { simple: true }), 4); assert.equal(old.prepare("SELECT 1 FROM sqlite_schema WHERE name='therapy_status_commands'").get(), undefined); old.close();
    openVersionedSqliteDatabase(file).close(); assert.equal(readdirSync(root).filter(name => name.includes('.schema-original-v4-')).length, 1);
});
test('JSON command collision blocks before fence or any archive mutation', async () => {
    const payload = dataset(), before = readTherapyStatusCommandRows(sql);
    payload.therapyStatusCommands = payload.therapyStatusCommands.map(row => row.outcome === 'closed' ? { ...row, actorRef: 'synthetic-other-owner' } : row);
    const artifact = await createBackupArtifact(payload); let fences = 0;
    assert.throws(() => restoreBackupArtifact(artifact, () => { fences++; return false; }), /therapy status command/);
    assert.equal(fences, 0); assert.deepEqual(readTherapyStatusCommandRows(sql), before);
    assert.equal((sql.prepare('SELECT version FROM therapies WHERE id=?').get(applied.therapyId) as {version:number}).version, 2);
});
test('failed v4 migration rolls back ledger DDL and version', () => {
    const root = mkdtempSync(join(tmpdir(), 'mediflow-command-migration-fault-')), file = join(root, 'medical.db');
    const old = openVersionedSqliteDatabase(file); old.exec('DROP TABLE ambulatory_destructive_commands; DROP TABLE therapy_status_commands; PRAGMA user_version=4;'); old.close();
    assert.throws(() => openVersionedSqliteDatabase(file, name => {
        const connection = new Database(name), execute = connection.exec.bind(connection);
        connection.exec = source => { const result = execute(source); if (source.includes('therapy_status_commands_no_update')) throw new Error('SYNTHETIC_MIGRATION_FAULT'); return result; };
        return connection;
    }), /SYNTHETIC_MIGRATION_FAULT/);
    const check = new Database(file, { readonly: true });
    assert.equal(check.pragma('user_version', { simple: true }), 4);
    assert.equal(check.prepare("SELECT 1 FROM sqlite_schema WHERE name='therapy_status_commands'").get(), undefined);
    check.close();
});
test('JSON restore unions local postbackup rows; receipt historical and current therapy absent, old execute denied', async () => {
    const before = readTherapyStatusCommandRows(sql), backup = await createBackupArtifact(createEmptyDataset());
    restoreBackupArtifact(backup, () => false);
    assert.deepEqual(readTherapyStatusCommandRows(sql), before);
    assert.equal(sql.prepare('SELECT 1 FROM therapies WHERE id=?').get(applied.therapyId), undefined);
    session = issueSyntheticWebSession({ id: session.userId, username: session.username, role: 'admin' }, 'after-restore');
    const result = readTherapyStatusReceipt(session, applied); assert.equal(result.outcome, 'terminal');
    if (result.outcome === 'terminal') { assert.equal(result.historical, true); assert.equal(result.receipt.outcome, 'applied'); }
    assert.throws(() => executeTherapyStatusCommand(session, { ...applied, target: 'completed' }), /replaced/i);
    assert.deepEqual(readTherapyStatusCommandRows(sql), before);
});
test.after(() => dbServer.$client.close());

for (const phase of ['prepared', 'retired', 'installed', 'validated', 'committed'] as const)
test(`raw crash ${phase} preserves terminal ledger on the declared side`, async () => {
    const { spawnSync } = await import('node:child_process');
    const { pathToFileURL } = await import('node:url');
    const { resolve } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'mediflow-command-swap-crash-')), destination = join(root, 'medical.db'), source = join(root, 'old.db');
    createVerifiedSqliteSnapshotSync(sql.name, destination); openVersionedSqliteDatabase(source).close();
    const before = readTherapyStatusCommandRows(sql);
    const run = spawnSync(process.execPath, ['--import', pathToFileURL(resolve('scripts/register-strip-types-loader.mjs')).href, '--input-type=module', '-e', `
        import Database from 'better-sqlite3';
        import {openVersionedSqliteDatabase} from './lib/sqlite-schema-open.ts';
        import {replaceSqliteDatabase} from './lib/sqlite-repair.ts';
        import {captureTherapyStatusCommands,preserveTherapyStatusCommands} from './lib/therapy-status-command-backup.ts';
        const current=openVersionedSqliteDatabase(process.env.SYNTHETIC_DEST), snapshot=captureTherapyStatusCommands(current);
        await replaceSqliteDatabase({sourcePath:process.env.SYNTHETIC_SOURCE,destPath:process.env.SYNTHETIC_DEST,connection:current,
            prepareReplacement: staging=>{const next=openVersionedSqliteDatabase(staging,undefined,{prepareReplacement:true});preserveTherapyStatusCommands(snapshot,next);next.close();},
            reopenConnection:()=>openVersionedSqliteDatabase(process.env.SYNTHETIC_DEST),
            onPhaseForTest: phase=>{if(phase===process.env.SYNTHETIC_PHASE)process.exit(86);}});`],
        { cwd: resolve('.'), env: { ...process.env, SYNTHETIC_DEST: destination, SYNTHETIC_SOURCE: source, SYNTHETIC_PHASE: phase }, encoding: 'utf8', timeout: 15000 });
    assert.equal(run.status, 86, run.stdout + run.stderr);
    const { recoverSqliteSwapArtifacts } = await import('./sqlite-repair.ts');
    const recovery = recoverSqliteSwapArtifacts(destination); assert.notEqual(recovery.status, 'HOLD');
    const installed = openVersionedSqliteDatabase(destination);
    assert.deepEqual(readTherapyStatusCommandRows(installed), before);
    validateTherapyStatusCommandRows(before, readTherapyCommandAudits(installed)); installed.close();
    if (recovery.status === 'RECOVERED') recovery.complete();
});
