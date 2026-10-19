/* WUL-579: the real notes writer and complete C15 recovery, with synthetic data only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { installNetworkPatientCookieFixture } from './network-patient-authority-test-fixture';
import { issueSyntheticWebSessionContext } from './security/web-auth-lifecycle-owner-test-fixture';
import { clearAllSessions } from './security/server-session';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { ArchiveReplacedError } from './archive-generation';
import { readProfileNotesCommitReceipt } from './security/patient-profile-notes-commit-journal';
import { ambulatories, patients, patientsToAmbulatories, users } from './schema';
import { isProfileNotesCommitReceipt, isProfileNotesCommitView } from './patient-profile-notes-commit-contract';
import { decryptData, encryptData, generateMasterKey } from './security/security';
import { createRecoveryWrapping, createUnlockWrapping, hashAccessVerifier, openRecoveryWrapping } from './security/unlock-credential';
import { encryptRecoveryBackup, type RecoveryKit } from './recovery-backup';
import { createRecoverySnapshot, restoreRecoveryBackup } from './recovery-backup-server';
import { openVersionedSqliteDatabase } from './sqlite-schema-open';

const load = createRequire(import.meta.url);
const sourceDir = mkdtempSync(join(tmpdir(), 'mediflow-profile-review-recovery-source-'));
process.env.MEDIFLOW_DATA_DIR = sourceDir;
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
openDbServer();
const cookieState = { cookies: new Map<string, string>() };
const cleanupCookies = installNetworkPatientCookieFixture(sourceDir, cookieState);
const commitRoute = load('../app/api/patients/[id]/notes-commit/route.ts') as typeof import('../app/api/patients/[id]/notes-commit/route');
const ordinaryRoute = load('../app/api/patients/[id]/route.ts') as typeof import('../app/api/patients/[id]/route');
const queryRoute = load('../app/api/patients/[id]/profile-query/route.ts') as typeof import('../app/api/patients/[id]/profile-query/route');
const { createPhysicianReviewAttestationStore } = load('./security/physician-review-attestation-store.ts') as typeof import('./security/physician-review-attestation-store');
const SYNTHETIC_USER = 'synthetic-review-user';
const SYNTHETIC_ADMIN = 'synthetic-recovery-admin';
const SYNTHETIC_OTHER_USER = 'synthetic-other-user';
const user = { id: SYNTHETIC_USER, username: SYNTHETIC_USER, role: 'user' };
const PIN = '3817';
const patientId = 'synthetic-patient-a';
const context = { params: Promise.resolve({ id: patientId }) };
const destinations: string[] = [];

function request(body: unknown) {
    return new Request(`http://127.0.0.1/api/patients/${patientId}/notes-commit`, { method: 'POST', headers: {
        'content-type': 'application/json', origin: 'http://127.0.0.1', 'sec-fetch-site': 'same-origin',
        'x-mediflow-archive-generation': currentArchiveGeneration(),
    }, body: JSON.stringify(body) });
}
function login(suffix: string) {
    const session = issueSyntheticWebSessionContext(user, suffix);
    cookieState.cookies.set('mediflow_session', session.session.id);
    cookieState.cookies.set('mediflow_auth_control', session.controlId);
    cookieState.cookies.set('ambulatory_id', 'synthetic-scope');
    return session;
}
async function prepare(notes: string | null, revision: number) {
    const selected = await queryRoute.POST(request({ kind: 'open', contractVersion: 1, projection: 'notes', expectedSelectionEpoch: 0 }), context);
    assert.equal(selected.status, 200, await selected.clone().text());
    const selectedBody = await selected.json();
    const response = await commitRoute.POST(request({ kind: 'prepare', notes, expectedRevision: revision,
        expectedSelectionEpoch: selectedBody.currentness.selectionEpoch }), context);
    assert.equal(response.status, 200, await response.clone().text());
    const view: unknown = await response.json(); assert.ok(isProfileNotesCommitView(view)); return view;
}
function contents(db: Database.Database) {
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all() as { name: string }[];
    return Object.fromEntries(tables.filter(({ name }) => !['archive_generation', 'archive_session_generations'].includes(name))
        .map(({ name }) => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()]));
}
function readTarget(directory: string) {
    const db = new Database(join(directory, 'medical.db'), { readonly: true });
    try { return contents(db); } finally { db.close(); }
}
function target(stage: string) {
    const directory = mkdtempSync(join(tmpdir(), `mediflow-profile-review-recovery-${stage}-`));
    destinations.push(directory); return directory;
}
function restoredProcess(directory: string, input: Record<string, unknown>) {
    const output = execFileSync(process.execPath, ['--experimental-strip-types', '--import',
        fileURLToPath(new URL('../scripts/register-strip-types-loader.mjs', import.meta.url)),
        fileURLToPath(new URL('./patient-profile-notes-commit-process.fixture.ts', import.meta.url)), 'recovery'], {
        env: { ...process.env, MEDIFLOW_DATA_DIR: directory, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', MEDIFLOW_TEST_PROFILE_NOTES_PROCESS: '1' },
        input: JSON.stringify(input), encoding: 'utf8', timeout: 20_000,
    });
    return JSON.parse(output.trim()) as Record<string, { status: number; body: Record<string, unknown> }>;
}
test.after(() => {
    clearAllSessions(); cleanupCookies(); dbServer.$client.close();
    for (const directory of [sourceDir, ...destinations]) rmSync(directory, { recursive: true, force: true });
});

test('complete pilot recovery preserves all snapshots and the committed receipt without restoring authority', { timeout: 90_000 }, async () => {
    const key = await generateMasterKey();
    const wrapping = await createUnlockWrapping(key, 'passphrase sintetica del recovery');
    const recovery = await createRecoveryWrapping(key);
    const admin = { id: SYNTHETIC_ADMIN, username: SYNTHETIC_ADMIN, role: 'admin' };
    const kit: RecoveryKit = { schemaVersion: 'mediflow.recovery-kit.v1', username: admin.username,
        wrappedMasterKey: recovery.wrappedMasterKey, salt: recovery.salt };
    const credentials = { passwordHash: bcrypt.hashSync(PIN, 4), encryptedMasterKey: wrapping.encryptedMasterKey, salt: wrapping.salt,
        unlockVerifierHash: await hashAccessVerifier(wrapping.verifier), recoveryWrappedMasterKey: recovery.wrappedMasterKey,
        recoverySalt: recovery.salt, recoveryVerifierHash: await hashAccessVerifier(recovery.verifier) };
    dbServer.insert(users).values([{ ...user, ...credentials }, { ...admin, ...credentials, passwordHash: bcrypt.hashSync('7392', 4) },
        { id: SYNTHETIC_OTHER_USER, username: SYNTHETIC_OTHER_USER, role: 'user', ...credentials,
            passwordHash: bcrypt.hashSync('6258', 4) }]).run();
    dbServer.insert(ambulatories).values([
        { id: 'synthetic-scope', name: 'Synthetic scope', type: 'live', isDefault: true },
        { id: 'synthetic-other-scope', name: 'Synthetic other scope', type: 'live' },
    ]).run();
    async function seal(text: string) { const sealed = await encryptData(text, key); return `ENC:${sealed.iv}:${sealed.data}`; }
    const initialNotes = await seal('Nota sintetica prima del pilota.');
    const committedNotes = await seal('Nota sintetica salvata dal pilota, è già riveduta.');
    const otherCiphertext = await seal('Campo sintetico da conservare byte per byte.');
    dbServer.insert(patients).values({ id: patientId, firstName: 'Ada', lastName: 'Sintetica', taxCode: 'SYNTHETIC-ONLY',
        birthDate: new Date(0), ambulatoryId: 'synthetic-scope', version: 4, notes: initialNotes, address: otherCiphertext, isArchived: false }).run();
    dbServer.insert(patientsToAmbulatories).values(['synthetic-scope', 'synthetic-other-scope'].map(ambulatoryId => ({ patientId, ambulatoryId }))).run();
    dbServer.$client.prepare("INSERT INTO entries(id,patient_id,type,date,content) VALUES ('synthetic-recovery-entry',?,'note',1783000000,?)")
        .run(patientId, otherCiphertext);
    const attestation = createPhysicianReviewAttestationStore(); attestation.createInactive(user.id); attestation.activate(user.id);
    login('recovery-source-commit');
    const before = contents(dbServer.$client);
    const beforeArtifact = await encryptRecoveryBackup(createRecoverySnapshot(dbServer.$client, admin.id), key);
    const view = await prepare(committedNotes, 4);
    const confirm = { kind: 'confirm', reference: view.reference, digest: view.digest, candidatePin: PIN };
    const committed = await commitRoute.POST(request(confirm), context);
    assert.equal(committed.status, 200, await committed.clone().text());
    const receipt: unknown = await committed.json(); assert.ok(isProfileNotesCommitReceipt(receipt));
    assert.equal(receipt.previousRevision, 4); assert.equal(receipt.revision, 5);
    // A later existing lifecycle operation must survive recovery without changing the historical receipt.
    const archived = await ordinaryRoute.PUT(request({ version: 5, isArchived: true, archiveReason: 'other', archiveNote: otherCiphertext }), context);
    assert.equal(archived.status, 200, await archived.clone().text());
    const archivedState = contents(dbServer.$client);
    const archivedArtifact = await encryptRecoveryBackup(createRecoverySnapshot(dbServer.$client, admin.id), key);
    const unarchived = await ordinaryRoute.PUT(request({ version: 6, isArchived: false }), context);
    assert.equal(unarchived.status, 200, await unarchived.clone().text());
    const inverseRead = await ordinaryRoute.GET(request(null), context);
    assert.equal(inverseRead.status, 200, await inverseRead.clone().text());
    const inverse = await inverseRead.json();
    assert.equal(inverse.version, 7); assert.equal(inverse.isArchived, false);
    assert.equal(inverse.archiveReason, null); assert.equal(inverse.archiveNote, null);
    const oldSession = login('recovery-source-pending');
    const pending = await prepare(null, 7);
    const generation = currentArchiveGeneration();
    const after = contents(dbServer.$client);
    const afterArtifact = await encryptRecoveryBackup(createRecoverySnapshot(dbServer.$client, admin.id), key);
    assert.ok(pending.expiresAt > Date.now(), 'the source preparation is still pending at the backup boundary');
    const input = { reference: view.reference, digest: view.digest, pending: { reference: pending.reference, digest: pending.digest },
        oldSession: { id: oldSession.session.id, expiresAt: oldSession.session.expiresAt, controlId: oldSession.controlId }, oldGeneration: generation };

    const previousToken = process.env.MEDIFLOW_LOCAL_API_TOKEN;
    delete process.env.MEDIFLOW_LOCAL_API_TOKEN;
    try {
        let afterDirectory = '';
        for (const [stage, artifact, expected, version, notes, isArchived] of [
            ['before', beforeArtifact, before, 4, initialNotes, false],
            ['archived', archivedArtifact, archivedState, 6, committedNotes, true],
            ['after', afterArtifact, after, 7, committedNotes, false],
        ] as const) {
            const hasReceipt = stage !== 'before';
            const directory = target(stage); if (stage === 'after') afterDirectory = directory;
            const restored = await restoreRecoveryBackup({ artifact, kit, recoveryKey: recovery.recoveryKey, destination: join(directory, 'medical.db') });
            assert.notEqual(restored.archiveGeneration, generation);
            assert.deepEqual(readTarget(directory), expected, 'all durable tables and ciphertext survive unchanged');
            const database = new Database(join(directory, 'medical.db'), { readonly: true });
            try { assert.deepEqual(database.prepare('SELECT * FROM archive_session_generations').all(), []); }
            finally { database.close(); }
            const result = restoredProcess(directory, input);
            assert.equal(result.oldSession.status, 401); assert.equal(result.oldGeneration.status, 409);
            assert.equal(result.pending.status, 409); assert.equal(result.scope.status, hasReceipt ? 409 : 503);
            assert.equal(result.actor.status, hasReceipt ? 409 : 503);
            assert.equal(result.legacy.status, 200); assert.equal(result.scoped.status, 200);
            assert.equal(result.legacy.body.notes, notes); assert.equal(result.legacy.body.version, version);
            assert.equal(result.legacy.body.isArchived, isArchived);
            assert.equal((result.scoped.body.profile as Record<string, unknown>).notes, notes);
            assert.equal((result.scoped.body.profile as Record<string, unknown>).isArchived, isArchived);
            assert.equal((result.scoped.body.currentness as Record<string, unknown>).revision, version);
            assert.equal(result.receipt.status, hasReceipt ? 200 : 503,
                'a new authorized session must recover the same receipt after archive-generation rotation');
            if (hasReceipt) {
                assert.deepEqual(result.receipt.body, receipt); assert.deepEqual(result.replay.body, receipt);
                assert.equal(result.replay.status, 200);
                // A host caller cannot bypass the current-generation fence by reading the journal directly.
                const connection = new Database(join(directory, 'medical.db'), { readonly: true });
                try {
                    const restoredDb = drizzle(connection);
                    for (const deniedGeneration of [undefined, generation]) {
                        assert.throws(() => restoredDb.transaction(tx => readProfileNotesCommitReceipt(tx, {
                            reference: view.reference, digest: view.digest, actorRef: user.id, patientId,
                            ambulatoryId: 'synthetic-scope', archiveGeneration: deniedGeneration,
                        })), ArchiveReplacedError);
                    }
                } finally { connection.close(); }
            } else { assert.equal(result.receipt.body.code, 'receipt_unavailable'); assert.equal(result.replay.status, 409); }
            assert.deepEqual(readTarget(directory), expected, 'readback and denied/replayed commands do not mutate durable state');
            const recovered = await openRecoveryWrapping(kit.wrappedMasterKey, kit.salt, recovery.recoveryKey);
            const [, iv, ciphertext] = notes.split(':');
            assert.equal(await decryptData(ciphertext, iv, recovered.masterKey), stage === 'before'
                ? 'Nota sintetica prima del pilota.' : 'Nota sintetica salvata dal pilota, è già riveduta.');
        }

        const corruptDirectory = target('corrupt');
        openVersionedSqliteDatabase(join(corruptDirectory, 'medical.db')).close();
        const untouched = readFileSync(join(corruptDirectory, 'medical.db'));
        const corrupted = new Uint8Array(afterArtifact); corrupted[corrupted.length - 1] ^= 1;
        await assert.rejects(restoreRecoveryBackup({ artifact: corrupted, kit, recoveryKey: recovery.recoveryKey,
            destination: join(corruptDirectory, 'medical.db') }));
        assert.deepEqual(readFileSync(join(corruptDirectory, 'medical.db')), untouched);
        assert.deepEqual(readdirSync(corruptDirectory), ['medical.db']);

        const legacyNotes = await seal('Nuova nota sintetica dal percorso precedente.');
        const legacy = restoredProcess(afterDirectory, { ...input, legacyNotes });
        assert.equal(legacy.write.status, 200); assert.equal(legacy.legacy.body.notes, legacyNotes);
        assert.equal(legacy.legacy.body.version, 8); assert.equal(legacy.legacy.body.isArchived, false);
        assert.equal((legacy.scoped.body.profile as Record<string, unknown>).notes, legacyNotes);
        assert.equal((legacy.scoped.body.currentness as Record<string, unknown>).revision, 8);
        assert.deepEqual(legacy.receipt.body, receipt, 'legacy edits do not rewrite the historical pilot receipt');
        const final = readTarget(afterDirectory);
        assert.equal(final.audit_events.length, after.audit_events.length + 1);
        assert.deepEqual(final.entries, after.entries); assert.deepEqual(final.patients_to_ambulatories, after.patients_to_ambulatories);
    } finally {
        if (previousToken === undefined) delete process.env.MEDIFLOW_LOCAL_API_TOKEN;
        else process.env.MEDIFLOW_LOCAL_API_TOKEN = previousToken;
    }
});
