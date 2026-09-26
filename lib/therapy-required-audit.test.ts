/* @Codex: synthetic real-SQLite candidate oracle for required therapy audit and eight route contracts. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-c05-therapy-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
process.env.MEDIFLOW_LOCAL_API_TOKEN = 'c05-therapy-synthetic-token';
const state = { session: { id: 'synthetic-web', userId: 'synthetic-admin', role: 'admin', authChannel: 'web' } as Record<string, unknown> | null,
    scopeAmbulatoryId: 'c05-therapy-a' };
const stateKey = Symbol.for(`c05-therapy-seam-${dataDir}`);
(globalThis as unknown as Record<symbol, typeof state>)[stateKey] = state;
function seam(name: string, source: string) {
    const path = join(dataDir, name);
    writeFileSync(path, source, { mode: 0o600 });
    return pathToFileURL(path).href;
}
const auth = seam('auth.cjs', `const state=globalThis[Symbol.for(${JSON.stringify(`c05-therapy-seam-${dataDir}`)})];
exports.requireSession=async()=>state.session;
exports.requireLocalApiActorSession=async()=>({id:'synthetic-local',userId:'synthetic-local',role:'admin',authChannel:'system'});
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});
exports.forbiddenResponse=()=>Response.json({error:'Forbidden'},{status:403});`);
const token = seam('token.cjs', `exports.requireLocalApiToken=(request)=>request.headers.get('authorization')==='Bearer c05-therapy-synthetic-token'?null:Response.json({error:'Unauthorized'},{status:401});
exports.hasValidLocalApiToken=(request)=>request.headers.get('authorization')==='Bearer c05-therapy-synthetic-token';`);
const network = seam('network.cjs', `const state=globalThis[Symbol.for(${JSON.stringify(`c05-therapy-seam-${dataDir}`)})];
exports.requireNetworkWriteContext=async(request)=>({ok:true,context:{request,scopeAmbulatoryId:state.scopeAmbulatoryId,pairedClient:{clientId:'synthetic-paired'},session:{id:'synthetic-native',userId:'synthetic-admin',role:'admin',authChannel:'native'}}});`);
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
        next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const replacements: Record<string, string> = {
    '@/lib/security/server-auth': auth,
    '@/lib/security/local-api-auth': token,
    '@/lib/network-write-context': network,
};
const hooks = registerHooks({ resolve(specifier, context, next) {
    const url = replacements[specifier];
    return url ? { url, shortCircuit: true } : next(specifier, context);
} });
const { dbServer } = load('./db-server.ts') as typeof import('../lib/db-server.ts');
const { ambulatories, patients, patientsToAmbulatories, therapies } = load('./schema.ts') as typeof import('../lib/schema.ts');
const webCreate = load('../app/api/therapies/route.ts') as typeof import('../app/api/therapies/route.ts');
const webItem = load('../app/api/therapies/[id]/route.ts') as typeof import('../app/api/therapies/[id]/route.ts');
const v1Create = load('../app/api/v1/patients/[id]/therapies/route.ts') as typeof import('../app/api/v1/patients/[id]/therapies/route.ts');
const v1Item = load('../app/api/v1/patients/[id]/therapies/[therapyId]/route.ts') as typeof import('../app/api/v1/patients/[id]/therapies/[therapyId]/route.ts');
const networkCreate = load('../app/api/v1/network/patients/[id]/therapies/route.ts') as typeof import('../app/api/v1/network/patients/[id]/therapies/route.ts');
const networkItem = load('../app/api/v1/network/patients/[id]/therapies/[therapyId]/route.ts') as typeof import('../app/api/v1/network/patients/[id]/therapies/[therapyId]/route.ts');
const sql = new Database(join(dataDir, 'medical.db'));
const observations: Record<string, unknown>[] = [];
let serial = 0;
const nextId = (name: string) => `c05-therapy-${++serial}-${name}`;

test.after(() => {
    const report = process.env.MEDIFLOW_THERAPY_CANDIDATE_REPORT;
    if (report) writeFileSync(report, `${JSON.stringify({ observations }, null, 2)}\n`);
    sql.close(); dbServer.$client.close(); hooks.deregister();
    delete (globalThis as unknown as Record<symbol, typeof state>)[stateKey];
    rmSync(dataDir, { recursive: true, force: true });
});

function seed(name: string, withTherapy: boolean, deleted = false, archived = false) {
    const patientId = nextId(`${name}-patient`);
    const therapyId = nextId(`${name}-therapy`);
    dbServer.insert(ambulatories).values({ id: 'c05-therapy-a', name: 'Synthetic therapy ambulatory', type: 'live' }).onConflictDoNothing().run();
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient',
        taxCode: `SYN${serial}`, deletedAt: deleted ? new Date('2026-01-01T00:00:00Z') : null,
        notes: 'ENC:synthetic:patient', isArchived: archived }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: 'c05-therapy-a' }).run();
    if (withTherapy) dbServer.insert(therapies).values({ id: therapyId, patientId,
        drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose', status: 'active',
        motivation: 'ENC:synthetic:motivation', startDate: new Date('2026-01-01T00:00:00Z'),
        version: 3, diagnosisCode: 'ENC:synthetic:code' }).run();
    return { patientId, therapyId };
}

function readBack(patientId: string, therapyId: string) {
    const fresh = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try {
        return {
            therapy: fresh.prepare('SELECT * FROM therapies WHERE id=?').get(therapyId) ?? null,
            allPatientTherapies: fresh.prepare('SELECT * FROM therapies WHERE patient_id=? ORDER BY id').all(patientId),
            patient: fresh.prepare('SELECT * FROM patients WHERE id=?').get(patientId) ?? null,
            membership: fresh.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id').all(patientId),
            audit: fresh.prepare("SELECT * FROM audit_events WHERE subject_type='therapy' AND (subject_ref=? OR subject_ref IN (SELECT id FROM therapies WHERE patient_id=?)) ORDER BY rowid").all(therapyId, patientId),
            auditAll: fresh.prepare("SELECT * FROM audit_events WHERE subject_type='therapy' ORDER BY rowid").all(),
        };
    } finally { fresh.close(); }
}

type Surface = 'web' | 'v1' | 'network';
type Operation = 'POST' | 'PUT' | 'DELETE';
function request(method: Operation, body: unknown, surface: Surface, raw?: string, headers: Record<string,string> = {}) {
    return new Request('http://127.0.0.1/api/therapies', { method,
        headers: { 'content-type': 'application/json', ...(surface === 'web' ? {} : { authorization: 'Bearer c05-therapy-synthetic-token' }), ...headers },
        body: raw ?? JSON.stringify(body),
    });
}
async function invoke(surface: Surface, operation: Operation, ids: { patientId: string; therapyId: string }, body: unknown,
    raw?: string, headers: Record<string,string> = {}, suppliedRequest?: Request) {
    const req = suppliedRequest ?? request(operation, body, surface, raw, headers);
    if (surface === 'web') return operation === 'POST' ? webCreate.POST(req)
        : operation === 'PUT' ? webItem.PUT(req, { params: Promise.resolve({ id: ids.therapyId }) })
            : webItem.DELETE(req, { params: Promise.resolve({ id: ids.therapyId }) });
    if (surface === 'v1') return operation === 'POST' ? v1Create.POST(req, { params: Promise.resolve({ id: ids.patientId }) })
        : operation === 'PUT' ? v1Item.PUT(req, { params: Promise.resolve({ id: ids.patientId, therapyId: ids.therapyId }) })
            : v1Item.DELETE(req, { params: Promise.resolve({ id: ids.patientId, therapyId: ids.therapyId }) });
    return operation === 'POST' ? networkCreate.POST(req, { params: Promise.resolve({ id: ids.patientId }) })
        : networkItem.PUT(req, { params: Promise.resolve({ id: ids.patientId, therapyId: ids.therapyId }) });
}
function validBody(surface: Surface, operation: Operation, ids: { patientId: string; therapyId: string }) {
    if (operation === 'POST') return { id: ids.therapyId, ...(surface === 'web' ? { patientId: ids.patientId } : {}),
        drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose', motivation: 'ENC:synthetic:motivation',
        startDate: '2026-05-02T09:00:00.000Z' };
    if (operation === 'DELETE') return { version: 3, deletionReason: 'ENC:synthetic:reason' };
    return { version: 3, dosage: 'ENC:synthetic:new-dose' };
}
async function capture(name: string, surface: Surface, operation: Operation, options: {
    body?: unknown; raw?: string; deletedPatient?: boolean; archivedPatient?: boolean;
    routePatientId?: string; change?: (body: Record<string,unknown>) => unknown;
    headers?: Record<string,string>; wrongScope?: boolean; seedTherapy?: boolean; deletedTherapy?: boolean; missingParent?: boolean;
} = {}) {
    const ids = seed(name, options.seedTherapy ?? operation !== 'POST', options.deletedPatient, options.archivedPatient);
    if (options.missingParent) {
        sql.pragma('foreign_keys = OFF');
        try { sql.prepare('DELETE FROM patients WHERE id=?').run(ids.patientId); }
        finally { sql.pragma('foreign_keys = ON'); }
    }
    if (options.deletedTherapy) sql.prepare('UPDATE therapies SET deleted_at=?, deletion_reason=? WHERE id=?')
        .run(1_767_225_600, 'ENC:synthetic:old-reason', ids.therapyId);
    const before = readBack(ids.patientId, ids.therapyId);
    const routeIds = { ...ids, patientId: options.routePatientId ?? ids.patientId };
    const body = options.body !== undefined ? options.body : options.change?.(validBody(surface, operation, ids)) ?? validBody(surface, operation, ids);
    const priorScope = state.scopeAmbulatoryId;
    if (options.wrongScope) state.scopeAmbulatoryId = 'c05-therapy-other';
    let response: Response;
    try { response = await invoke(surface, operation, routeIds, body, options.raw, options.headers); }
    finally { state.scopeAmbulatoryId = priorScope; }
    const text = await response.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = { unparsed: text }; }
    const after = readBack(ids.patientId, ids.therapyId);
    const result = { name, surface, operation, status: response.status, json,
        changed: JSON.stringify(after) !== JSON.stringify(before),
        therapyChanged: JSON.stringify(after.allPatientTherapies) !== JSON.stringify(before.allPatientTherapies),
        auditDelta: after.auditAll.length - before.auditAll.length, before, after };
    observations.push(result);
    return { ...result, ids };
}

test('eight therapy mutations rollback on audit FAIL and IGNORE', async () => {
    for (const surface of ['web','v1','network'] as const) {
        for (const operation of (surface === 'network' ? ['POST','PUT'] : ['POST','PUT','DELETE']) as Operation[]) {
            for (const fault of ['FAIL','IGNORE'] as const) {
                sql.exec(`CREATE TRIGGER c05_therapy_audit_fault BEFORE INSERT ON audit_events BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic audit fault'" : ''}); END`);
                try {
                    const result = await capture(`${surface}-${operation}-audit-${fault}`, surface, operation);
                    assert.equal(result.status, 500);
                    assert.deepEqual(result.after, result.before);
                } finally { sql.exec('DROP TRIGGER c05_therapy_audit_fault'); }
            }
        }
    }
});

test('eight normal therapy mutations commit one row and one audit event', async () => {
    for (const surface of ['web','v1','network'] as const) {
        for (const operation of (surface === 'network' ? ['POST','PUT'] : ['POST','PUT','DELETE']) as Operation[]) {
            const result = await capture(`${surface}-${operation}-normal`, surface, operation);
            assert.equal(result.status, operation === 'POST' ? 201 : 200);
            assert.equal(result.auditDelta, 1);
            assert.equal(result.therapyChanged, true);
            assert.equal(result.after.membership.length, 1);
            assert.deepEqual(result.after.membership, result.before.membership);
            assert.deepEqual(result.after.patient, result.before.patient);
            const audit = result.after.audit.at(-1) as Record<string, unknown>;
            assert.equal(audit.subject_ref, result.ids.therapyId);
            assert.equal(audit.event_type, operation === 'POST' ? 'therapy.created'
                : operation === 'DELETE' ? 'therapy.deleted' : 'therapy.updated');
            assert.equal(audit.actor_type, surface === 'v1' ? 'system' : 'user');
            assert.equal(audit.actor_ref, surface === 'v1' ? 'local-api' : 'synthetic-admin');
            assert.equal(audit.source_surface, surface === 'web' ? 'web'
                : surface === 'v1' ? 'api' : 'native');
            const metadata = JSON.parse(audit.redacted_metadata as string) as {
                resourceVersion: number; changedFields: string[]; flags: string[];
            };
            assert.equal(metadata.resourceVersion, operation === 'POST' ? 1 : 4);
            assert.ok(metadata.changedFields.length > 0);
            if (surface === 'network') {
                assert.ok(metadata.flags.includes('auth:paired-client'));
                assert.ok(metadata.flags.includes('scope:ambulatory'));
            }
            assert.ok(!JSON.stringify(audit).includes('ENC:synthetic:'));
        }
    }
});

test('matched therapy UPDATE IGNORE never reports success or writes audit', async () => {
    for (const surface of ['web','v1','network'] as const) {
        sql.exec('CREATE TRIGGER c05_therapy_update_ignore BEFORE UPDATE ON therapies BEGIN SELECT RAISE(IGNORE); END');
        try {
            const result = await capture(`${surface}-PUT-domain-IGNORE`, surface, 'PUT');
            assert.equal(result.status, 500);
            assert.deepEqual(result.after, result.before);
        } finally { sql.exec('DROP TRIGGER c05_therapy_update_ignore'); }
    }
});

test('matched therapy INSERT IGNORE and DELETE UPDATE IGNORE rollback without audit', async () => {
    for (const surface of ['web','v1','network'] as const) {
        sql.exec('CREATE TRIGGER c05_therapy_insert_ignore BEFORE INSERT ON therapies BEGIN SELECT RAISE(IGNORE); END');
        try {
            const result = await capture(`${surface}-POST-domain-IGNORE`, surface, 'POST');
            assert.equal(result.status, 500);
            assert.deepEqual(result.after, result.before);
        } finally { sql.exec('DROP TRIGGER c05_therapy_insert_ignore'); }
    }
    for (const surface of ['web','v1'] as const) {
        sql.exec('CREATE TRIGGER c05_therapy_delete_update_ignore BEFORE UPDATE ON therapies BEGIN SELECT RAISE(IGNORE); END');
        try {
            const result = await capture(`${surface}-DELETE-domain-IGNORE`, surface, 'DELETE');
            assert.equal(result.status, 500);
            assert.deepEqual(result.after, result.before);
        } finally { sql.exec('DROP TRIGGER c05_therapy_delete_update_ignore'); }
    }
});

test('duplicate create is 409 without replay or another audit across all surfaces', async () => {
    for (const surface of ['web','v1','network'] as const) {
        const ids = seed(`${surface}-duplicate`, false);
        const body = validBody(surface, 'POST', ids);
        const first = await invoke(surface, 'POST', ids, body);
        assert.equal(first.status, 201);
        const afterFirst = readBack(ids.patientId, ids.therapyId);
        const second = await invoke(surface, 'POST', ids, body);
        assert.equal(second.status, 409);
        assert.deepEqual(readBack(ids.patientId, ids.therapyId), afterFirst);
        observations.push({ name: `${surface}-duplicate`, status: second.status, afterFirst });
    }
});

test('network create changedFields preserve applied client key order and exclude absent defaults', async () => {
    const ids = seed('network-create-changed-fields', false);
    const body = { id: ids.therapyId, drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose',
        status: 'active', startDate: '2026-05-02T09:00:00.000Z', motivation: 'ENC:synthetic:motivation' };
    const response = await invoke('network', 'POST', ids, body);
    assert.equal(response.status, 201);
    const after = readBack(ids.patientId, ids.therapyId);
    const event = after.audit.at(-1) as Record<string, unknown>;
    const metadata = JSON.parse(event.redacted_metadata as string) as { changedFields: string[] };
    assert.deepEqual(metadata.changedFields, ['drugName', 'dosage', 'status', 'startDate', 'motivation']);
});

test('v1 missing therapy keeps 404 before a known invalid field without changing SQLite', async () => {
    const ids = seed('v1-missing-before-invalid', true);
    const before = readBack(ids.patientId, ids.therapyId);
    const response = await invoke('v1', 'PUT', { ...ids, therapyId: `${ids.therapyId}-missing` },
        { version: 1, drugName: '', dosage: 'ENC:synthetic:dose' });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Not found' });
    assert.deepEqual(readBack(ids.patientId, ids.therapyId), before);
});

test('Web audit identity ignores extra local bearer and source header', async () => {
    const result = await capture('web-audit-spoof', 'web', 'POST',
        { headers: { authorization: 'Bearer c05-therapy-synthetic-token',
            'x-mediflow-source-surface': 'job', 'x-actor-ref': 'synthetic-spoof' } });
    assert.equal(result.status, 201);
    const audit = result.after.audit.at(-1) as Record<string, unknown>;
    assert.equal(audit.actor_ref, 'synthetic-admin');
    assert.equal(audit.actor_type, 'user');
    assert.equal(audit.source_surface, 'web');
});

test('all eight routes reject nonobject or malformed JSON and unknown own fields without effects', async () => {
    for (const surface of ['web','v1','network'] as const) {
        for (const operation of (surface === 'network' ? ['POST','PUT'] : ['POST','PUT','DELETE']) as Operation[]) {
            for (const raw of ['null', '[]', '"primitive"', '42', 'true', '{']) {
                const result = await capture(`${surface}-${operation}-envelope-${raw}`, surface, operation, { raw });
                assert.equal(result.status, 400);
                assert.deepEqual(result.after, result.before);
            }
            const unknown = await capture(`${surface}-${operation}-unknown`, surface, operation,
                { change: (body) => ({ ...body, syntheticUnknown: 'marker' }) });
            assert.equal(unknown.status, 400);
            assert.deepEqual(unknown.after, unknown.before);
        }
    }
});

test('therapy date edge compatibility and local timestamp authority stay surface-specific', async () => {
    for (const surface of ['web','v1','network'] as const) {
        for (const operation of ['POST','PUT'] as const) {
            const zeroStart = await capture(`${surface}-${operation}-startDate-zero`, surface, operation,
                { change: (body) => ({ ...body, startDate: 0 }) });
            assert.equal(zeroStart.status, surface === 'web' ? operation === 'POST' ? 201 : 200 : 400);
            if (surface === 'web') assert.equal((zeroStart.after.therapy as Record<string, unknown>).start_date, 0);
            else assert.deepEqual(zeroStart.after, zeroStart.before);
            const zeroEnd = await capture(`${surface}-${operation}-endDate-zero`, surface, operation,
                { change: (body) => ({ ...body, endDate: 0 }) });
            assert.equal(zeroEnd.status, surface === 'web' ? operation === 'POST' ? 201 : 200 : 400);
            if (surface === 'web') assert.equal((zeroEnd.after.therapy as Record<string, unknown>).end_date,
                operation === 'POST' ? null : 0);
            else assert.deepEqual(zeroEnd.after, zeroEnd.before);
            for (const endDate of [null, ''] as const) {
                const result = await capture(`${surface}-${operation}-endDate-${String(endDate)}`,
                    surface, operation, { change: (body) => ({ ...body, endDate }) });
                assert.equal(result.status, operation === 'POST' ? 201 : 200);
                assert.equal((result.after.therapy as Record<string, unknown>).end_date, null);
            }
        }
    }
    for (const surface of ['web','v1'] as const) {
        for (const field of ['createdAt','updatedAt'] as const) {
            const invalid = await capture(`${surface}-POST-${field}-invalid`, surface, 'POST',
                { change: (body) => ({ ...body, [field]: 'not-a-date' }) });
            assert.equal(invalid.status, 400);
            assert.deepEqual(invalid.after, invalid.before);
            const valid = await capture(`${surface}-POST-${field}-valid`, surface, 'POST',
                { change: (body) => ({ ...body, [field]: '2000-01-02T00:00:00.000Z' }) });
            assert.equal(valid.status, 201);
            assert.notEqual((valid.after.therapy as Record<string, unknown>).created_at, 946771200);
            assert.notEqual((valid.after.therapy as Record<string, unknown>).updated_at, 946771200);
        }
        const invalidUpdate = await capture(`${surface}-PUT-updatedAt-invalid`, surface, 'PUT',
            { change: (body) => ({ ...body, updatedAt: 'not-a-date' }) });
        assert.equal(invalidUpdate.status, 400);
        assert.deepEqual(invalidUpdate.after, invalidUpdate.before);
        const validUpdate = await capture(`${surface}-PUT-updatedAt-valid`, surface, 'PUT',
            { change: (body) => ({ ...body, updatedAt: '2000-01-02T00:00:00.000Z' }) });
        assert.equal(validUpdate.status, 200);
        assert.equal((validUpdate.after.therapy as Record<string, unknown>).updated_at === 946771200, surface === 'v1');
    }
});

test('explicit ID, invalid clinical types, stale/unsafe versions and cross-patient scope have no effects', async () => {
    for (const surface of ['web','v1','network'] as const) {
        for (const id of [42, ' ']) {
            const result = await capture(`${surface}-POST-id-${String(id)}`, surface, 'POST',
                { change: (body) => ({ ...body, id }) });
            assert.equal(result.status, 400);
            assert.deepEqual(result.after, result.before);
        }
        for (const startDate of ['not-a-date', true]) {
            const result = await capture(`${surface}-POST-date-${String(startDate)}`, surface, 'POST',
                { change: (body) => ({ ...body, startDate }) });
            assert.equal(result.status, 400);
            assert.deepEqual(result.after, result.before);
        }
        const badStatus = await capture(`${surface}-POST-bad-status`, surface, 'POST',
            { change: (body) => ({ ...body, status: 'unrecognized' }) });
        assert.equal(badStatus.status, 400);
        assert.deepEqual(badStatus.after, badStatus.before);
        const stale = await capture(`${surface}-PUT-stale`, surface, 'PUT',
            { change: (body) => ({ ...body, version: 2 }) });
        assert.equal(stale.status, 409);
        assert.deepEqual(stale.after, stale.before);
        for (const version of [0, Number.MAX_SAFE_INTEGER]) {
            const unsafe = await capture(`${surface}-PUT-unsafe-${version}`, surface, 'PUT',
                { change: (body) => ({ ...body, version }) });
            assert.equal(unsafe.status, 400);
            assert.deepEqual(unsafe.after, unsafe.before);
        }
        if (surface !== 'web') {
            const other = seed(`${surface}-other-parent`, false);
            const wrong = await capture(`${surface}-PUT-wrong-patient`, surface, 'PUT',
                { routePatientId: other.patientId });
            assert.equal(wrong.status, 404);
            assert.deepEqual(wrong.after, wrong.before);
        }
        if (surface === 'network') {
            for (const operation of ['POST','PUT'] as const) {
                const scoped = await capture(`network-${operation}-wrong-scope`, 'network', operation,
                    { wrongScope: true });
                assert.equal(scoped.status, 404);
                assert.deepEqual(scoped.after, scoped.before);
            }
            const unsealed = await capture('network-POST-unsealed-motivation', 'network', 'POST',
                { change: (body) => ({ ...body, motivation: 'plaintext-synthetic' }) });
            assert.equal(unsealed.status, 400);
            assert.deepEqual(unsealed.after, unsealed.before);
            const forbidden = await capture('network-POST-forbidden-AI', 'network', 'POST',
                { change: (body) => ({ ...body, aiSummary: 'synthetic' }) });
            assert.equal(forbidden.status, 403);
            assert.deepEqual(forbidden.after, forbidden.before);
            const precedence = await capture('network-POST-forbidden-AI-plus-unknown', 'network', 'POST',
                { change: (body) => ({ ...body, aiSummary: 'synthetic', syntheticUnknown: 'marker' }) });
            assert.equal(precedence.status, 403);
            assert.deepEqual(precedence.after, precedence.before);
        }
    }
});

test('v1/network PUT reject invalid tombstone types; v1 timestamp-only update audits the applied field', async () => {
    for (const surface of ['v1','network'] as const) {
        for (const deletedAt of [true, { synthetic: true }]) {
            const rejected = await capture(`${surface}-PUT-bad-deletedAt-${typeof deletedAt}`, surface, 'PUT',
                { change: (body) => ({ ...body, deletedAt }) });
            assert.equal(rejected.status, 400);
            assert.deepEqual(rejected.after, rejected.before);
        }
        const restored = await capture(`${surface}-PUT-null-deletedAt`, surface, 'PUT',
            { deletedTherapy: true, change: (body) => ({ ...body, deletedAt: null, deletionReason: null }) });
        assert.equal(restored.status, 200);
        assert.equal((restored.after.therapy as Record<string, unknown>).deleted_at, null);
        assert.equal(restored.auditDelta, 1);
        assert.equal((restored.after.audit.at(-1) as Record<string, unknown>).event_type, 'therapy.updated');
    }
    const timestampOnly = await capture('v1-PUT-timestamp-only', 'v1', 'PUT',
        { body: { version: 3, updatedAt: '2000-01-02T00:00:00.000Z' } });
    assert.equal(timestampOnly.status, 200);
    assert.equal((timestampOnly.after.therapy as Record<string, unknown>).updated_at, 946771200);
    const event = timestampOnly.after.audit.at(-1) as Record<string, unknown>;
    const metadata = JSON.parse(event.redacted_metadata as string) as { changedFields: string[] };
    assert.deepEqual(metadata.changedFields, ['updatedAt']);
});

test('all eight writes deny missing or tombstoned parent and allow archived parent', async () => {
    for (const surface of ['web','v1','network'] as const) {
        for (const operation of (surface === 'network' ? ['POST','PUT'] : ['POST','PUT','DELETE']) as Operation[]) {
            for (const condition of ['missing','deleted'] as const) {
                const result = await capture(`${surface}-${operation}-parent-${condition}`, surface, operation,
                    condition === 'missing' ? { missingParent: true } : { deletedPatient: true });
                assert.equal(result.status, 404);
                assert.deepEqual(result.after, result.before);
            }
            const archived = await capture(`${surface}-${operation}-parent-archived`, surface, operation,
                { archivedPatient: true });
            assert.equal(archived.status, operation === 'POST' ? 201 : 200);
            assert.equal(archived.auditDelta, 1);
        }
    }
});

/* @Codex: route-level reader tests use byte streams; no production hook or smaller production cap. */
function streamedRequest(surface: Surface, operation: Operation, chunks: Uint8Array[], headers: Record<string, string> = {}) {
    let pulls = 0, cancels = 0;
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            const chunk = chunks[pulls++];
            if (chunk) controller.enqueue(chunk);
            else controller.close();
        },
        cancel() { cancels += 1; },
    }, { highWaterMark: 0 });
    const req = new Request('http://127.0.0.1/api/therapies', { method: operation, body: stream,
        headers: { 'content-type': 'application/json',
            ...(surface === 'v1' ? { authorization: 'Bearer c05-therapy-synthetic-token' } : {}),
            ...headers }, duplex: 'half' } as RequestInit);
    return { req, counts: () => ({ pulls, cancels }) };
}

const encoder = new TextEncoder();
function paddedBytes(body: unknown, size: number) {
    const text = JSON.stringify(body);
    const padding = size - encoder.encode(text).byteLength;
    assert.ok(padding >= 0);
    return encoder.encode(`${text}${' '.repeat(padding)}`);
}

test('six local therapy mutations reject 4 MiB + 1 byte and deny before reading body', async () => {
    for (const surface of ['web','v1'] as const) {
        for (const operation of ['POST','PUT','DELETE'] as const) {
            const ids = seed(`${surface}-${operation}-over`, operation !== 'POST');
            const before = readBack(ids.patientId, ids.therapyId);
            const bytes = paddedBytes(validBody(surface, operation, ids), 4_194_305);
            const over = streamedRequest(surface, operation,
                [bytes.subarray(0, 4_194_304), bytes.subarray(4_194_304)]);
            const response = await invoke(surface, operation, ids, {}, undefined, {}, over.req);
            assert.equal(response.status, 413);
            assert.deepEqual(over.counts(), { pulls: 2, cancels: 1 });
            assert.deepEqual(readBack(ids.patientId, ids.therapyId), before);

            let accessed = false;
            const previous = state.session;
            if (surface === 'web') state.session = null;
            const poison = {
                get headers() {
                    if (surface === 'web') { accessed = true; throw new Error('denied headers accessed'); }
                    return new Headers();
                },
                get body() { accessed = true; throw new Error('denied body accessed'); },
                json() { accessed = true; throw new Error('denied JSON parsed'); },
                text() { accessed = true; throw new Error('denied text parsed'); },
            } as unknown as Request;
            try {
                const denied = await invoke(surface, operation, ids, {}, undefined, {}, poison);
                assert.equal(denied.status, 401);
                assert.equal(accessed, false);
                assert.deepEqual(readBack(ids.patientId, ids.therapyId), before);
            } finally { state.session = previous; }
        }
    }
});

test('Web POST accepts exactly 4 MiB with split UTF-8 and one audit', async () => {
    const ids = seed('web-exact-utf8-budget', false);
    const body = { ...validBody('web', 'POST', ids), drugName: 'ENC:synthetic:🩺' };
    const bytes = paddedBytes(body, 4_194_304);
    const emoji = bytes.indexOf(0xf0);
    assert.ok(emoji > 0);
    const fixture = streamedRequest('web', 'POST', [bytes.subarray(0, emoji + 1), bytes.subarray(emoji + 1)]);
    const response = await invoke('web', 'POST', ids, {}, undefined, {}, fixture.req);
    assert.equal(response.status, 201);
    assert.equal(fixture.counts().cancels, 0);
    assert.equal(readBack(ids.patientId, ids.therapyId).audit.length, 1);
});

test('declared oversize never pulls; absent or misleading length still enforces actual bytes', async () => {
    const ids = seed('web-declared-budget', false);
    const before = readBack(ids.patientId, ids.therapyId);
    const valid = paddedBytes(validBody('web', 'POST', ids), 4_194_304);
    const declared = streamedRequest('web', 'POST', [valid], { 'content-length': '4194305' });
    assert.equal((await invoke('web', 'POST', ids, {}, undefined, {}, declared.req)).status, 413);
    assert.deepEqual(declared.counts(), { pulls: 0, cancels: 1 });
    const actual = paddedBytes(validBody('web', 'POST', ids), 4_194_305);
    const misleading = streamedRequest('web', 'POST',
        [actual.subarray(0, 4_194_304), actual.subarray(4_194_304)], { 'content-length': '0' });
    assert.equal((await invoke('web', 'POST', ids, {}, undefined, {}, misleading.req)).status, 413);
    assert.deepEqual(misleading.counts(), { pulls: 2, cancels: 1 });
    assert.deepEqual(readBack(ids.patientId, ids.therapyId), before);
});
