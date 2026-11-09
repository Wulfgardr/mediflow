import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { schemaSnapshot } from './sqlite-schema-shape';
import { assertAmbulatoryCommandPredecessorRecoverySchema } from './ambulatory-destructive-command-recovery-schema';
import { restoreRecoveryBackup } from './recovery-backup-server';
import { decryptRecoveryBackup, encryptRecoveryBackup, type RecoveryKit } from './recovery-backup';
import { openRecoveryWrapping } from './security/unlock-credential';
import { decryptData } from './security/security';
import { openVersionedSqliteDatabase, CURRENT_SQLITE_SCHEMA_VERSION } from './sqlite-schema-open';
import { prostheticsIdentity, prostheticsSourceId } from './reference-data/prosthetics-catalog-contract';

// The full encrypted backup made by the published 0.9.0 code (lib/fixtures/archive-v090).
const fixtureRoot = path.resolve('lib/fixtures/archive-v090');
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'fixture.json'), 'utf8')) as { kit: RecoveryKit; recoveryKey: string; noteText: string; attachmentText: string };
const artifact = fs.readFileSync(path.join(fixtureRoot, 'backup-v090.mediflow-recovery'));
let plaintext: Promise<Buffer> | undefined;
/** The SQLite snapshot inside the backup, decrypted with the recovery key. */
function snapshotBytes(): Promise<Buffer> {
    plaintext ??= openRecoveryWrapping(fixture.kit.wrappedMasterKey, fixture.kit.salt, fixture.recoveryKey)
        .then(({ masterKey }) => decryptRecoveryBackup(artifact, masterKey)).then(bytes => Buffer.from(bytes));
    return plaintext;
}
async function withSnapshotFile<T>(read: (file: string) => T): Promise<T> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-archive-v090-snapshot-'));
    try { const file = path.join(root, 'snapshot.db'); fs.writeFileSync(file, await snapshotBytes()); return read(file); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const sorted = (rows: Record<string, unknown>[]) => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
function rows(db: Database.Database) {
    return Object.fromEntries((db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all() as { name: string }[])
        .map(({ name }) => [name, sorted(db.prepare(`SELECT * FROM ${quote(name)}`).all() as Record<string, unknown>[])]));
}
async function withTarget(run: (root: string, destination: string) => Promise<void>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-archive-v090-restore-'));
    try { await run(root, path.join(root, 'medical.db')); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const restore = (destination: string, bytes: Uint8Array = artifact) => restoreRecoveryBackup({ artifact: bytes, kit: fixture.kit, recoveryKey: fixture.recoveryKey, destination });

test('archive-v090: the backup holds schema 3 with the independent frozen fingerprint f7a92681', async () => {
    await withSnapshotFile(file => { const old = new Database(file, { readonly: true });
    try {
        assert.equal(old.pragma('user_version', { simple: true }), 3);
        assert.equal(digest(JSON.stringify(schemaSnapshot(old))), 'f7a926813c169edfd7c75ce5e6a1d1b9f5b1e9201c7a20456dc557b943bbaac5');
        assertAmbulatoryCommandPredecessorRecoverySchema(old);
        assert.equal(old.pragma('integrity_check', { simple: true }), 'ok');
        assert.deepEqual(old.pragma('foreign_key_check'), []);
    } finally { old.close(); } });
});

for (const initialized of [false, true])
test(`archive-v090: full restore, initialized destination=${initialized}: every populated table, ciphertext, key, audit and receipt survives`, async () => {
    await withTarget(async (_root, destination) => {
        if (initialized) openVersionedSqliteDatabase(destination).close();
        const before = await withSnapshotFile(file => { const old = new Database(file, { readonly: true }); try { return rows(old); } finally { old.close(); } });
        const result = await restore(destination);
        const restored = openVersionedSqliteDatabase(destination);
        try {
            assert.equal(restored.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
            assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
            assert.deepEqual(restored.pragma('foreign_key_check'), []);
            const actual = rows(restored);
            for (const [name, sourceRows] of Object.entries(before)) {
                if (name.startsWith('durable_review_') || name.startsWith('headless_soap_')) {
                    assert.deepEqual(sourceRows, [], `${name}: tag-created retired feature was empty`);
                    continue;
                }
                if (name === 'archive_generation') { assert.notDeepEqual(actual[name], sourceRows); continue; }
                if (name === 'archive_session_generations') { assert.deepEqual(actual[name], []); continue; }
                const preserved = sourceRows.map(row => {
                    if (name !== 'prosthetics_catalog_entries') return row;
                    const identity = { source: row.source as string, version: row.version as string, scope: row.scope as string, codeSystem: row.code_system as string, code: row.code as string };
                    return { ...row, id: prostheticsIdentity(identity) };
                });
                const projected = actual[name].filter(row => sourceRows.some(oldRow => name === 'settings' ? oldRow.key === row.key : name === 'audit_events' ? oldRow.event_id === row.event_id : true))
                    .map(row => Object.fromEntries(Object.keys(sourceRows[0] ?? {}).map(key => [key, row[key]])));
                assert.deepEqual(sorted(projected), sorted(preserved), `${name}: every source field survives the defined migration`);
            }
            assert.equal(result.username, fixture.kit.username);
            assert.equal(actual.archive_generation[0].generation, result.archiveGeneration);
            assert.equal(actual.prosthetics_catalog_entries[0].source_id, prostheticsSourceId({ source: 'Fonte sintetica', version: 'v1', scope: 'Dimostrazione' }));
            assert.equal(actual.prosthetic_prescriptions[0].catalog_snapshot, null);
            assert.equal(actual.entries[0].recorded_by, null);
            const patients = new Map(actual.patients.map(row => [row.id, row]));
            assert.equal(patients.get('v090-patient')!.birth_date_precision, 'exact');
            assert.equal(patients.get('v090-deleted')!.identifier_type, 'none');
            assert.equal(patients.get('v090-stp')!.identifier_type, 'stp');
            assert.equal(patients.get('v090-stp')!.birth_date_precision, 'unknown');
            assert.deepEqual(actual.therapy_status_commands, []);
            assert.deepEqual(actual.ambulatory_destructive_commands, []);
            const { masterKey } = await openRecoveryWrapping(fixture.kit.wrappedMasterKey, fixture.kit.salt, fixture.recoveryKey);
            const unseal = async (v: unknown) => { const [, iv, ciphertext] = String(v).split(':'); return decryptData(ciphertext, iv, masterKey); };
            assert.equal(await unseal(patients.get('v090-patient')!.notes), fixture.noteText);
            assert.equal(await unseal(actual.attachments[0].data), fixture.attachmentText);
            assert.throws(() => restored.prepare('DELETE FROM audit_events').run(), /append-only/);
        } finally { restored.close(); }
        assert.equal(digest(fs.readFileSync(path.join(fixtureRoot, 'backup-v090.mediflow-recovery'))), digest(artifact));
    });
});

const mutations: [string, (db: Database.Database) => void][] = [
    ['missing-patients', db => db.exec('PRAGMA foreign_keys=OFF; DROP TABLE patients')],
    ['missing-attachments', db => db.exec('DROP TABLE attachments')],
    ['missing-retired-table', db => db.exec('DROP TABLE durable_review_command_operations')],
    ['missing-column', db => db.exec('ALTER TABLE therapies DROP COLUMN motivation')],
    ['added-column', db => db.exec('ALTER TABLE patients ADD COLUMN synthetic_drift TEXT')],
    ['added-source-column', db => db.exec("ALTER TABLE prosthetics_catalog_entries ADD COLUMN source_id TEXT NOT NULL DEFAULT ''")],
    ['added-prescription-column', db => db.exec('ALTER TABLE prosthetic_prescriptions ADD COLUMN catalog_snapshot TEXT')],
    ['added-index', db => db.exec('CREATE INDEX synthetic_drift ON patients(last_name)')],
    ['missing-index', db => db.exec('DROP INDEX attachments_patient_idx')],
    ['added-trigger', db => db.exec('CREATE TRIGGER synthetic_drift BEFORE INSERT ON entries BEGIN SELECT RAISE(IGNORE); END')],
    ['missing-audit-trigger', db => db.exec('DROP TRIGGER audit_events_no_delete')],
    ['added-view', db => db.exec('CREATE VIEW synthetic_drift AS SELECT id FROM patients')],
    ['added-unknown-table', db => db.exec('CREATE TABLE synthetic_drift(value TEXT)')],
    ['added-prosthetics-source', db => db.exec('CREATE TABLE prosthetics_catalog_sources(id TEXT PRIMARY KEY)')],
    ['added-prosthetics-document', db => db.exec('CREATE TABLE prosthetics_catalog_documents(id TEXT PRIMARY KEY)')],
    ['added-therapy-ledger', db => db.exec('CREATE TABLE therapy_status_commands(id TEXT PRIMARY KEY)')],
    ['added-ambulatory-ledger', db => db.exec('CREATE TABLE ambulatory_destructive_commands(id TEXT PRIMARY KEY)')],
    ['added-import-authority', db => db.exec('CREATE TABLE portable_import_origins(id TEXT PRIMARY KEY)')],
    ['foreign-key-orphan', db => db.exec("PRAGMA foreign_keys=OFF; UPDATE attachments SET patient_id='v090-absent'")],
    ...[0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(version => [`false-version-${version}`, (db: Database.Database) => db.pragma(`user_version=${version}`)] as [string, (db: Database.Database) => void]),
];

for (const [name, mutate] of mutations)
test(`archive-v090: encrypted mutated candidate denies ${name} without changing destination`, async () => {
    await withTarget(async (root, destination) => {
        const candidate = path.join(root, 'mutated.db'); fs.writeFileSync(candidate, await snapshotBytes());
        const db = new Database(candidate);
        try { mutate(db); } finally { db.close(); }
        const { masterKey } = await openRecoveryWrapping(fixture.kit.wrappedMasterKey, fixture.kit.salt, fixture.recoveryKey);
        const altered = await encryptRecoveryBackup(fs.readFileSync(candidate), masterKey);
        openVersionedSqliteDatabase(destination).close();
        const before = fs.readFileSync(destination);
        await assert.rejects(restore(destination, altered));
        assert.deepEqual(fs.readFileSync(destination), before);
        assert.deepEqual(fs.readdirSync(root).sort(), ['medical.db', 'mutated.db']);
    });
});

test('archive-v090: envelope denies bit flips in every envelope region and truncation before creating a destination', async () => {
    await withTarget(async (root, destination) => {
        for (const index of [0, 8, 20, 67, 68, 79, 80, artifact.length - 1]) {
            const changed = Buffer.from(artifact); changed[index] ^= 1;
            await assert.rejects(restore(destination, changed), /RECOVERY_BACKUP_INVALID/);
            assert.deepEqual(fs.readdirSync(root), []);
        }
        for (const end of [0, 79, 95, 100, artifact.length - 1]) {
            await assert.rejects(restore(destination, artifact.subarray(0, end)), /RECOVERY_BACKUP_INVALID/);
            assert.deepEqual(fs.readdirSync(root), []);
        }
    });
});

test('archive-v090: encrypted corrupt or truncated SQLite pages deny before changing destination', async () => {
    await withTarget(async (root, destination) => {
        const { masterKey } = await openRecoveryWrapping(fixture.kit.wrappedMasterKey, fixture.kit.salt, fixture.recoveryKey);
        const snapshot = await snapshotBytes();
        const corrupt = Buffer.from(snapshot); corrupt[100] = 0xff;
        openVersionedSqliteDatabase(destination).close();
        const before = fs.readFileSync(destination);
        for (const bytes of [snapshot.subarray(0, snapshot.length - 4096), snapshot.subarray(0, 100), corrupt]) {
            const altered = await encryptRecoveryBackup(bytes, masterKey);
            await assert.rejects(restore(destination, altered));
            assert.deepEqual(fs.readFileSync(destination), before);
            assert.deepEqual(fs.readdirSync(root), ['medical.db']);
        }
    });
});
