/* @Codex: C05 real patient POST handlers on synthetic SQLite; auth/cookie seams only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import type * as PhysicalOwner from '@mediflow/web-auth-lifecycle-owner';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-c05-create-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const previousToken = process.env.MEDIFLOW_LOCAL_API_TOKEN;
process.env.MEDIFLOW_LOCAL_API_TOKEN = 'c05-create-synthetic-token';
const state: { session: PhysicalOwner.WebSessionProjection | null; selected: string } = { session: null, selected: 'c05-create-a' };
const stateKey = Symbol.for(`c05-create-seam-${dataDir}`);
(globalThis as unknown as Record<symbol, typeof state>)[stateKey] = state;
function seam(name: string, source: string) {
    const file = join(dataDir, name);
    writeFileSync(file, source, { mode: 0o600 });
    return pathToFileURL(file).href;
}
const auth = seam('auth.cjs', `const s=globalThis[Symbol.for(${JSON.stringify(`c05-create-seam-${dataDir}`)})];
exports.requireSession=async()=>s.session;
exports.requireLocalApiActorSession=async()=>({id:'local-api',userId:'local-api',role:'admin'});
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});`);
const token = seam('token.cjs', `exports.requireLocalApiToken=(request)=>request.headers.get('authorization')==='Bearer c05-create-synthetic-token'
  ?null:Response.json({error:'Unauthorized'},{status:401});
exports.hasValidLocalApiToken=(request)=>request.headers.get('authorization')==='Bearer c05-create-synthetic-token';`);
const headers = seam('headers.cjs', `const s=globalThis[Symbol.for(${JSON.stringify(`c05-create-seam-${dataDir}`)})];
exports.cookies=async()=>({get:(name)=>name==='ambulatory_id'?{value:s.selected}:undefined});`);
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
        next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const replacements: Record<string, string> = {
    '@/lib/security/server-auth': auth,
    '@/lib/security/local-api-auth': token,
    'next/headers': headers,
};
const hooks = registerHooks({ resolve(specifier, context, next) {
    const url = replacements[specifier];
    return url ? { url, shortCircuit: true } : next(specifier, context);
} });

const { dbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const { ambulatories, patients, patientsToAmbulatories } = load('./schema.ts') as typeof import('./schema.ts');
const web = load('../app/api/patients/route.ts') as typeof import('../app/api/patients/route.ts');
const v1 = load('../app/api/v1/patients/route.ts') as typeof import('../app/api/v1/patients/route.ts');
const { patientCreateContexts, PATIENT_CREATE_HEADERS } = load('./security/patient-create-context.ts') as typeof import('./security/patient-create-context.ts');
const physicalOwner = load('@mediflow/web-auth-lifecycle-owner') as typeof import('@mediflow/web-auth-lifecycle-owner');
const sql = new Database(join(dataDir, 'medical.db'));
const observations: Array<Record<string, unknown>> = [];

test.after(() => {
    const report = process.env.MEDIFLOW_CREATE_CANDIDATE_REPORT;
    if (report) writeFileSync(report, `${JSON.stringify({ cases: observations }, null, 2)}\n`);
    sql.close(); dbServer.$client.close(); hooks.deregister();
    if (state.session) physicalOwner.retire(state.session, 'dispose');
    if (previousToken === undefined) delete process.env.MEDIFLOW_LOCAL_API_TOKEN;
    else process.env.MEDIFLOW_LOCAL_API_TOKEN = previousToken;
    delete (globalThis as unknown as Record<symbol, typeof state>)[stateKey];
    rmSync(dataDir, { recursive: true, force: true });
});

function issueSession(suffix: string) {
    const control = physicalOwner.bootstrapControl(); assert(control);
    const attempt = physicalOwner.begin('login', { controlId: control.controlId,
        ifMatch: control.etag, idempotencyKey: `synthetic-create-baseline-${suffix}` });
    assert(attempt);
    const userId = 'synthetic-create-user';
    const issued = physicalOwner.issue(attempt, { id: userId, username: userId, role: 'admin' });
    assert(issued);
    const resolved = physicalOwner.resolve(issued.sessionId, control.controlId);
    assert.equal(resolved.status, 'active');
    if (resolved.status !== 'active') throw new Error('Synthetic physical owner session unavailable');
    return resolved.projection;
}

function reset() {
    sql.exec('DROP TRIGGER IF EXISTS c05_create_audit_fault');
    sql.exec('DROP TRIGGER IF EXISTS c05_create_owner_veto');
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    dbServer.insert(ambulatories).values([
        { id: 'c05-create-a', name: 'Ambulatorio A sintetico', type: 'live', isDefault: true },
        { id: 'c05-create-b', name: 'Ambulatorio B sintetico', type: 'live' },
    ]).run();
    state.selected = 'c05-create-a';
}

function readBack(id: string) {
    const reopened = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try {
        return {
            patient: reopened.prepare('SELECT * FROM patients WHERE id=?').get(id) ?? null,
            memberships: reopened.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id').all(id),
            audit: reopened.prepare('SELECT * FROM audit_events WHERE subject_ref=? ORDER BY rowid').all(id),
        };
    } finally { reopened.close(); }
}

type Surface = 'web-legacy' | 'web-fixed-preview-v1' | 'v1';
type Precondition = { nonce: string; ambulatoryId: string };
function capturePreview() {
    assert(state.session);
    const preview = patientCreateContexts(physicalOwner).capture(state.session,
        { id: 'c05-create-b', name: 'Ambulatorio B sintetico' });
    assert(preview);
    return preview;
}
async function create(surface: Surface, id: string, options: {
    precondition?: Precondition;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
} = {}) {
    const requestHeaders = new Headers({ 'content-type': 'application/json',
        'x-request-id': `synthetic-${id}`, ...options.headers });
    if (surface === 'v1') requestHeaders.set('authorization', 'Bearer c05-create-synthetic-token');
    if (surface === 'web-fixed-preview-v1') {
        const preview = options.precondition ?? capturePreview();
        requestHeaders.set(PATIENT_CREATE_HEADERS.mode, 'fixed-preview-v1');
        requestHeaders.set(PATIENT_CREATE_HEADERS.context, preview.nonce);
        requestHeaders.set(PATIENT_CREATE_HEADERS.target, preview.ambulatoryId);
    }
    const body = { id, firstName: 'Ada', lastName: 'Sintetica', taxCode: `SYN${id.replaceAll('-', '').slice(-10)}`,
        ambulatoryId: 'c05-create-a', ...options.body };
    const request = new Request(`http://127.0.0.1/${surface === 'v1' ? 'api/v1' : 'api'}/patients`, {
        method: 'POST', headers: requestHeaders, body: JSON.stringify(body),
    });
    return surface === 'v1' ? v1.POST(request) : web.POST(request);
}

function newSession(suffix: string) {
    if (state.session) physicalOwner.retire(state.session, 'dispose');
    state.session = issueSession(suffix);
}

for (const surface of ['web-legacy', 'web-fixed-preview-v1', 'v1'] as const) {
    for (const fault of ['FAIL', 'IGNORE'] as const) {
        test(`${surface} audit ${fault} rolls back patient, membership, and event`, async () => {
            reset();
            newSession(`${surface}-${fault}`);
            const id = `c05-create-${surface}-${fault}`;
            sql.exec(`CREATE TRIGGER c05_create_audit_fault BEFORE INSERT ON audit_events BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic audit fault'" : ''}); END`);
            const response = await create(surface, id);
            const snapshot = readBack(id);
            observations.push({ surface, fault, status: response.status, patient: Boolean(snapshot.patient),
                version: (snapshot.patient as Record<string, unknown> | null)?.version ?? null,
                ambulatoryId: (snapshot.patient as Record<string, unknown> | null)?.ambulatory_id ?? null,
                membershipTargets: snapshot.memberships.map(row => (row as Record<string, unknown>).ambulatory_id),
                auditCount: snapshot.audit.length });
            assert.equal(response.status, 500);
            assert.equal(snapshot.patient, null);
            assert.equal(snapshot.memberships.length, 0);
            assert.equal(snapshot.audit.length, 0);
        });
    }
}

for (const surface of ['web-legacy', 'web-fixed-preview-v1', 'v1'] as const) {
    test(`${surface} succeeds with exactly one host-attributed minimal audit event`, async () => {
        reset(); newSession(`${surface}-success`);
        const id = `c05-create-${surface}-success`;
        const response = await create(surface, id, { body: {
            notes: 'ENC:synthetic:sealed', unknownClinicalProperty: 'CLINICAL_SENTINEL',
            actorRef: 'spoofed-actor', sourceSurface: 'job',
        }, headers: { 'x-mediflow-source-surface': 'job', 'x-actor-ref': 'spoofed-actor' } });
        const snapshot = readBack(id);
        assert.equal(response.status, 201);
        assert.deepEqual(await response.json(), { id });
        assert.equal((snapshot.patient as Record<string, unknown>)?.version, 1);
        assert.equal((snapshot.patient as Record<string, unknown>)?.notes, 'ENC:synthetic:sealed');
        assert.deepEqual(snapshot.memberships.map(row => (row as Record<string, unknown>).ambulatory_id),
            [surface === 'web-fixed-preview-v1' ? 'c05-create-b' : 'c05-create-a']);
        assert.equal(snapshot.audit.length, 1);
        const event = snapshot.audit[0] as Record<string, unknown>;
        assert.equal(event.event_type, 'patient.created');
        assert.equal(event.outcome, 'success');
        assert.equal(event.subject_ref, id);
        assert.equal(event.actor_type, surface === 'v1' ? 'system' : 'user');
        assert.equal(event.actor_ref, surface === 'v1' ? 'local-api' : 'synthetic-create-user');
        assert.equal(event.source_surface, surface === 'v1' ? 'api' : 'web');
        assert.equal(event.request_id, `synthetic-${id}`);
        const metadata = JSON.parse(event.redacted_metadata as string) as Record<string, unknown>;
        assert.equal(metadata.resourceVersion, 1);
        assert.ok(Array.isArray(metadata.changedFields));
        assert.ok((metadata.changedFields as string[]).includes('notes'));
        assert.equal((metadata.changedFields as string[]).includes('unknownClinicalProperty'), false);
        assert.equal(JSON.stringify(metadata).includes('CLINICAL_SENTINEL'), false);
        assert.equal(JSON.stringify(metadata).includes('ENC:synthetic:sealed'), false);
        assert.equal(JSON.stringify(metadata).includes('spoofed-actor'), false);
        observations.push({ surface, case: 'success', status: response.status, auditCount: snapshot.audit.length,
            actorType: event.actor_type, actorRef: event.actor_ref, sourceSurface: event.source_surface });

        const repeat = await create(surface, id);
        assert.equal(repeat.status, 500);
        assert.deepEqual(readBack(id), snapshot);
    });
}

test('physical owner final veto after audit INSERT rolls back all three fenced writes', async () => {
    reset(); newSession('final-veto');
    const id = 'c05-create-final-veto';
    let vetoObserved = false;
    dbServer.$client.function('c05_create_poison_owner', () => {
        assert(state.session);
        const port = physicalOwner.mintResourcePort(state.session);
        if (port) physicalOwner.releaseResourcePort(port);
        vetoObserved = port === null;
        return 1;
    });
    sql.exec('CREATE TRIGGER c05_create_owner_veto AFTER INSERT ON audit_events BEGIN SELECT c05_create_poison_owner(); END');
    const response = await create('web-fixed-preview-v1', id);
    const snapshot = readBack(id);
    assert.equal(vetoObserved, true);
    assert.equal(response.status, 409);
    assert.deepEqual(snapshot, { patient: null, memberships: [], audit: [] });
    observations.push({ surface: 'web-fixed-preview-v1', case: 'physical-final-veto', status: response.status,
        patient: false, membershipCount: 0, auditCount: 0 });
});

test('fixed-preview rejects retired and different-generation preconditions without writes', async () => {
    reset(); newSession('old-generation');
    const preview = capturePreview();
    assert(state.session);
    physicalOwner.retire(state.session, 'dispose');
    const retired = await create('web-fixed-preview-v1', 'c05-create-retired', { precondition: preview });
    assert.equal(retired.status, 409);
    assert.deepEqual(readBack('c05-create-retired'), { patient: null, memberships: [], audit: [] });
    state.session = issueSession('different-generation');
    const changed = await create('web-fixed-preview-v1', 'c05-create-other-generation', { precondition: preview });
    assert.equal(changed.status, 409);
    assert.deepEqual(readBack('c05-create-other-generation'), { patient: null, memberships: [], audit: [] });
});

test('expired fixed-preview precondition is denied without writes', async () => {
    reset(); newSession('expired-generation');
    const contexts = patientCreateContexts(physicalOwner);
    const preview = capturePreview();
    const clockHolder = contexts as unknown as { clock: () => number };
    const originalClock = clockHolder.clock;
    try {
        clockHolder.clock = () => preview.expiresAt;
        const response = await create('web-fixed-preview-v1', 'c05-create-expired', { precondition: preview });
        assert.equal(response.status, 409);
        assert.deepEqual(readBack('c05-create-expired'), { patient: null, memberships: [], audit: [] });
    } finally { clockHolder.clock = originalClock; }
});

for (const surface of ['web-legacy', 'web-fixed-preview-v1', 'v1'] as const) {
    test(`${surface} simultaneous create-only calls and lost-response retry leave one event`, async () => {
        reset(); newSession(`${surface}-competing-create`);
        const id = `c05-create-${surface}-competing`;
        const options = surface === 'web-fixed-preview-v1' ? { precondition: capturePreview() } : {};
        const [first, second] = await Promise.all([create(surface, id, options), create(surface, id, options)]);
        assert.deepEqual([first.status, second.status].sort(), [201, 500]);
        const snapshot = readBack(id);
        assert.ok(snapshot.patient);
        assert.equal(snapshot.memberships.length, 1);
        assert.equal(snapshot.audit.length, 1);
        const lostResponseRetry = await create(surface, id, options);
        assert.equal(lostResponseRetry.status, 500);
        assert.deepEqual(readBack(id), snapshot);
    });
}
