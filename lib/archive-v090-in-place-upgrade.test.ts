// Un archivio scritto dalla 0.9.0 pubblicata si aggiorna sul posto allo schema corrente.
// L'archivio è quello dentro il backup cifrato di lib/fixtures/archive-v090, prodotto dal
// codice del tag (la copia che la 0.9.0 mette nel backup). La copia schema-original-v3 è ciò che permette il ritorno alla
// 0.9.0: qui si prova che è l'archivio di partenza, riga per riga.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { schemaSnapshot } from './sqlite-schema-shape';
import { openVersionedSqliteDatabase, CURRENT_SQLITE_SCHEMA_VERSION } from './sqlite-schema-open';
import { deriveUnlockMaterial, hashAccessVerifier, openRecoveryWrapping, openUnlockWrapping } from './security/unlock-credential';
import { decryptData } from './security/security';
import { readTerritorialPacks, requireTerritorialPack } from './territorial-pack-store';
import { decryptRecoveryBackup, type RecoveryKit } from './recovery-backup';
import { prostheticsIdentity } from './reference-data/prosthetics-catalog-contract';

const fixtureRoot = path.resolve('lib/fixtures/archive-v090');
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'fixture.json'), 'utf8')) as
    { kit: RecoveryKit; recoveryKey: string; passphrase: string; noteText: string; attachmentText: string };
const V090_SCHEMA_FINGERPRINT = 'f7a926813c169edfd7c75ce5e6a1d1b9f5b1e9201c7a20456dc557b943bbaac5';
type Row = Record<string, unknown>;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const byJson = (rows: Row[]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
function tables(db: Database.Database): Record<string, Row[]> {
    return Object.fromEntries((db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all() as { name: string }[])
        .map(({ name }) => [name, byJson(db.prepare(`SELECT * FROM ${quote(name)}`).all() as Row[])]));
}
function readOnly<T>(file: string, read: (db: Database.Database) => T): T {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try { return read(db); } finally { db.close(); }
}
function originals(directory: string) { return fs.readdirSync(directory).filter(name => name.includes('.schema-original-')); }
const artifact = fs.readFileSync(path.join(fixtureRoot, 'backup-v090.mediflow-recovery'));
let archive: Promise<Uint8Array> | undefined;
/** A data folder holding the 0.9.0 archive, decrypted from the 0.9.0 backup with the recovery key. */
async function dataFolder() {
    archive ??= openRecoveryWrapping(fixture.kit.wrappedMasterKey, fixture.kit.salt, fixture.recoveryKey)
        .then(({ masterKey }) => decryptRecoveryBackup(artifact, masterKey));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-archive-v090-'));
    const file = path.join(directory, 'medical.db');
    fs.writeFileSync(file, await archive, { mode: 0o600 });
    return { directory, file, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

// The only changes the upgrade may make to an archive born in 0.9.0. Anything else fails.
const DROPPED_EMPTY_TABLES = ['durable_review_command_operations', 'durable_review_command_states', 'durable_review_operations',
    'durable_review_patient_links', 'durable_review_records', 'headless_soap_active_role_attestations', 'headless_soap_entry_commits'];
const NEW_TABLES: Record<string, number> = { ambulatory_destructive_commands: 0, therapy_status_commands: 0, prosthetics_catalog_documents: 0,
    prosthetics_catalog_sources: 1, portable_import_origins: 1 };
const NEW_COLUMNS: Record<string, string[]> = {
    patients: ['identifier_type', 'birth_date_precision', 'birth_year', 'identifier_history', 'allergies'],
    entries: ['recorded_by'], prosthetic_prescriptions: ['catalog_snapshot'], prosthetics_catalog_entries: ['source_id'],
};
const NEW_SETTINGS = ['territorial.packs', 'territorial.packs.initialization'];
const NEW_AUDIT_EVENTS = ['backup.provenance.unattested', 'territorial.packs.migrated'];
// Catalog rows are rekeyed under their source (schema 4); every other field stays.
function expectedRow(name: string, row: Row): Row {
    if (name !== 'prosthetics_catalog_entries') return row;
    return { ...row, id: prostheticsIdentity({ source: row.source as string, version: row.version as string, scope: row.scope as string,
        codeSystem: row.code_system as string, code: row.code as string }) };
}

test('archive-v090: the fixture is the published 0.9.0 schema 3 with its frozen fingerprint', async () => {
    // No plaintext database enters the source tree: the build input guard refuses one.
    assert.deepEqual(fs.readdirSync(fixtureRoot).sort(), ['README.md', 'backup-v090.mediflow-recovery', 'fixture.json']);
    const readme = fs.readFileSync(path.join(fixtureRoot, 'README.md'), 'utf8');
    const recorded = (label: string, bytes: Uint8Array) => {
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        assert.ok(readme.includes(`\`${sha256}\``), `${label}: hash ${sha256} recorded in README`);
    };
    // The bytes are the ones the README records as produced by the tag code.
    for (const name of ['backup-v090.mediflow-recovery', 'fixture.json']) recorded(name, fs.readFileSync(path.join(fixtureRoot, name)));
    const w = await dataFolder();
    try {
        recorded('archive inside the backup', fs.readFileSync(w.file));
        readOnly(w.file, db => {
            assert.equal(db.pragma('user_version', { simple: true }), 3);
            assert.equal(digest(JSON.stringify(schemaSnapshot(db))), V090_SCHEMA_FINGERPRINT);
            assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
            const counts = Object.fromEntries(['patients', 'entries', 'therapies', 'attachments', 'audit_events', 'prosthetics_catalog_receipts', 'users']
                .map(name => [name, db.prepare(`SELECT count(*) FROM ${name}`).pluck().get()]));
            assert.deepEqual(counts, { patients: 3, entries: 1, therapies: 1, attachments: 1, audit_events: 1, prosthetics_catalog_receipts: 1, users: 1 });
        });
    } finally { w.cleanup(); }
});

test('archive-v090: in-place upgrade keeps a verified schema 3 original equal to the starting archive and every prior field', async () => {
    const w = await dataFolder();
    try {
        const before = readOnly(w.file, tables);
        const opened = openVersionedSqliteDatabase(w.file);
        let after: Record<string, Row[]>;
        try {
            assert.equal(opened.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
            assert.equal(opened.pragma('integrity_check', { simple: true }), 'ok');
            assert.deepEqual(opened.pragma('foreign_key_check'), []);
            after = tables(opened);

            // The audit trail is still append-only after the upgrade.
            assert.throws(() => opened.prepare('DELETE FROM audit_events').run(), /append-only/);
            assert.throws(() => opened.prepare("UPDATE audit_events SET outcome='failure' WHERE event_id='v090-audit'").run(), /append-only/);

            // Archive born in 0.9.0: Italy and Lombardy packs on, so SISS functions stay available (#825).
            const packs = readTerritorialPacks(opened);
            assert.equal(packs.status, 'ready');
            assert.equal(packs.preset, 'core+it+lom');
            opened.transaction(() => { requireTerritorialPack(opened, 'it'); requireTerritorialPack(opened, 'lom'); })();
        } finally { opened.close(); }

        // 1. The original: one verified copy, schema 3, same fingerprint, same rows as the archive we started from.
        const names = originals(w.directory);
        assert.equal(names.length, 1);
        assert.match(names[0], /^medical\.db\.schema-original-v3-[0-9a-f-]{36}\.db$/u);
        readOnly(path.join(w.directory, names[0]), original => {
            assert.equal(original.pragma('user_version', { simple: true }), 3);
            assert.equal(digest(JSON.stringify(schemaSnapshot(original))), V090_SCHEMA_FINGERPRINT);
            assert.equal(original.pragma('integrity_check', { simple: true }), 'ok');
            const copied = tables(original);
            assert.deepEqual(Object.keys(copied), Object.keys(before));
            for (const name of Object.keys(before))
                assert.equal(digest(JSON.stringify(copied[name])), digest(JSON.stringify(before[name])), `${name}: original copy content`);
        });

        // 2. Every pre-existing table and row survives field by field; only the listed changes happen.
        const expectedTables = [...Object.keys(before).filter(name => !DROPPED_EMPTY_TABLES.includes(name)), ...Object.keys(NEW_TABLES)].sort();
        assert.deepEqual(Object.keys(after).sort(), expectedTables);
        for (const name of DROPPED_EMPTY_TABLES) assert.deepEqual(before[name], [], `${name} was empty before it was dropped`);
        for (const [name, count] of Object.entries(NEW_TABLES)) assert.equal(after[name].length, count, `${name} rows`);
        for (const [name, sourceRows] of Object.entries(before)) {
            if (DROPPED_EMPTY_TABLES.includes(name)) continue;
            const columns = Object.keys(after[name][0] ?? sourceRows[0] ?? {});
            const added = columns.filter(column => sourceRows[0] && !(column in sourceRows[0]));
            assert.deepEqual(added, NEW_COLUMNS[name] ?? [], `${name}: added columns`);
            const kept = after[name].filter(row => name === 'settings' ? !NEW_SETTINGS.includes(row.key as string)
                : name === 'audit_events' ? !NEW_AUDIT_EVENTS.includes(row.event_type as string) : true);
            assert.equal(after[name].length - kept.length, name === 'settings' ? NEW_SETTINGS.length : name === 'audit_events' ? NEW_AUDIT_EVENTS.length : 0, `${name}: added rows`);
            const projected = byJson(kept.map(row => Object.fromEntries(Object.keys(sourceRows[0] ?? {}).map(column => [column, row[column]]))));
            assert.deepEqual(projected, byJson(sourceRows.map(row => expectedRow(name, row))), `${name}: every prior row and field`);
        }

        // 3. Values of the new columns and rows.
        const patients = new Map(after.patients.map(row => [row.id, row]));
        assert.equal(patients.get('v090-patient')!.birth_date_precision, 'exact');
        assert.equal(patients.get('v090-patient')!.identifier_type, 'cf');
        assert.equal(patients.get('v090-deleted')!.identifier_type, 'none');
        assert.equal(patients.get('v090-stp')!.identifier_type, 'stp');
        assert.equal(patients.get('v090-stp')!.birth_date_precision, 'unknown');
        assert.equal(after.entries[0].recorded_by, null);
        assert.equal(after.prosthetic_prescriptions[0].catalog_snapshot, null);
        assert.equal(after.prosthetics_catalog_entries[0].source_id, after.prosthetics_catalog_sources[0].id);
        assert.deepEqual(after.portable_import_origins.map(row => [row.kind, row.ref, row.origin]), [['audit', 'v090-audit', 'unattested']]);
        assert.equal(after.prosthetics_catalog_receipts.length, 1);

        // 4. The original passphrase and the recovery key still open the same master key; note and attachment decrypt.
        const user = after.users[0];
        const unlock = await deriveUnlockMaterial(fixture.passphrase, new Uint8Array(Buffer.from(user.salt as string, 'base64')));
        assert.equal(await hashAccessVerifier(unlock.verifier), user.unlock_verifier_hash);
        const byPassphrase = await openUnlockWrapping(user.encrypted_master_key as string, unlock.kek);
        const { masterKey: byRecovery } = await openRecoveryWrapping(fixture.kit.wrappedMasterKey, fixture.kit.salt, fixture.recoveryKey);
        for (const key of [byPassphrase, byRecovery]) {
            const unseal = (value: unknown) => { const [, iv, data] = String(value).split(':'); return decryptData(data, iv, key); };
            assert.equal(await unseal(patients.get('v090-patient')!.notes), fixture.noteText);
            assert.equal(await unseal(after.entries[0].content), fixture.noteText);
            assert.equal(await unseal(after.therapies[0].dosage), fixture.noteText);
            assert.equal(await unseal(after.attachments[0].data), fixture.attachmentText);
        }

        // 5. A second start validates without migrating again or making another copy.
        openVersionedSqliteDatabase(w.file).close();
        assert.equal(originals(w.directory).length, 1);
    } finally { w.cleanup(); }
});

test('archive-v090: a failed upgrade leaves schema 3 untouched, removes the attempt copy and a later start succeeds', async () => {
    const w = await dataFolder();
    try {
        const before = readOnly(w.file, db => ({ rows: tables(db), schema: digest(JSON.stringify(schemaSnapshot(db))) }));
        assert.throws(() => openVersionedSqliteDatabase(w.file, file => {
            const db = new Database(file, { fileMustExist: true }), pragma = db.pragma.bind(db);
            db.pragma = ((sql: string, options?: Database.PragmaOptions) => {
                if (sql === `user_version = ${CURRENT_SQLITE_SCHEMA_VERSION}`) throw new Error('SYNTHETIC_V090_UPGRADE_FAILURE');
                return pragma(sql, options);
            }) as typeof db.pragma;
            return db;
        }), /SYNTHETIC_V090_UPGRADE_FAILURE/);
        readOnly(w.file, db => {
            assert.equal(db.pragma('user_version', { simple: true }), 3);
            assert.equal(digest(JSON.stringify(schemaSnapshot(db))), before.schema);
            assert.deepEqual(tables(db), before.rows);
        });
        assert.deepEqual(originals(w.directory), []);
        const retried = openVersionedSqliteDatabase(w.file);
        assert.equal(retried.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
        retried.close();
        assert.equal(originals(w.directory).length, 1);
    } finally { w.cleanup(); }
});
