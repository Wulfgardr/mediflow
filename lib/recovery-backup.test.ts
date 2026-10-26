import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { openVersionedSqliteDatabase, CURRENT_SQLITE_SCHEMA_VERSION } from './sqlite-schema-open';
import { readTerritorialPacks, requireTerritorialPack, commitTerritorialPackTransition } from './territorial-pack-store';
import { TERRITORIAL_PACK_SCHEMA } from './territorial-packs';
import { readSqliteArchiveGeneration } from './archive-generation';
import { openAdmittedSqlite } from './sqlite-maintenance-admission.mjs';
import { createRecoverySnapshot, restoreRecoveryBackup } from './recovery-backup-server';
import { encryptRecoveryBackup, decryptRecoveryBackup, parseRecoveryKit, type RecoveryKit } from './recovery-backup';
import { generateMasterKey, encryptData, decryptData } from './security/security';
import { parseNetworkPairingState } from './network-pairing-model';
import { authenticatePairedClientRequest } from './network-paired-client-auth';
import { createUnlockWrapping, createRecoveryWrapping, hashAccessVerifier, openRecoveryWrapping } from './security/unlock-credential';

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const actor = '11111111-1111-4111-8111-111111111111';
const syntheticAccount = 'synthetic-admin';
const review = `review_${'a'.repeat(32)}`;
const event = `event_${'b'.repeat(32)}`;
const command = { action: 'accept', expectedRevision: 1, idempotencyKey: `idem_${'a'.repeat(16)}`,
    gestureProof: `gesture_${'a'.repeat(32)}`, uncertaintyAcknowledged: true };
const outcome = { reviewId: review, state: 'accepted', revision: 2, eventId: event };
const commandDigest = digest(JSON.stringify(['accept', 1, true, digest(command.gestureProof), actor]));
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
function contents(db: Database.Database) {
    const names = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all() as { name: string }[];
    return Object.fromEntries(names.filter(({ name }) => !['archive_generation', 'archive_session_generations'].includes(name))
        .map(({ name }) => [name, db.prepare(`SELECT * FROM ${quote(name)}`).all()]));
}
async function fixture(paddingBytes = 0) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-recovery-'));
    const sourceDir = path.join(root, 'source'); const targetDir = path.join(root, 'target');
    fs.mkdirSync(sourceDir); fs.mkdirSync(targetDir);
    const source = path.join(sourceDir, 'medical.db'); const destination = path.join(targetDir, 'medical.db');
    const db = openVersionedSqliteDatabase(source);
    const key = await generateMasterKey();
    const wrapping = await createUnlockWrapping(key, 'passphrase sintetica di recupero');
    const recovery = await createRecoveryWrapping(key);
    const kit: RecoveryKit = parseRecoveryKit(JSON.stringify({ schemaVersion: 'mediflow.recovery-kit.v1', username: syntheticAccount,
        wrappedMasterKey: recovery.wrappedMasterKey, salt: recovery.salt }));
    db.prepare(`INSERT INTO users(id, username, role, password_hash, encrypted_master_key, salt, unlock_verifier_hash,
        recovery_wrapped_master_key, recovery_salt, recovery_verifier_hash) VALUES (?, ?, 'admin', 'synthetic-confirmation-hash', ?, ?, ?, ?, ?, ?)`)
        .run(actor, kit.username, wrapping.encryptedMasterKey, wrapping.salt, await hashAccessVerifier(wrapping.verifier),
            recovery.wrappedMasterKey, recovery.salt, await hashAccessVerifier(recovery.verifier));
    const sealed = await encryptData('nota clinica sintetica recuperabile', key);
    db.prepare(`INSERT INTO patients (id, first_name, last_name, tax_code, notes, deleted_at, version)
        VALUES ('synthetic-patient', 'Synthetic', 'Recovery', 'SYNTHETIC-RECOVERY', ?, 1783000000, 9)`).run(`ENC:${sealed.iv}:${sealed.data}`);
    db.prepare("INSERT INTO entries(id,patient_id,type,date,content) VALUES ('synthetic-entry','synthetic-patient','note',1783000000,?)").run(`ENC:${sealed.iv}:${sealed.data}`);
    db.prepare("INSERT INTO patient_retired_ids(id) VALUES ('synthetic-retired')").run();
    db.prepare("INSERT INTO patient_duplicate_intents(id) VALUES ('synthetic-consumed-intent')").run();
    db.prepare('INSERT INTO audit_events(event_id,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,subject_ref,source_surface,redacted_metadata) VALUES (?, ?, 1783000000, ?, ?, ?, ?, ?, ?, ?)')
        .run(event, 'ai.review.accepted', 'success', 'user', actor, 'ai_review', review, 'api', JSON.stringify({ flags: ['accept', 'accepted', `digest_${commandDigest}`], resourceVersion: 2 }));
    db.prepare('INSERT INTO durable_review_command_states(review_id,review_state,revision,action) VALUES (?, ?, 2, ?)').run(review, 'accepted', 'accept');
    db.prepare('INSERT INTO durable_review_command_operations(id,review_id,idempotency_key,command_digest,result_snapshot,audit_event_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(digest(`${review}\0${command.idempotencyKey}`), review, command.idempotencyKey, commandDigest, JSON.stringify(outcome), event);
    db.prepare('INSERT INTO archive_session_generations VALUES (?, ?, ?)').run(digest('synthetic-old-session'), readSqliteArchiveGeneration(db), Date.now() + 60000);
    const pairing = JSON.stringify({ archiveGeneration: readSqliteArchiveGeneration(db), intents: [], clients: [{
        clientId: 'synthetic-paired-client', deviceName: 'Synthetic device', clientPlatform: 'ios', appVersion: null,
        grantedCapabilities: ['network.replica.readonly-patients'], pairedAt: '2026-10-11T00:00:00.000Z', lastSeenAt: null,
        sourceIntentId: 'synthetic-intent', tokenHash: digest('synthetic-paired-token'),
    }] });
    assert.ok(authenticatePairedClientRequest(new Request('http://localhost/api/v1/network/patients', { headers: {
        'x-mediflow-paired-client-id': 'synthetic-paired-client', 'x-mediflow-paired-client-token': 'synthetic-paired-token',
    } }), parseNetworkPairingState(pairing).clients));
    db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('network.pairing.state', pairing);
    // Extra tables are intentionally not registered anywhere: a physical backup must preserve them too.
    db.exec("CREATE TABLE synthetic_extension (value TEXT); INSERT INTO synthetic_extension VALUES ('unknown table preserved')");
    if (paddingBytes) {
        db.exec('CREATE TABLE synthetic_padding (value BLOB)');
        db.prepare('INSERT INTO synthetic_padding VALUES (zeroblob(?))').run(paddingBytes);
    }
    db.pragma('wal_autocheckpoint = 0');
    db.prepare("INSERT INTO settings(key,value) VALUES ('synthetic-wal-only','must survive')").run();
    const statusCommand = '21111111-1111-4111-8111-111111111111';
    const statusAudit = { eventId: '31111111-1111-4111-8111-111111111111', schemaVersion: 1, eventType: 'therapy.updated',
        occurredAt: 1783000000, outcome: 'success', actorType: 'user', actorRef: actor, subjectType: 'therapy', subjectRef: 'synthetic-historical-therapy',
        sourceSurface: 'web', requestId: statusCommand, redactedMetadata: JSON.stringify({ changedFields: ['status', 'endDate'], resourceVersion: 2 }), createdAt: 1783000000 };
    db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(statusAudit));
    db.prepare(`INSERT INTO therapy_status_commands VALUES (?, 'therapy.status.change.v1', ?, ?, 'synthetic-patient', 'synthetic-historical-therapy', 1,
        'completed', 'applied', NULL, 1783000000, 2, 1783000000, ?, ?)`).run(statusCommand, readSqliteArchiveGeneration(db), actor, statusAudit.eventId, JSON.stringify(statusAudit));
    db.prepare(`INSERT INTO therapy_status_commands VALUES ('41111111-1111-4111-8111-111111111111', 'therapy.status.change.v1', ?, ?, 'synthetic-patient',
        'synthetic-unreceived-therapy', 1, NULL, 'closed', NULL, 1783000000, NULL, NULL, NULL, NULL)`).run(readSqliteArchiveGeneration(db), actor);
    const snapshot = createRecoverySnapshot(db, actor);
    const resident = await crypto.subtle.importKey('raw', await crypto.subtle.exportKey('raw', key), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const artifact = await encryptRecoveryBackup(snapshot, resident);
    return { root, source, targetDir, destination, db, key: resident, kit, recoveryKey: recovery.recoveryKey, snapshot, artifact,
        restore: (changes: Partial<Parameters<typeof restoreRecoveryBackup>[0]> = {}) => restoreRecoveryBackup({ artifact, kit,
            recoveryKey: recovery.recoveryKey, destination, ...changes }),
        cleanup: () => { if (db.open) db.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('an archive above the former 256 MiB limit encrypts and restores through the full boundary', async () => {
    const padding = 257 * 1024 * 1024;
    const f = await fixture(padding);
    try {
        assert.ok(f.snapshot.length > 256 * 1024 * 1024);
        f.db.close();
        await f.restore();
        const restored = openVersionedSqliteDatabase(f.destination);
        try {
            assert.equal(restored.prepare('SELECT length(value) FROM synthetic_padding').pluck().get(), padding);
            assert.equal(restored.prepare('SELECT hex(substr(value, 1, 16)) FROM synthetic_padding').pluck().get(), '00'.repeat(16));
            const encrypted = restored.prepare('SELECT notes FROM patients').pluck().get() as string;
            const [, iv, ciphertext] = encrypted.split(':');
            assert.equal(await decryptData(ciphertext, iv, f.key), 'nota clinica sintetica recuperabile');
            assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
        } finally { restored.close(); }
    } finally { f.cleanup(); }
});

test('complete encrypted snapshot recovers keys, all tables and replay history into an empty archive', async () => {
    const f = await fixture();
    try {
        assert.equal(Buffer.from(f.artifact).includes(Buffer.from('SYNTHETIC-RECOVERY')), false);
        assert.deepEqual(await decryptRecoveryBackup(f.artifact, f.key), new Uint8Array(f.snapshot));
        const original = contents(f.db); const generation = readSqliteArchiveGeneration(f.db);
        const result = await f.restore();
        assert.notEqual(result.archiveGeneration, generation);
        const restored = openVersionedSqliteDatabase(f.destination);
        try {
            const actual = contents(restored);
            const settings = actual.settings as { key: string; value: string }[];
            assert.deepEqual(settings.filter(row => row.key !== 'territorial.packs'), original.settings);
            assert.deepEqual(readTerritorialPacks(restored), { schemaVersion: TERRITORIAL_PACK_SCHEMA, preset: 'core', revision: 1, status: 'ready' });
            const audits = actual.audit_events as Record<string, unknown>[];
            assert.deepEqual(audits.slice(0, -1), original.audit_events, 'all source audit rows survive byte for byte');
            assert.equal(audits.at(-1)!.event_type, 'territorial.packs.preserved');
            assert.deepEqual({ ...actual, settings: original.settings, audit_events: original.audit_events }, original,
                'every other source table, including ledger and unknown tables, survives unchanged');
            assert.deepEqual(restored.prepare('SELECT * FROM archive_session_generations').all(), []);
            const recovered = await openRecoveryWrapping(f.kit.wrappedMasterKey, f.kit.salt, f.recoveryKey);
            const encrypted = restored.prepare('SELECT notes FROM patients').pluck().get() as string;
            const [, iv, ciphertext] = encrypted.split(':');
            assert.equal(await decryptData(ciphertext, iv, recovered.masterKey), 'nota clinica sintetica recuperabile');
            assert.throws(() => restored.prepare('DELETE FROM audit_events').run(), /append-only/u);
        } finally { restored.close(); }
        const admitted = new Database(f.destination, { readonly: true });
        const installedContents = contents(admitted); admitted.close();
        // Real post-restart command service: replay returns its receipt without consuming a gesture or emitting audit.
        const output = execFileSync(process.execPath, ['--import', pathToFileURL(path.resolve('scripts/register-strip-types-loader.mjs')).href, '--input-type=module', '--eval', `
            import { createPhysicianReviewCommandService } from './lib/ai-providers/fabric/physician-review-command.ts';
            import { sessionMatchesArchive } from './lib/security/archive-session-generation.ts';
            import { loadNetworkPairingState } from './lib/network-home-base-server.ts';
            const forbidden = () => { throw new Error('historical command executed again'); };
            const result = createPhysicianReviewCommandService({ resolveContext: () => ({reviewId:${JSON.stringify(review)}, actorRef:${JSON.stringify(actor)}, uncertaintyAcknowledgmentRequired:true}), consumeGesture:forbidden, eventId:forbidden, now:forbidden }).execute(${JSON.stringify(command)});
            console.log(JSON.stringify({result, oldSession:sessionMatchesArchive({id:'synthetic-old-session', expiresAt:Date.now()+60000}), pairedClients:(await loadNetworkPairingState()).clients.length}));
        `], { cwd: process.cwd(), env: { ...process.env, MEDIFLOW_DATA_DIR: f.targetDir }, encoding: 'utf8' });
        assert.deepEqual(JSON.parse(output.trim()), { result: outcome, oldSession: false, pairedClients: 0 });
        const check = new Database(f.destination, { readonly: true });
        try { assert.deepEqual(contents(check), installedContents, 'replay did not add data or audit'); } finally { check.close(); }
    } finally { f.cleanup(); }
});

test('bad envelope, kit, key, completeness or schema fails before touching destination', async () => {
    const f = await fixture();
    try {
        openVersionedSqliteDatabase(f.destination).close();
        const before = digest(fs.readFileSync(f.destination));
        const changed = new Uint8Array(f.artifact); changed[changed.length - 1] ^= 1;
        const missingTable = path.join(f.root, 'incomplete.db'); fs.writeFileSync(missingTable, f.snapshot);
        const incomplete = new Database(missingTable); incomplete.exec('DROP TABLE entries'); incomplete.close();
        const incompatible = path.join(f.root, 'future.db'); fs.writeFileSync(incompatible, f.snapshot);
        const future = new Database(incompatible); future.pragma(`user_version = ${CURRENT_SQLITE_SCHEMA_VERSION + 1}`); future.close();
        const otherKey = await generateMasterKey(); const otherKit = await createRecoveryWrapping(otherKey);
        for (const changes of [
            { artifact: f.artifact.subarray(0, 100) }, { artifact: changed },
            { recoveryKey: '0000-0000-0000-0000-0000-0000-0000-0000' },
            { kit: { ...f.kit, wrappedMasterKey: otherKit.wrappedMasterKey, salt: otherKit.salt }, recoveryKey: otherKit.recoveryKey },
            { kit: { ...f.kit, username: f.kit.username + '-other' } },
            { artifact: await encryptRecoveryBackup(fs.readFileSync(missingTable), f.key) },
            { artifact: await encryptRecoveryBackup(fs.readFileSync(incompatible), f.key) },
        ]) {
            await assert.rejects(f.restore(changes));
            assert.equal(digest(fs.readFileSync(f.destination)), before);
            assert.deepEqual(fs.readdirSync(f.targetDir), ['medical.db'], 'no mutation, maintenance intent or plaintext staging remains');
        }
    } finally { f.cleanup(); }
});

test('nonempty destination and a live local participant cannot be replaced', async () => {
    const f = await fixture();
    try {
        const empty = openVersionedSqliteDatabase(f.destination); empty.close();
        const participant = openAdmittedSqlite(f.destination, { role: 'synthetic-active-web' });
        const before = digest(fs.readFileSync(f.destination));
        try { await assert.rejects(f.restore()); assert.equal(digest(fs.readFileSync(f.destination)), before); }
        finally { participant.closeSync(); }
        fs.writeFileSync(path.join(f.targetDir, 'local-api-token'), 'synthetic-old-local-authority');
        await assert.rejects(f.restore(), 'an existing local bearer must not acquire the recovered data');
        assert.equal(digest(fs.readFileSync(f.destination)), before);
        fs.unlinkSync(path.join(f.targetDir, 'local-api-token'));
        const prior = process.env.MEDIFLOW_LOCAL_API_TOKEN;
        try {
            process.env.MEDIFLOW_LOCAL_API_TOKEN = 'synthetic-environment-authority';
            await assert.rejects(f.restore());
            assert.equal(digest(fs.readFileSync(f.destination)), before);
        } finally { if (prior === undefined) delete process.env.MEDIFLOW_LOCAL_API_TOKEN; else process.env.MEDIFLOW_LOCAL_API_TOKEN = prior; }
        const occupied = new Database(f.destination); occupied.prepare("INSERT INTO settings VALUES ('synthetic-data','keep')").run(); occupied.close();
        const nonempty = digest(fs.readFileSync(f.destination));
        await assert.rejects(f.restore()); assert.equal(digest(fs.readFileSync(f.destination)), nonempty);
    } finally { f.cleanup(); }
});

test('initialized empty destination accepts encrypted recovery while preserving host core', async () => {
    const f = await fixture();
    try {
        openVersionedSqliteDatabase(f.destination).close();
        commitTerritorialPackTransition(f.db, { schemaVersion: TERRITORIAL_PACK_SCHEMA, preset: 'core+it+lom',
            expectedRevision: 0, confirmed: true }, { actorType: 'system', actorRef: 'synthetic-source', sourceSurface: 'job' }, () => {});
        const artifact = await encryptRecoveryBackup(createRecoverySnapshot(f.db, actor), f.key);
        await f.restore({ artifact });
        const installed = openVersionedSqliteDatabase(f.destination);
        try {
            assert.equal(readTerritorialPacks(installed).preset, 'core');
            assert.equal(readTerritorialPacks(installed).revision, 1);
            assert.throws(() => installed.transaction(() => requireTerritorialPack(installed, 'lom')).immediate(), /pack_disabled/);
            assert.equal(installed.prepare("SELECT count(*) FROM audit_events WHERE event_type='territorial.packs.preserved'").pluck().get(), 1);
        } finally { installed.close(); }
    } finally { f.cleanup(); }
});

for (const mutation of ['extra-setting', 'changed-marker', 'extra-audit', 'changed-audit', 'authority', 'clinical', 'unknown-table'])
test(`initialized destination rejects ${mutation} without changing any bytes`, async () => {
    const f = await fixture();
    try {
        const target = openVersionedSqliteDatabase(f.destination);
        if (mutation === 'extra-setting') target.exec("INSERT INTO settings VALUES ('synthetic-extra','keep')");
        if (mutation === 'changed-marker') target.exec("UPDATE settings SET value='{}'");
        if (mutation === 'extra-audit') target.exec("INSERT INTO audit_events SELECT '11111111-1111-4111-8111-111111111111',schema_version,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,subject_ref,source_surface,request_id,redacted_metadata,created_at FROM audit_events");
        if (mutation === 'changed-audit') { target.exec('DROP TRIGGER audit_events_no_update'); target.exec("UPDATE audit_events SET actor_ref='synthetic-other'"); }
        if (mutation === 'authority') commitTerritorialPackTransition(target, { schemaVersion: TERRITORIAL_PACK_SCHEMA,
            preset: 'core+it', expectedRevision: 0, confirmed: true }, { actorType: 'system', actorRef: 'synthetic', sourceSurface: 'job' }, () => {});
        if (mutation === 'clinical') target.exec("INSERT INTO patients(id,first_name,last_name,tax_code) VALUES ('synthetic','Synthetic','Patient','SYNTHETIC')");
        if (mutation === 'unknown-table') target.exec("CREATE TABLE synthetic_extra(value TEXT); INSERT INTO synthetic_extra VALUES ('keep')");
        target.close();
        const before = digest(fs.readFileSync(f.destination));
        await assert.rejects(f.restore(), /RECOVERY_BACKUP_PREFLIGHT_FAILED/);
        assert.equal(digest(fs.readFileSync(f.destination)), before);
    } finally { f.cleanup(); }
});

for (const alteration of ['none', 'column', 'index', 'trigger', 'extra-table', 'wrong-version', 'v5-missing-ledger'] as const)
test(`therapy command predecessor encrypted v4 recovery ${alteration}`, async () => {
    const f = await fixture();
    try {
        const oldFile = path.join(path.dirname(f.source), 'v4-snapshot.db');
        fs.writeFileSync(oldFile, f.snapshot);
        const old = new Database(oldFile);
        old.exec('DROP TABLE synthetic_extension; DROP TABLE therapy_status_commands; PRAGMA user_version=4;');
        if (alteration === 'extra-table') old.exec('CREATE TABLE synthetic_extension(value TEXT)');
        if (alteration === 'column') old.exec('ALTER TABLE therapies ADD COLUMN synthetic_drift TEXT');
        if (alteration === 'index') old.exec('CREATE INDEX synthetic_drift ON therapies(status)');
        if (alteration === 'trigger') old.exec("CREATE TRIGGER synthetic_drift BEFORE UPDATE ON therapies BEGIN SELECT RAISE(IGNORE); END");
        if (alteration === 'wrong-version') old.pragma('user_version=3');
        if (alteration === 'v5-missing-ledger') old.pragma('user_version=5');
        old.pragma('wal_checkpoint(TRUNCATE)'); old.pragma('journal_mode=DELETE');
        const expected = contents(old); old.close();
        const original = fs.readFileSync(oldFile), before = digest(original);
        const artifact = await encryptRecoveryBackup(original, f.key);
        if (alteration !== 'none') {
            await assert.rejects(f.restore({ artifact }));
            assert.equal(fs.existsSync(f.destination), false);
        } else {
            await f.restore({ artifact });
            const installed = openVersionedSqliteDatabase(f.destination);
            try {
                const result = contents(installed);
                assert.deepEqual(installed.prepare('SELECT * FROM therapy_status_commands').all(), []);
                assert.deepEqual(result.users, expected.users);
                assert.deepEqual(result.patients, expected.patients);
                assert.deepEqual(result.durable_review_command_operations, expected.durable_review_command_operations);
                assert.deepEqual((result.audit_events as unknown[]).slice(0, -1), expected.audit_events);
                assert.equal(installed.pragma('user_version', { simple: true }), 5);
            } finally { installed.close(); }
        }
        assert.equal(digest(fs.readFileSync(oldFile)), before);
        assert.equal(digest(await decryptRecoveryBackup(artifact, f.key)), before);
    } finally { f.cleanup(); }
});
