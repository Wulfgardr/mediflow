import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { installNetworkPatientCookieFixture } from './network-patient-authority-test-fixture';
import { issueSyntheticWebSessionContext, retireSyntheticWebSession } from './security/web-auth-lifecycle-owner-test-fixture';
import { clearAllSessions } from './security/server-session';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { ambulatories, auditEvents, observations, patients, patientsToAmbulatories, physicianReviewAttestations, users } from './schema';
import { isProfileReviewView, PROFILE_REVIEW_POLICY, type ProfileReviewView } from '../packages/patient-profile-contracts/src/review';
import { decryptData, encryptData } from './security/security';
import { isProfileResult, PROFILE_FIELD_NAMES } from '../packages/patient-profile-contracts/src/query';
import { isProfileNotesCommitReceipt, isProfileNotesCommitView, PROFILE_NOTES_COMMIT_POLICY,
    type ProfileNotesCommitView } from '../packages/patient-profile-contracts/src/notes-commit';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-profile-review-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server'); openDbServer();
const cookieState: { cookies: Map<string, string>; onCookies?: () => void } = { cookies: new Map() };
const cleanup = installNetworkPatientCookieFixture(dataDir, cookieState);
const route = load('../app/api/patient-profile/review/route.ts') as typeof import('../app/api/patient-profile/review/route');
const commitRoute = load('../app/api/patients/[id]/notes-commit/route.ts') as typeof import('../app/api/patients/[id]/notes-commit/route');
const ordinaryRoute = load('../app/api/patients/[id]/route.ts') as typeof import('../app/api/patients/[id]/route');
const queryRoute = load('../app/api/patients/[id]/profile-query/route.ts') as typeof import('../app/api/patients/[id]/profile-query/route');
const epochRoute = load('../app/api/patient-profile/selection-epoch/route.ts') as typeof import('../app/api/patient-profile/selection-epoch/route');
const { createPhysicianReviewAttestationStore } = load('./security/physician-review-attestation-store.ts') as typeof import('./security/physician-review-attestation-store');
const { sessionPhysicianReviewAuthority } = load('./security/session-physician-review-authority-production.ts') as typeof import('./security/session-physician-review-authority-production');
const SYNTHETIC_USER = 'synthetic-review-user';
const PIN = '3817';
const user = { id: SYNTHETIC_USER, username: SYNTHETIC_USER, role: 'user' };
const passwordHash = bcrypt.hashSync(PIN, 4);
let session: ReturnType<typeof issueSyntheticWebSessionContext>;
let epoch = 0;
let sequence = 0;

function request(body: unknown, path = '/api/patient-profile/review', method = 'POST') {
    return new Request(new URL(path, 'http://127.0.0.1'), { method, headers: {
        'content-type': 'application/json', origin: 'http://127.0.0.1', 'sec-fetch-site': 'same-origin',
        'x-mediflow-archive-generation': currentArchiveGeneration(),
    }, body: JSON.stringify(body) });
}
async function select(id = 'synthetic-patient-a') {
    const response = await queryRoute.POST(request({ kind: 'open', contractVersion: 1, projection: 'notes', expectedSelectionEpoch: epoch }),
        { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200, await response.clone().text());
    epoch = (await response.json()).currentness.selectionEpoch;
}
async function reset() {
    cookieState.onCookies = undefined; clearAllSessions(); cookieState.cookies.clear();
    dbServer.delete(physicianReviewAttestations).run(); dbServer.delete(patientsToAmbulatories).run(); dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run(); dbServer.delete(users).run();
    dbServer.insert(users).values({ ...user, passwordHash, encryptedMasterKey: 'synthetic-unused', salt: 'synthetic-unused' }).run();
    dbServer.insert(ambulatories).values({ id: 'synthetic-scope', name: 'Synthetic scope', type: 'live', isDefault: true }).run();
    for (const id of ['synthetic-patient-a', 'synthetic-patient-b']) {
        dbServer.insert(patients).values({ id, firstName: 'Ada', lastName: 'Sintetica', taxCode: 'SYNTHETIC-ONLY',
            birthDate: new Date(0), ambulatoryId: 'synthetic-scope', version: 4, notes: null, isArchived: false }).run();
        dbServer.insert(patientsToAmbulatories).values({ patientId: id, ambulatoryId: 'synthetic-scope' }).run();
    }
    const store = createPhysicianReviewAttestationStore(); store.createInactive(user.id); store.activate(user.id);
    session = issueSyntheticWebSessionContext(user, `profile-review-${++sequence}`);
    cookieState.cookies.set('mediflow_session', session.session.id); cookieState.cookies.set('mediflow_auth_control', session.controlId);
    cookieState.cookies.set('ambulatory_id', 'synthetic-scope'); epoch = 0; await select();
}
function snapshot() {
    return Object.fromEntries((dbServer.$client.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[])
        .map(({ name }) => [name, dbServer.$client.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()]));
}
async function prepare(notes: string | null = null): Promise<ProfileReviewView> {
    const response = await route.POST(request({ kind: 'prepare', expectedRevision: 4, expectedSelectionEpoch: epoch, notes }));
    assert.equal(response.status, 200, await response.clone().text());
    const view: unknown = await response.json(); assert.ok(isProfileReviewView(view));
    assert.equal(response.headers.get('cache-control'), 'no-store'); return view;
}
const confirmation = (view: Pick<ProfileReviewView, 'reference' | 'digest'>, candidatePin = PIN) => ({ kind: 'confirm', reference: view.reference, digest: view.digest, candidatePin });
function commit(body: unknown, id = 'synthetic-patient-a') {
    return commitRoute.POST(request(body, `/api/patients/${id}/notes-commit`), { params: Promise.resolve({ id }) });
}
async function prepareCommit(notes: string | null = null): Promise<ProfileNotesCommitView> {
    const response = await commit({ kind: 'prepare', expectedRevision: 4, expectedSelectionEpoch: epoch, notes });
    assert.equal(response.status, 200, await response.clone().text());
    const view: unknown = await response.json(); assert.ok(isProfileNotesCommitView(view)); return view;
}
function processCommit(t: TestContext, mode: 'race' | 'before-commit' | 'after-commit' | 'receipt', expected?: Pick<ProfileReviewView, 'reference' | 'digest'>) {
    const child = spawn(process.execPath, ['--experimental-strip-types', '--import',
        fileURLToPath(new URL('../scripts/register-strip-types-loader.mjs', import.meta.url)),
        fileURLToPath(new URL('./patient-profile-notes-commit-process.fixture.ts', import.meta.url)), mode,
        ...(expected ? [expected.reference, expected.digest] : [])], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir,
        MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', MEDIFLOW_TEST_PROFILE_NOTES_PROCESS: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', stderr = '', crash: string | null = null;
    const results: { status: number; body: unknown }[] = [];
    let ready!: (value: Pick<ProfileReviewView, 'reference' | 'digest'>) => void;
    let rejectReady!: (error: Error) => void;
    const prepared = new Promise<Pick<ProfileReviewView, 'reference' | 'digest'>>((resolve, reject) => { ready = resolve; rejectReady = reject; });
    // Receipt workers have no preparation; keep an unused rejected readiness from escaping.
    void prepared.catch(() => undefined);
    child.stdout.on('data', value => {
        buffer += String(value);
        for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            const message = JSON.parse(line);
            if (message.kind === 'ready') ready({ reference: message.reference, digest: message.digest });
            else if (message.kind === 'result') results.push(message);
            else if (message.kind === 'crash') crash = message.stage;
        }
    });
    child.stderr.on('data', value => { stderr = (stderr + String(value)).slice(-4096); });
    const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null; results: typeof results; stderr: string; crash: string | null }>((resolve, reject) => {
        child.on('error', error => { rejectReady(error); reject(error); });
        child.on('close', (code, signal) => {
            rejectReady(new Error(`Synthetic worker exited before preparation: ${code} ${signal} ${stderr}`));
            resolve({ code, signal, results, stderr, crash });
        });
    });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    return { prepared, finished, go: () => child.stdin.end('go\n') };
}
function revoke() { dbServer.update(physicianReviewAttestations).set({ status: 'revoked', revokedAt: new Date() }).where(eq(physicianReviewAttestations.actorRef, user.id)).run(); }
test.after(() => { clearAllSessions(); cleanup(); dbServer.$client.close(); rmSync(dataDir, { recursive: true, force: true }); });

test('real scoped host reviews the exact encrypted command once with real PIN and no database or audit effects', async () => {
    await reset();
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const encrypted = await encryptData('Nota sintetica completa\ncon seconda riga.', key);
    const notes = `ENC:${encrypted.iv}:${encrypted.data}`, before = snapshot();
    const view = await prepare(notes); assert.equal(view.notes, notes);
    assert.equal(JSON.stringify(view).includes(user.id), false); assert.equal(JSON.stringify(view).includes('synthetic-patient-a'), false);
    const response = await route.POST(request(confirmation(view))); assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { kind: 'reviewed', policy: PROFILE_REVIEW_POLICY, writesPerformed: 0 });
    assert.equal((await route.POST(request(confirmation(view)))).status, 409);
    const cleared = await prepare(null); assert.equal(cleared.notes, null);
    assert.equal((await route.POST(request(confirmation(cleared)))).status, 200);
    assert.deepEqual(snapshot(), before);
});

test('boundary rejects body-supplied authority, plaintext, wrong digest and production access', async () => {
    await reset();
    for (const extra of [{ confirmed: true }, { role: 'physician' }, { patientId: 'synthetic-patient-b' },
        { operationId: 'other' }, { idempotencyKey: 'chosen-by-caller' }, { policy: 'other' }]) {
        assert.equal((await route.POST(request({ kind: 'prepare', expectedRevision: 4, expectedSelectionEpoch: epoch, notes: null, ...extra }))).status, 400);
    }
    assert.equal((await route.POST(request({ kind: 'prepare', expectedRevision: 4, expectedSelectionEpoch: epoch, notes: 'plaintext' }))).status, 400);
    const view = await prepare();
    assert.equal((await route.POST(request({ ...confirmation(view), digest: '0'.repeat(64) }))).status, 409);
    assert.equal((await route.POST(request(confirmation(view)))).status, 409);
    const previous = process.env.NODE_ENV; Reflect.set(process.env, 'NODE_ENV', 'production');
    try { assert.equal((await route.POST(request(confirmation(view)))).status, 404); }
    finally { if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV'); else Reflect.set(process.env, 'NODE_ENV', previous); }
});

test('new preparation, cancel, concurrent confirmation and wrong PIN are terminal for their reference', async () => {
    await reset(); const first = await prepare(), second = await prepare();
    assert.notEqual(first.reference, second.reference); assert.notEqual(first.digest, second.digest);
    assert.equal((await route.POST(request(confirmation(first)))).status, 409);
    const results = await Promise.all([route.POST(request(confirmation(second))), route.POST(request(confirmation(second)))]);
    assert.deepEqual(results.map(value => value.status).sort(), [200, 409]);
    const cancelled = await prepare(); assert.equal((await route.POST(request({ kind: 'cancel', reference: cancelled.reference }))).status, 200);
    assert.equal((await route.POST(request(confirmation(cancelled)))).status, 409);
    const wrongPin = await prepare(); assert.equal((await route.POST(request(confirmation(wrongPin, '9999')))).status, 403);
    assert.equal((await route.POST(request(confirmation(wrongPin)))).status, 409);
});

test('selection, version, role, attestation and lock changes invalidate the retained command', async t => {
    for (const change of ['selection', 'version', 'role', 'attestation', 'lock'] as const) await t.test(change, async () => {
        await reset(); const view = await prepare();
        if (change === 'selection') { await select('synthetic-patient-b'); await select('synthetic-patient-a'); }
        if (change === 'version') dbServer.update(patients).set({ version: 5 }).where(eq(patients.id, 'synthetic-patient-a')).run();
        if (change === 'role') dbServer.update(users).set({ role: 'admin' }).where(eq(users.id, user.id)).run();
        if (change === 'attestation') revoke();
        if (change === 'lock') retireSyntheticWebSession(session.session);
        const before = snapshot(); assert.ok((await route.POST(request(confirmation(view)))).status >= 400);
        assert.deepEqual(snapshot(), before);
    });
});

test('revocation while fresh PIN completion awaits and after the last authority await cannot pass the synchronous gate', async () => {
    await reset(); const view = await prepare(); let reads = 0, changed = false;
    // Admission reads twice, then the real verifier reads its principal before and after bcrypt.
    cookieState.onCookies = () => { if (++reads === 4) { revoke(); changed = true; } };
    assert.equal((await route.POST(request(confirmation(view)))).status, 403); assert.equal(changed, true);
    await reset();
    const authority = await sessionPhysicianReviewAuthority.derive(); await sessionPhysicianReviewAuthority.recheck(authority);
    revoke(); let effects = 0;
    assert.throws(() => sessionPhysicianReviewAuthority.withCurrentAuthority(authority, () => { effects++; }), { code: 'attestation_revoked' });
    assert.equal(effects, 0);
});

test('expiry and a regressing clock refuse confirmation without rearming the review', async t => {
    for (const direction of ['expired', 'backwards'] as const) await t.test(direction, async child => {
        await reset(); const view = await prepare();
        child.mock.method(Date, 'now', () => direction === 'expired' ? view.expiresAt : view.expiresAt - 60_000);
        assert.equal((await route.POST(request(confirmation(view)))).status, 410);
        assert.equal((await route.POST(request(confirmation(view)))).status, 409);
    });
});

test('reviewed notes use the real writer once, return the same audit receipt and retain ordinary notes save', async () => {
    await reset();
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const encrypted = await encryptData('Nota clinica interamente sintetica.', key);
    const notes = `ENC:${encrypted.iv}:${encrypted.data}`;
    const count = dbServer.select().from(auditEvents).all().length;
    const view = await prepareCommit(notes);
    assert.deepEqual(view.recipient, { id: 'synthetic-patient-a', firstName: 'Ada', lastName: 'Sintetica' });
    assert.equal(view.action, 'replace-notes'); assert.equal(view.notes, notes);
    const response = await commit(confirmation(view)); assert.equal(response.status, 200, await response.clone().text());
    const receipt: unknown = await response.json(); assert.ok(isProfileNotesCommitReceipt(receipt));
    assert.equal(receipt.revision, 5); assert.equal(receipt.previousRevision, 4);
    assert.equal(dbServer.select().from(patients).where(eq(patients.id, view.recipient.id)).get()?.notes, notes);
    assert.equal(dbServer.select().from(patients).where(eq(patients.id, view.recipient.id)).get()?.version, 5);
    assert.equal(dbServer.select().from(auditEvents).all().length, count + 1);
    const metadata = dbServer.select().from(auditEvents).where(eq(auditEvents.eventId, view.reference)).get()!.redactedMetadata!;
    for (const forbidden of [notes, 'Nota clinica', 'Ada', 'Sintetica', view.recipient.id, user.id, 'candidatePin', 'encryptedMasterKey']) assert.equal(metadata.includes(forbidden), false);
    assert.deepEqual(await (await commit(confirmation(view))).json(), receipt);
    assert.equal((await commit({ ...confirmation(view), digest: '0'.repeat(64) })).status, 409);
    assert.equal(dbServer.select().from(auditEvents).all().length, count + 1);

    const legacy = await ordinaryRoute.PUT(request({ version: 5, notes: null }), { params: Promise.resolve({ id: view.recipient.id }) });
    assert.equal(legacy.status, 200, await legacy.clone().text());
    assert.equal(dbServer.select().from(patients).where(eq(patients.id, view.recipient.id)).get()?.version, 6);
    assert.deepEqual(await (await commit({ kind: 'receipt', reference: view.reference, digest: view.digest })).json(), receipt);
});

test('reviewed notes retain encrypted identity, membership and a clinical sentinel through archive and unarchive', async t => {
    await reset();
    const patientId = 'synthetic-patient-a', observationId = 'synthetic-lifecycle-observation';
    const path = `/api/patients/${patientId}`, context = { params: Promise.resolve({ id: patientId }) };
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const seal = async (value: string) => {
        const encrypted = await encryptData(value, key); return `ENC:${encrypted.iv}:${encrypted.data}`;
    };
    const noteText = 'Nota sintetica conservata durante archiviazione e riattivazione.';
    const [firstName, lastName, taxCode, notes, archiveReason, archiveNote, sentinelNotes] = await Promise.all([
        'Ada', 'Sintetica', 'SYNTHETIC-LIFECYCLE', noteText, 'Motivo sintetico', 'Dettaglio sintetico', 'Osservazione sintetica invariata',
    ].map(seal));
    dbServer.update(patients).set({ firstName, lastName, taxCode }).where(eq(patients.id, patientId)).run();
    dbServer.insert(ambulatories).values({ id: 'synthetic-secondary-scope', name: 'Synthetic second scope', type: 'live' }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: 'synthetic-secondary-scope', assignedAt: new Date(0) }).run();
    t.after(() => { dbServer.delete(observations).where(eq(observations.id, observationId)).run(); });
    dbServer.insert(observations).values({ id: observationId, patientId, codeSystem: 'synthetic', code: 'sentinel',
        display: 'Synthetic sentinel', unitSystem: 'synthetic', unitCode: 'unit', value: '1', notes: sentinelNotes,
        observedAt: new Date(0), version: 3 }).run();
    const patient = () => dbServer.select().from(patients).where(eq(patients.id, patientId)).get()!;
    const original = patient();
    const related = () => ({ memberships: dbServer.select().from(patientsToAmbulatories).all(),
        observations: dbServer.select().from(observations).all(),
        otherPatient: dbServer.select().from(patients).where(eq(patients.id, 'synthetic-patient-b')).get() });
    const originalRelated = related();
    const previousAuditIds = new Set(dbServer.select().from(auditEvents).all().map(row => row.eventId));
    const put = (body: Record<string, unknown>) => ordinaryRoute.PUT(request(body, path, 'PUT'), context);
    async function assertCurrentState(version: number, isArchived: boolean) {
        const row = patient();
        assert.deepEqual(row, { ...original, notes, version, isArchived,
            archiveReason: isArchived ? archiveReason : null, archiveNote: isArchived ? archiveNote : null, updatedAt: row.updatedAt });
        assert.deepEqual(related(), originalRelated);
        const beforeRead = snapshot();
        const legacyResponse = await ordinaryRoute.GET(request(undefined, path, 'GET'), context);
        assert.equal(legacyResponse.status, 200, await legacyResponse.clone().text());
        const legacy = await legacyResponse.json();
        assert.equal(legacy.id, patientId); assert.equal(legacy.version, version);
        assert.equal(legacy.isArchived, isArchived); assert.equal(legacy.deletedAt, null); assert.equal(legacy.notes, notes);
        // The previous selection is stale after a write; obtain the current epoch before reopening.
        const epochResponse = await epochRoute.GET(request(undefined, '/api/patient-profile/selection-epoch', 'GET'));
        assert.equal(epochResponse.status, 200, await epochResponse.clone().text());
        const scopedResponse = await queryRoute.POST(request({ kind: 'open', contractVersion: 1, projection: 'profile',
            expectedSelectionEpoch: (await epochResponse.json()).selectionEpoch }, `${path}/profile-query`), context);
        assert.equal(scopedResponse.status, 200, await scopedResponse.clone().text());
        const scoped: unknown = await scopedResponse.json(); assert.ok(isProfileResult(scoped));
        assert.equal(scoped.projection, 'profile'); assert.equal(scoped.currentness.revision, version);
        assert.deepEqual(scoped.profile, Object.fromEntries(PROFILE_FIELD_NAMES.map(field => [field, legacy[field]])));
        assert.deepEqual(snapshot(), beforeRead);
    }

    const reviewed = await prepareCommit(notes);
    const committed = await commit(confirmation(reviewed)); assert.equal(committed.status, 200, await committed.clone().text());
    const receipt: unknown = await committed.json(); assert.ok(isProfileNotesCommitReceipt(receipt));
    assert.equal(receipt.revision, 5); await assertCurrentState(5, false);

    const archive = { version: 5, isArchived: true, archiveReason, archiveNote };
    const archived = await put(archive); assert.equal(archived.status, 200, await archived.clone().text());
    await assertCurrentState(6, true);
    const beforeRetry = snapshot(), stale = await put(archive);
    assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'VERSION_CONFLICT');
    assert.deepEqual(snapshot(), beforeRetry);

    const unarchive = { version: 6, isArchived: false };
    dbServer.$client.exec(`CREATE TEMP TRIGGER synthetic_lifecycle_audit_fault BEFORE INSERT ON audit_events
        WHEN NEW.event_type = 'patient.restored' AND NEW.subject_ref = 'synthetic-patient-a'
        BEGIN SELECT RAISE(ABORT, 'synthetic lifecycle audit failure'); END`);
    try { assert.equal((await put(unarchive)).status, 500); }
    finally { dbServer.$client.exec('DROP TRIGGER synthetic_lifecycle_audit_fault'); }
    assert.deepEqual(snapshot(), beforeRetry);
    const restored = await put(unarchive); assert.equal(restored.status, 200, await restored.clone().text());
    // The existing inverse intentionally clears archiveReason/archiveNote; identity and ciphertext stay intact.
    await assertCurrentState(7, false);
    const [, iv, data] = patient().notes!.split(':');
    assert.equal(await decryptData(data, iv, key), noteText);
    const audit = dbServer.select().from(auditEvents).all().filter(row => !previousAuditIds.has(row.eventId));
    assert.equal(audit.length, 3);
    for (const row of audit) {
        assert.equal(row.actorRef, user.id); assert.equal(row.subjectRef, patientId);
        assert.equal(row.outcome, 'success'); assert.equal(row.sourceSurface, 'web');
    }
    assert.deepEqual(audit.map(row => {
        const metadata = JSON.parse(row.redactedMetadata!);
        return { eventType: row.eventType, revision: metadata.resourceVersion, changedFields: metadata.changedFields.sort() };
    }).sort((a, b) => a.revision - b.revision), [
        { eventType: 'patient.updated', revision: 5, changedFields: ['notes'] },
        { eventType: 'patient.updated', revision: 6, changedFields: ['archiveNote', 'archiveReason', 'isArchived'] },
        { eventType: 'patient.restored', revision: 7, changedFields: ['archiveNote', 'archiveReason', 'isArchived'] },
    ]);
    const afterLifecycle = snapshot();
    assert.deepEqual(await (await commit({ kind: 'receipt', reference: reviewed.reference, digest: reviewed.digest })).json(), receipt);
    assert.deepEqual(snapshot(), afterLifecycle);
});

test('receipt recovery needs the current actor and scope, but never reactivates a proof or requires the old selection', async () => {
    await reset(); const view = await prepareCommit();
    const receipt = await (await commit(confirmation(view))).json();
    clearAllSessions();
    session = issueSyntheticWebSessionContext(user, `profile-recovery-${++sequence}`);
    cookieState.cookies.set('mediflow_session', session.session.id); cookieState.cookies.set('mediflow_auth_control', session.controlId);
    revoke();
    const before = snapshot();
    const recovery = { kind: 'receipt', reference: view.reference, digest: view.digest };
    assert.deepEqual(await (await commit(recovery)).json(), receipt);
    assert.deepEqual(await (await commit(confirmation(view, ''))).json(), receipt);
    assert.equal((await commit(recovery, 'synthetic-patient-b')).status, 409);
    assert.deepEqual(snapshot(), before);
    const OTHER_USER = 'synthetic-recovery-other';
    const other = { id: OTHER_USER, username: OTHER_USER, role: 'user' };
    dbServer.insert(users).values({ ...other, passwordHash: 'synthetic-unusable', encryptedMasterKey: 'synthetic-unused', salt: 'synthetic-unused' }).run();
    const foreign = issueSyntheticWebSessionContext(other, `profile-recovery-other-${++sequence}`);
    cookieState.cookies.set('mediflow_session', foreign.session.id); cookieState.cookies.set('mediflow_auth_control', foreign.controlId);
    assert.equal((await commit(recovery)).status, 409);
    cookieState.cookies.set('mediflow_session', session.session.id); cookieState.cookies.set('mediflow_auth_control', session.controlId);
    dbServer.insert(ambulatories).values({ id: 'synthetic-other-scope', name: 'Synthetic second scope', type: 'live' }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: 'synthetic-patient-a', ambulatoryId: 'synthetic-other-scope' }).run();
    cookieState.cookies.set('ambulatory_id', 'synthetic-other-scope');
    assert.equal((await commit(recovery)).status, 409);
});

test('commit policy cannot consume dry-run review and denies changed context or forged admission without effects', async t => {
    await reset(); const dryRun = await prepare(); const before = snapshot();
    assert.equal((await commit(confirmation(dryRun))).status, 409); assert.deepEqual(snapshot(), before);
    for (const extra of [{ confirmed: true }, { policy: PROFILE_NOTES_COMMIT_POLICY }, { idempotencyKey: 'caller-key' }]) {
        assert.equal((await commit({ kind: 'prepare', expectedRevision: 4, expectedSelectionEpoch: epoch, notes: null, ...extra })).status, 400);
    }
    for (const change of ['selection', 'version', 'role', 'attestation', 'lock', 'recipient', 'wrong-pin'] as const) await t.test(change, async () => {
        await reset(); const view = await prepareCommit();
        if (change === 'selection') { await select('synthetic-patient-b'); await select('synthetic-patient-a'); }
        if (change === 'version') dbServer.update(patients).set({ version: 5 }).where(eq(patients.id, 'synthetic-patient-a')).run();
        if (change === 'role') dbServer.update(users).set({ role: 'admin' }).where(eq(users.id, user.id)).run();
        if (change === 'attestation') revoke();
        if (change === 'lock') retireSyntheticWebSession(session.session);
        if (change === 'recipient') dbServer.update(patients).set({ firstName: 'Synthetic changed name' }).where(eq(patients.id, 'synthetic-patient-a')).run();
        const before = snapshot();
        assert.ok((await commit(confirmation(view, change === 'wrong-pin' ? '9999' : PIN))).status >= 400);
        assert.deepEqual(snapshot(), before);
    });
});

test('recovery seals a pending or unconfirmed command before returning not committed', async () => {
    await reset(); const view = await prepareCommit(), before = snapshot();
    const response = await commit({ kind: 'receipt', reference: view.reference, digest: view.digest });
    assert.deepEqual(await response.json(), { kind: 'not_committed', policy: PROFILE_NOTES_COMMIT_POLICY, reference: view.reference, digest: view.digest });
    assert.equal((await commit(confirmation(view))).status, 409); assert.deepEqual(snapshot(), before);
    const next = await prepareCommit();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const atPin = new Promise<void>(resolve => { entered = resolve; });
    let reads = 0;
    cookieState.onCookies = async () => { if (++reads === 4) { entered(); await waiting; } };
    const pending = commit(confirmation(next));
    await Promise.race([atPin, pending.then(() => { throw new Error('Synthetic PIN boundary was not reached'); })]);
    cookieState.onCookies = undefined;
    const recovery = await commit({ kind: 'receipt', reference: next.reference, digest: next.digest });
    release(); assert.equal((await pending).status, 409);
    assert.equal((await recovery.json()).kind, 'not_committed'); assert.deepEqual(snapshot(), before);
});

test('recovery never reports absence while another real session can still commit', { timeout: 15_000 }, async t => {
    await reset(); const count = dbServer.select().from(auditEvents).all().length;
    const worker = processCommit(t, 'race'), expected = await worker.prepared;
    const response = await commit({ kind: 'receipt', ...expected });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'receipt_unavailable');
    assert.equal(dbServer.select().from(patients).where(eq(patients.id, 'synthetic-patient-a')).get()?.version, 4);
    assert.equal(dbServer.select().from(auditEvents).all().length, count);
    worker.go(); const result = await worker.finished;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.results[0]?.status, 200);
    assert.ok(isProfileNotesCommitReceipt(result.results[0].body));
    assert.deepEqual(await (await commit({ kind: 'receipt', ...expected })).json(), result.results[0].body);
    assert.equal(dbServer.select().from(patients).where(eq(patients.id, 'synthetic-patient-a')).get()?.version, 5);
    assert.equal(dbServer.select().from(auditEvents).all().length, count + 1);
});

test('audit insertion and receipt construction failures roll back the real patient CAS', async t => {
    for (const fault of ['audit-abort', 'audit-ignore', 'receipt-clock'] as const) await t.test(fault, async child => {
        await reset(); const view = await prepareCommit(), before = snapshot();
        let afterUpdate = false;
        if (fault === 'receipt-clock') {
            dbServer.$client.function('synthetic_receipt_clock', () => {
                afterUpdate = true; child.mock.method(Date, 'now', () => Number.NaN); return 1;
            });
            dbServer.$client.exec(`CREATE TEMP TRIGGER synthetic_receipt_fault AFTER UPDATE OF version ON patients
                BEGIN SELECT synthetic_receipt_clock(); END`);
        } else dbServer.$client.exec(`CREATE TEMP TRIGGER synthetic_audit_fault BEFORE INSERT ON audit_events
            WHEN NEW.event_id LIKE 'ppr_%' BEGIN SELECT RAISE(${fault === 'audit-abort' ? "ABORT, 'synthetic audit failure'" : 'IGNORE'}); END`);
        try { assert.ok((await commit(confirmation(view))).status >= 400); }
        finally { child.mock.restoreAll(); dbServer.$client.exec('DROP TRIGGER IF EXISTS synthetic_audit_fault'); dbServer.$client.exec('DROP TRIGGER IF EXISTS synthetic_receipt_fault'); }
        if (fault === 'receipt-clock') assert.equal(afterUpdate, true);
        assert.deepEqual(snapshot(), before);
        assert.equal((await commit(confirmation(view))).status, 409);
    });
});

test('two real processes confirming the same patient revision have one winner and one audit', { timeout: 15_000 }, async t => {
    await reset(); const count = dbServer.select().from(auditEvents).all().length;
    const first = processCommit(t, 'race'), second = processCommit(t, 'race');
    const views = await Promise.all([first.prepared, second.prepared]);
    assert.notEqual(views[0].reference, views[1].reference);
    first.go(); second.go();
    const completed = await Promise.all([first.finished, second.finished]);
    for (const result of completed) assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(completed.map(result => result.results[0]?.status).sort(), [200, 409]);
    assert.equal(dbServer.select().from(patients).where(eq(patients.id, 'synthetic-patient-a')).get()?.version, 5);
    assert.equal(dbServer.select().from(auditEvents).all().length, count + 1);
});

test('real process termination before commit rolls back; after commit a new process recovers the same receipt', { timeout: 20_000 }, async t => {
    // Each real worker admits a new session. Its durable generation fence is
    // independent of the clinical transaction and survives an abrupt stop.
    const clinicalState = () => Object.fromEntries(Object.entries(snapshot())
        .filter(([table]) => table !== 'archive_session_generations'));
    for (const mode of ['before-commit', 'after-commit'] as const) await t.test(mode, async current => {
        await reset(); const before = clinicalState();
        const worker = processCommit(current, mode), expected = await worker.prepared;
        worker.go(); const stopped = await worker.finished;
        assert.equal(stopped.crash, mode, stopped.stderr);
        assert.ok(stopped.signal === 'SIGKILL' || (process.platform === 'win32' && stopped.code === 1), stopped.stderr);
        assert.equal(stopped.results.length, 0);
        const recovery = processCommit(current, 'receipt', expected);
        const result = await recovery.finished; assert.equal(result.code, 0, result.stderr);
        if (mode === 'before-commit') {
            assert.equal(result.results[0]?.status, 503);
            assert.deepEqual(clinicalState(), before);
            assert.equal((result.results[0].body as { code: string }).code, 'receipt_unavailable');
        } else {
            assert.equal(result.results[0]?.status, 200);
            const receipt = result.results[0].body; assert.ok(isProfileNotesCommitReceipt(receipt));
            assert.equal(receipt.revision, 5);
            assert.equal(dbServer.select().from(patients).where(eq(patients.id, 'synthetic-patient-a')).get()?.version, 5);
            const after = snapshot();
            assert.deepEqual(await (await commit({ kind: 'receipt', ...expected })).json(), receipt);
            assert.deepEqual(snapshot(), after);
        }
    });
});
