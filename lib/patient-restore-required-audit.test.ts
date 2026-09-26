/* @Codex: C05 real admin restore handler and synthetic SQLite with auth seam. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-c05-admin-restore-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const previousToken = process.env.MEDIFLOW_LOCAL_API_TOKEN;
process.env.MEDIFLOW_LOCAL_API_TOKEN = 'c05-admin-restore-synthetic-token';
const state = { session: { id: 'synthetic-web-session', userId: 'synthetic-web-admin',
    role: 'admin', authChannel: 'web' } as Record<string, unknown> | null };
const stateKey = Symbol.for(`c05-admin-restore-auth-${dataDir}`);
(globalThis as unknown as Record<symbol, typeof state>)[stateKey] = state;
const authPath = join(dataDir, 'auth.cjs');
writeFileSync(authPath, `const state=globalThis[Symbol.for(${JSON.stringify(`c05-admin-restore-auth-${dataDir}`)})];
exports.requireSession=async()=>state.session;
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});
exports.forbiddenResponse=()=>Response.json({error:'Forbidden'},{status:403});`, { mode: 0o600 });
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
        next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@/lib/security/server-auth') return { url: pathToFileURL(authPath).href, shortCircuit: true };
    return next(specifier, context);
} });
const { dbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const { ambulatories, entries, patients, patientsToAmbulatories } = load('./schema.ts') as typeof import('./schema.ts');
const route = load('../app/api/system/restore-patient/route.ts') as typeof import('../app/api/system/restore-patient/route.ts');
const sql = new Database(join(dataDir, 'medical.db'));
const observations: Array<Record<string, unknown>> = [];

test.after(() => {
    const report = process.env.MEDIFLOW_ADMIN_RESTORE_CANDIDATE_REPORT;
    if (report) writeFileSync(report, `${JSON.stringify({ cases: observations }, null, 2)}\n`);
    sql.close(); dbServer.$client.close(); hooks.deregister();
    if (previousToken === undefined) delete process.env.MEDIFLOW_LOCAL_API_TOKEN;
    else process.env.MEDIFLOW_LOCAL_API_TOKEN = previousToken;
    delete (globalThis as unknown as Record<symbol, typeof state>)[stateKey];
    rmSync(dataDir, { recursive: true, force: true });
});

function reset(id: string) {
    sql.exec('DROP TRIGGER IF EXISTS c05_admin_restore_audit_fault');
    dbServer.delete(entries).run();
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    dbServer.insert(ambulatories).values([
        { id: 'c05-admin-a', name: 'Ambulatorio A sintetico', type: 'live' },
        { id: 'c05-admin-b', name: 'Ambulatorio B sintetico', type: 'live' },
    ]).run();
    dbServer.insert(patients).values({ id, firstName: 'Ada', lastName: 'Sintetica', taxCode: 'C05ADMINRESTORE',
        version: 3, ambulatoryId: 'c05-admin-a', isArchived: true,
        deletedAt: new Date('2026-01-02T03:04:05.000Z'), deletionReason: 'ENC:synthetic:reason',
        notes: 'ENC:synthetic:notes' }).run();
    dbServer.insert(patientsToAmbulatories).values([
        { patientId: id, ambulatoryId: 'c05-admin-a' },
        { patientId: id, ambulatoryId: 'c05-admin-b' },
    ]).run();
    dbServer.insert(entries).values({ id: `${id}-entry`, patientId: id, type: 'note',
        title: 'Voce sintetica', date: new Date('2026-01-01T00:00:00.000Z'), content: 'ENC:synthetic:entry' }).run();
    state.session = { id: 'synthetic-web-session', userId: 'synthetic-web-admin', role: 'admin', authChannel: 'web' };
}

function readBack(id: string) {
    const reopened = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try {
        return {
            patient: reopened.prepare('SELECT * FROM patients WHERE id=?').get(id) ?? null,
            memberships: reopened.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id').all(id),
            entries: reopened.prepare('SELECT * FROM entries WHERE patient_id=? ORDER BY id').all(id),
            audit: reopened.prepare('SELECT * FROM audit_events WHERE subject_ref=? ORDER BY rowid').all(id),
        };
    } finally { reopened.close(); }
}

function post(rawBody: string, extraHeaders: Record<string, string> = {}) {
    return route.POST(new Request('http://127.0.0.1/api/system/restore-patient', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'synthetic-admin-restore',
            ...extraHeaders }, body: rawBody,
    }));
}

/* @Codex: route-level stream fixture observes byte-budget pull and cancellation behavior. */
function streamedPost(chunks: Uint8Array[], extraHeaders: Record<string, string> = {}) {
    let pulls = 0, cancels = 0;
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            const chunk = chunks[pulls++];
            if (chunk) controller.enqueue(chunk);
            else controller.close();
        },
        cancel() { cancels += 1; },
    }, { highWaterMark: 0 });
    const request = new Request('http://127.0.0.1/api/system/restore-patient', {
        method: 'POST', body: stream,
        headers: { 'content-type': 'application/json', ...extraHeaders }, duplex: 'half',
    } as RequestInit);
    return { request, counts: () => ({ pulls, cancels }) };
}

const encoder = new TextEncoder();
const boundedBody = (id: string, size: number) => {
    const json = JSON.stringify({ patientId: id });
    const padding = size - encoder.encode(json).byteLength;
    assert.ok(padding >= 0);
    return encoder.encode(`${json}${' '.repeat(padding)}`);
};

for (const fault of ['FAIL', 'IGNORE'] as const) {
    test(`admin restore audit ${fault} rolls back full state`, async () => {
        const id = `c05-admin-restore-${fault.toLowerCase()}`;
        reset(id);
        const before = readBack(id);
        sql.exec(`CREATE TRIGGER c05_admin_restore_audit_fault BEFORE INSERT ON audit_events BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic audit fault'" : ''}); END`);
        const response = await post(JSON.stringify({ patientId: id }));
        const after = readBack(id);
        observations.push({ case: `audit-${fault}`, status: response.status,
            beforeVersion: (before.patient as Record<string, unknown>).version,
            afterVersion: (after.patient as Record<string, unknown>).version,
            beforeDeletedAt: (before.patient as Record<string, unknown>).deleted_at,
            afterDeletedAt: (after.patient as Record<string, unknown>).deleted_at,
            beforeReason: (before.patient as Record<string, unknown>).deletion_reason,
            afterReason: (after.patient as Record<string, unknown>).deletion_reason,
            membershipsEqual: JSON.stringify(after.memberships) === JSON.stringify(before.memberships),
            childrenEqual: JSON.stringify(after.entries) === JSON.stringify(before.entries),
            auditCount: after.audit.length });
        assert.equal(response.status, 500);
        assert.deepEqual(after, before);
    });
}

test('null JSON body returns 400 and no changes', async () => {
    const id = 'c05-admin-restore-null-json';
    reset(id);
    const before = readBack(id);
    const response = await post('null');
    const after = readBack(id);
    observations.push({ case: 'null-json', status: response.status,
        stateEqual: JSON.stringify(after) === JSON.stringify(before) });
    assert.equal(response.status, 400);
    assert.deepEqual(after, before);
});

test('repeated restore returns 409 without a second write or event', async () => {
    const id = 'c05-admin-restore-repeat';
    reset(id);
    const first = await post(JSON.stringify({ patientId: id }));
    const afterFirst = readBack(id);
    const repeat = await post(JSON.stringify({ patientId: id }));
    const afterRepeat = readBack(id);
    observations.push({ case: 'repeat', firstStatus: first.status, secondStatus: repeat.status,
        firstVersion: (afterFirst.patient as Record<string, unknown>).version,
        secondVersion: (afterRepeat.patient as Record<string, unknown>).version,
        firstAuditCount: afterFirst.audit.length, secondAuditCount: afterRepeat.audit.length,
        stateEqual: JSON.stringify(afterRepeat) === JSON.stringify(afterFirst) });
    assert.equal(first.status, 200);
    assert.equal(repeat.status, 409);
    assert.deepEqual(afterRepeat, afterFirst);
    assert.equal(afterFirst.audit.length, 1);
});

test('Web-admin with extra valid local bearer and spoofed source headers retains Web/session attribution', async () => {
    const id = 'c05-admin-restore-extra-bearer';
    reset(id);
    const response = await post(JSON.stringify({ patientId: id }), {
        authorization: 'Bearer c05-admin-restore-synthetic-token',
        'x-mediflow-source-surface': 'job', 'x-actor-ref': 'spoofed-actor',
    });
    const after = readBack(id);
    const event = after.audit[0] as Record<string, unknown> | undefined;
    observations.push({ case: 'web-admin-with-extra-local-bearer', status: response.status,
        actorType: event?.actor_type ?? null, actorRef: event?.actor_ref ?? null,
        sourceSurface: event?.source_surface ?? null,
        metadata: event?.redacted_metadata ? JSON.parse(event.redacted_metadata as string) : null,
        auditCount: after.audit.length });
    assert.equal(response.status, 200);
    assert.equal(after.audit.length, 1);
    assert.equal(event?.actor_type, 'user');
    assert.equal(event?.actor_ref, 'synthetic-web-admin');
    assert.equal(event?.source_surface, 'web');
    assert.deepEqual(JSON.parse(event?.redacted_metadata as string), {
        changedFields: ['deletedAt', 'deletionReason'], flags: ['auth:session'], resourceVersion: 4,
    });
});

test('ignored patient UPDATE rolls back without a success or audit event', async () => {
    const id = 'c05-admin-restore-update-ignore';
    reset(id);
    const before = readBack(id);
    sql.exec('CREATE TRIGGER c05_admin_restore_update_ignore BEFORE UPDATE OF deleted_at ON patients BEGIN SELECT RAISE(IGNORE); END');
    try {
        const response = await post(JSON.stringify({ patientId: id }));
        assert.equal(response.status, 500);
        assert.deepEqual(readBack(id), before);
    } finally { sql.exec('DROP TRIGGER c05_admin_restore_update_ignore'); }
});

for (const [name, session] of [
    ['missing', null],
    ['doctor-web', { id: 'synthetic-web', userId: 'doctor', role: 'doctor', authChannel: 'web' }],
    ['admin-native', { id: 'synthetic-native', userId: 'admin', role: 'admin', authChannel: 'native' }],
    ['admin-system', { id: 'local-api', userId: 'local-api', role: 'admin', authChannel: 'system' }],
] as const) {
    test(`${name} session cannot restore or audit`, async () => {
        const id = `c05-admin-restore-denied-${name}`;
        reset(id);
        const before = readBack(id);
        state.session = session;
        let bodyAccessed = false;
        const response = await route.POST({
            get headers() { bodyAccessed = true; throw new Error('denied request accessed headers'); },
            get body() { bodyAccessed = true; throw new Error('denied request accessed body'); },
        } as unknown as Request);
        assert.equal(response.status, name === 'missing' ? 401 : 403);
        assert.equal(bodyAccessed, false);
        assert.deepEqual(readBack(id), before);
    });
}

test('exact 65,536 UTF-8 bytes with a multibyte code point split across chunks are admitted', async () => {
    const id = 'c05-admin-restore-exact-🩺';
    reset(id);
    const before = readBack(id);
    const bytes = boundedBody(id, 65_536);
    const emojiStart = bytes.indexOf(0xf0);
    assert.ok(emojiStart > 0);
    const fixture = streamedPost([bytes.subarray(0, emojiStart + 1), bytes.subarray(emojiStart + 1)]);
    const response = await route.POST(fixture.request);
    const after = readBack(id);
    assert.equal(response.status, 200);
    assert.equal(fixture.counts().cancels, 0);
    assert.equal((after.patient as Record<string, unknown>).version, 4);
    assert.equal(after.audit.length, 1);
    assert.deepEqual(after.memberships, before.memberships);
    assert.deepEqual(after.entries, before.entries);
});

for (const [name, headers] of [
    ['absent-length', {}], ['misleading-length', { 'content-length': '0' }],
] as const) {
    test(`65,537 actual UTF-8 bytes with ${name} return 413 and cancel at crossing`, async () => {
        const id = `c05-admin-restore-over-${name}`;
        reset(id);
        const before = readBack(id);
        const bytes = boundedBody(id, 65_537);
        const fixture = streamedPost([bytes.subarray(0, 65_536), bytes.subarray(65_536)], headers);
        const response = await route.POST(fixture.request);
        assert.equal(response.status, 413);
        assert.deepEqual(fixture.counts(), { pulls: 2, cancels: 1 });
        assert.deepEqual(readBack(id), before);
    });
}

test('oversized declared Content-Length returns 413 before pulling body', async () => {
    const id = 'c05-admin-restore-declared-over';
    reset(id);
    const before = readBack(id);
    const fixture = streamedPost([boundedBody(id, 65_536)], { 'content-length': '65537' });
    const response = await route.POST(fixture.request);
    assert.equal(response.status, 413);
    assert.deepEqual(fixture.counts(), { pulls: 0, cancels: 1 });
    assert.deepEqual(readBack(id), before);
});

for (const [name, raw] of [
    ['malformed', '{'], ['array', '[]'], ['string', '"invalid"'],
    ['number', '42'], ['boolean', 'true'], ['empty', ''],
] as const) {
    test(`${name} JSON envelope returns 400 without state or audit change`, async () => {
        const id = `c05-admin-restore-invalid-${name}`;
        reset(id);
        const before = readBack(id);
        const response = await post(raw);
        assert.equal(response.status, 400);
        assert.deepEqual(readBack(id), before);
    });
}

for (const [name, body] of [
    ['missing-id', {}], ['non-string-id', { patientId: 42 }], ['blank-id', { patientId: '   ' }],
] as const) {
    test(`${name} returns 400 without state or audit change`, async () => {
        const id = `c05-admin-restore-${name}`;
        reset(id);
        const before = readBack(id);
        const response = await post(JSON.stringify(body));
        assert.equal(response.status, 400);
        assert.deepEqual(readBack(id), before);
    });
}

for (const [name, raw] of [
    ['actorRef', '{"patientId":"ID","actorRef":"spoofed"}'],
    ['sourceSurface', '{"patientId":"ID","sourceSurface":"job"}'],
    ['clinicalSentinel', '{"patientId":"ID","clinicalSentinel":"CLINICAL_SENTINEL"}'],
    ['version', '{"patientId":"ID","version":1}'],
    ['expectedVersion', '{"patientId":"ID","expectedVersion":999}'],
    ['proto', '{"patientId":"ID","__proto__":{"role":"admin"}}'],
] as const) {
    test(`unsupported own ${name} property returns 400 with unchanged full SQLite state`, async () => {
        const id = `c05-admin-restore-extra-${name}`;
        reset(id);
        const before = readBack(id);
        const response = await post(raw.replace('"ID"', JSON.stringify(id)));
        assert.equal(response.status, 400);
        assert.deepEqual(readBack(id), before);
    });
}

test('missing patient stays 404 and active patient stays 409', async () => {
    const id = 'c05-admin-restore-state-gates';
    reset(id);
    const missing = await post(JSON.stringify({ patientId: 'c05-absent-patient' }));
    assert.equal(missing.status, 404);
    const before = readBack(id);
    dbServer.update(patients).set({ deletedAt: null, deletionReason: null }).run();
    const active = readBack(id);
    const response = await post(JSON.stringify({ patientId: id }));
    assert.equal(response.status, 409);
    assert.deepEqual(readBack(id), active);
    assert.equal(before.audit.length, 0);
});

for (const archived of [false, true]) {
    test(`success restores archived=${archived} with exactly one audit and all other columns preserved`, async () => {
        const id = `c05-admin-restore-success-${archived}`;
        reset(id);
        dbServer.update(patients).set({ isArchived: archived }).run();
        const before = readBack(id);
        const response = await post(JSON.stringify({ patientId: `  ${id}  ` }));
        const after = readBack(id);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, patientId: id, version: 4 });
        assert.deepEqual(after.patient, { ...(before.patient as Record<string, unknown>),
            version: 4, deleted_at: null, deletion_reason: null,
            updated_at: (after.patient as Record<string, unknown>).updated_at });
        assert.deepEqual(after.memberships, before.memberships);
        assert.deepEqual(after.entries, before.entries);
        assert.equal(after.audit.length, 1);
        const event = after.audit[0] as Record<string, unknown>;
        assert.equal(event.event_type, 'patient.restored');
        assert.equal(event.outcome, 'success');
        assert.equal(event.actor_ref, 'synthetic-web-admin');
        assert.equal(event.source_surface, 'web');
        assert.equal(event.subject_ref, id);
        const metadata = JSON.parse(event.redacted_metadata as string);
        assert.deepEqual(metadata, { changedFields: ['deletedAt', 'deletionReason'],
            flags: ['auth:session'], resourceVersion: 4 });
        assert.equal(JSON.stringify(metadata).includes('CLINICAL_SENTINEL'), false);
        assert.equal(JSON.stringify(metadata).includes('ENC:synthetic'), false);
    });
}

test('concurrent handler calls serialize one 200, one 409, and no retry audit', async () => {
    const id = 'c05-admin-restore-concurrent';
    reset(id);
    const body = JSON.stringify({ patientId: id });
    const [first, second] = await Promise.all([post(body), post(body)]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    const after = readBack(id);
    assert.equal((after.patient as Record<string, unknown>).version, 4);
    assert.equal(after.audit.length, 1);
    const retry = await post(body);
    assert.equal(retry.status, 409);
    assert.deepEqual(readBack(id), after);
});
