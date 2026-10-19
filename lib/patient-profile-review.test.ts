import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { installNetworkPatientCookieFixture } from './network-patient-authority-test-fixture';
import { issueSyntheticWebSessionContext, retireSyntheticWebSession } from './security/web-auth-lifecycle-owner-test-fixture';
import { clearAllSessions } from './security/server-session';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { ambulatories, patients, patientsToAmbulatories, physicianReviewAttestations, users } from './schema';
import { isProfileReviewView, PROFILE_REVIEW_POLICY, type ProfileReviewView } from './patient-profile-review-contract';
import { encryptData } from './security/security';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-profile-review-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server'); openDbServer();
const cookieState: { cookies: Map<string, string>; onCookies?: () => void } = { cookies: new Map() };
const cleanup = installNetworkPatientCookieFixture(dataDir, cookieState);
const route = load('../app/api/patient-profile/review/route.ts') as typeof import('../app/api/patient-profile/review/route');
const queryRoute = load('../app/api/patients/[id]/profile-query/route.ts') as typeof import('../app/api/patients/[id]/profile-query/route');
const { createPhysicianReviewAttestationStore } = load('./security/physician-review-attestation-store.ts') as typeof import('./security/physician-review-attestation-store');
const { sessionPhysicianReviewAuthority } = load('./security/session-physician-review-authority-production.ts') as typeof import('./security/session-physician-review-authority-production');
const SYNTHETIC_USER = 'synthetic-review-user';
const PIN = '3817';
const user = { id: SYNTHETIC_USER, username: SYNTHETIC_USER, role: 'user' };
const passwordHash = bcrypt.hashSync(PIN, 4);
let session: ReturnType<typeof issueSyntheticWebSessionContext>;
let epoch = 0;
let sequence = 0;

function request(body: unknown) {
    return new Request('http://127.0.0.1/api/patient-profile/review', { method: 'POST', headers: {
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
const confirmation = (view: ProfileReviewView, candidatePin = PIN) => ({ kind: 'confirm', reference: view.reference, digest: view.digest, candidatePin });
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
