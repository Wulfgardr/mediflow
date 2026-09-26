/* @Codex: synthetic real-SQLite candidate oracle for eight ordinary observation mutations. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-c05-observation-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
process.env.MEDIFLOW_LOCAL_API_TOKEN = 'c05-observation-synthetic-token';
const state = { session: { id: 'synthetic-web', userId: 'synthetic-admin', role: 'admin', authChannel: 'web' } as Record<string, unknown> | null,
    scopeAmbulatoryId: 'c05-observation-a' };
const stateKey = Symbol.for(`c05-observation-seam-${dataDir}`);
(globalThis as unknown as Record<symbol, typeof state>)[stateKey] = state;
function seam(name: string, source: string) {
    const path = join(dataDir, name);
    writeFileSync(path, source, { mode: 0o600 });
    return pathToFileURL(path).href;
}
const auth = seam('auth.cjs', `const state=globalThis[Symbol.for(${JSON.stringify(`c05-observation-seam-${dataDir}`)})];
exports.requireSession=async()=>state.session;
exports.requireLocalApiActorSession=async()=>({id:'synthetic-local',userId:'synthetic-local',role:'admin',authChannel:'system'});
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});
exports.forbiddenResponse=()=>Response.json({error:'Forbidden'},{status:403});`);
const token = seam('token.cjs', `exports.requireLocalApiToken=(request)=>request.headers.get('authorization')==='Bearer c05-observation-synthetic-token'?null:Response.json({error:'Unauthorized'},{status:401});
exports.hasValidLocalApiToken=(request)=>request.headers.get('authorization')==='Bearer c05-observation-synthetic-token';`);
const network = seam('network.cjs', `const state=globalThis[Symbol.for(${JSON.stringify(`c05-observation-seam-${dataDir}`)})];
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
const { dbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const { ambulatories, patients, patientsToAmbulatories, observations, servicePrescriptions, servicePrescriptionItems } = load('./schema.ts') as typeof import('./schema.ts');
const webCreate = load('../app/api/observations/route.ts') as typeof import('../app/api/observations/route.ts');
const webItem = load('../app/api/observations/[id]/route.ts') as typeof import('../app/api/observations/[id]/route.ts');
const v1Create = load('../app/api/v1/patients/[id]/observations/route.ts') as typeof import('../app/api/v1/patients/[id]/observations/route.ts');
const v1Item = load('../app/api/v1/patients/[id]/observations/[observationId]/route.ts') as typeof import('../app/api/v1/patients/[id]/observations/[observationId]/route.ts');
const networkCreate = load('../app/api/v1/network/patients/[id]/observations/route.ts') as typeof import('../app/api/v1/network/patients/[id]/observations/route.ts');
const networkItem = load('../app/api/v1/network/patients/[id]/observations/[observationId]/route.ts') as typeof import('../app/api/v1/network/patients/[id]/observations/[observationId]/route.ts');
const sql = new Database(join(dataDir, 'medical.db'));
const records: Record<string, unknown>[] = [];
let serial = 0;
const nextId = (name: string) => `c05-observation-${++serial}-${name}`;

test.after(() => {
    const report = process.env.MEDIFLOW_OBSERVATION_CANDIDATE_REPORT;
    if (report) writeFileSync(report, `${JSON.stringify({ records }, null, 2)}\n`);
    sql.close(); dbServer.$client.close(); hooks.deregister();
    delete (globalThis as unknown as Record<symbol, typeof state>)[stateKey];
    rmSync(dataDir, { recursive: true, force: true });
});

function seed(name: string, withObservation: boolean, deleted = false, archived = false) {
    const patientId = nextId(`${name}-patient`);
    const observationId = nextId(`${name}-observation`);
    dbServer.insert(ambulatories).values({ id: 'c05-observation-a', name: 'Synthetic observation ambulatory', type: 'live' }).onConflictDoNothing().run();
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient',
        taxCode: `SYN${serial}`, deletedAt: deleted ? new Date('2026-01-01T00:00:00Z') : null,
        notes: 'ENC:synthetic:patient', isArchived: archived }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: 'c05-observation-a' }).run();
    if (withObservation) dbServer.insert(observations).values({ id: observationId, patientId,
        codeSystem: 'LOINC', code: 'synthetic-code', display: 'Synthetic observation',
        unitSystem: 'UCUM', unitCode: 'mg/dL', value: '42', notes: 'ENC:synthetic:notes',
        observedAt: new Date('2026-01-01T00:00:00Z'), version: 3,
        refLow: '< 3', refHigh: 'Negativo', refText: 'synthetic range' }).run();
    return { patientId, observationId };
}

function readBack(patientId: string, observationId: string) {
    const fresh = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try {
        return {
            observation: fresh.prepare('SELECT * FROM observations WHERE id=?').get(observationId) ?? null,
            allPatientObservations: fresh.prepare('SELECT * FROM observations WHERE patient_id=? ORDER BY id').all(patientId),
            patient: fresh.prepare('SELECT * FROM patients WHERE id=?').get(patientId) ?? null,
            membership: fresh.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id').all(patientId),
            servicePrescriptions: fresh.prepare('SELECT * FROM service_prescriptions WHERE patient_id=? ORDER BY id').all(patientId),
            serviceItems: fresh.prepare('SELECT * FROM service_prescription_items WHERE patient_id=? ORDER BY id').all(patientId),
            audit: fresh.prepare("SELECT * FROM audit_events WHERE subject_type='observation' AND (subject_ref=? OR subject_ref IN (SELECT id FROM observations WHERE patient_id=?)) ORDER BY rowid").all(observationId, patientId),
            auditAll: fresh.prepare("SELECT * FROM audit_events WHERE subject_type='observation' ORDER BY rowid").all(),
        };
    } finally { fresh.close(); }
}

type Surface = 'web' | 'v1' | 'network';
type Operation = 'POST' | 'PUT' | 'DELETE';
function request(method: Operation, body: unknown, surface: Surface, raw?: string, headers: Record<string,string> = {}) {
    return new Request('http://127.0.0.1/api/observations', { method,
        headers: { 'content-type': 'application/json', ...(surface === 'web' ? {} : { authorization: 'Bearer c05-observation-synthetic-token' }), ...headers },
        body: raw ?? JSON.stringify(body),
    });
}
async function invoke(surface: Surface, operation: Operation, ids: { patientId: string; observationId: string }, body: unknown,
    raw?: string, headers: Record<string,string> = {}) {
    const req = request(operation, body, surface, raw, headers);
    if (surface === 'web') return operation === 'POST' ? webCreate.POST(req)
        : operation === 'PUT' ? webItem.PUT(req, { params: Promise.resolve({ id: ids.observationId }) })
            : webItem.DELETE(req, { params: Promise.resolve({ id: ids.observationId }) });
    if (surface === 'v1') return operation === 'POST' ? v1Create.POST(req, { params: Promise.resolve({ id: ids.patientId }) })
        : operation === 'PUT' ? v1Item.PUT(req, { params: Promise.resolve({ id: ids.patientId, observationId: ids.observationId }) })
            : v1Item.DELETE(req, { params: Promise.resolve({ id: ids.patientId, observationId: ids.observationId }) });
    return operation === 'POST' ? networkCreate.POST(req, { params: Promise.resolve({ id: ids.patientId }) })
        : networkItem.PUT(req, { params: Promise.resolve({ id: ids.patientId, observationId: ids.observationId }) });
}
function validBody(surface: Surface, operation: Operation, ids: { patientId: string; observationId: string }) {
    if (operation === 'POST') return { id: ids.observationId, ...(surface === 'web' ? { patientId: ids.patientId } : {}),
        codeSystem: 'loinc', code: 'synthetic-code', display: 'Synthetic observation',
        unitSystem: 'ucum', unitCode: 'mg/dL', value: 42, notes: 'ENC:synthetic:notes',
        observedAt: '2026-05-02T09:00:00.000Z', refLow: '< 3', refHigh: 'Negativo', refText: 'synthetic range' };
    if (operation === 'DELETE') return { version: 3, deletionReason: 'ENC:synthetic:reason' };
    return { version: 3, value: 'qualitativo', notes: 'ENC:synthetic:newnotes' };
}
async function capture(name: string, surface: Surface, operation: Operation, options: {
    body?: unknown; raw?: string; deletedPatient?: boolean; archivedPatient?: boolean;
    routePatientId?: string; routeObservationId?: string; change?: (body: Record<string,unknown>) => unknown;
    headers?: Record<string,string>; wrongScope?: boolean; seedObservation?: boolean; deletedObservation?: boolean;
    link?: 'same' | 'cross' | 'missing' | 'null' | 'blank'; prelinked?: boolean; missingParent?: boolean;
} = {}) {
    const ids = seed(name, options.seedObservation ?? operation !== 'POST', options.deletedPatient, options.archivedPatient);
    if (options.missingParent) {
        sql.pragma('foreign_keys = OFF');
        try { sql.prepare('DELETE FROM patients WHERE id=?').run(ids.patientId); }
        finally { sql.pragma('foreign_keys = ON'); }
    }
    let linkId: string | null = null;
    if (options.link === 'same' || options.link === 'cross') {
        const linkedPatientId = options.link === 'cross' ? seed(`${name}-other-link-patient`, false).patientId : ids.patientId;
        const prescriptionId = nextId(`${name}-prescription`);
        linkId = nextId(`${name}-item`);
        dbServer.insert(servicePrescriptions).values({ id: prescriptionId, patientId: linkedPatientId,
            prescribedAt: new Date('2026-01-01T00:00:00Z'), serviceName: 'Synthetic service' }).run();
        dbServer.insert(servicePrescriptionItems).values({ id: linkId, patientId: linkedPatientId,
            prescriptionId, serviceName: 'Synthetic service item' }).run();
    }
    if (options.prelinked) {
        const prescriptionId = nextId(`${name}-existing-prescription`);
        const itemId = nextId(`${name}-existing-item`);
        dbServer.insert(servicePrescriptions).values({ id: prescriptionId, patientId: ids.patientId,
            prescribedAt: new Date('2026-01-01T00:00:00Z'), serviceName: 'Synthetic existing service' }).run();
        dbServer.insert(servicePrescriptionItems).values({ id: itemId, patientId: ids.patientId,
            prescriptionId, serviceName: 'Synthetic existing item' }).run();
        dbServer.update(observations).set({ servicePrescriptionItemId: itemId })
            .where(eq(observations.id, ids.observationId)).run();
    }
    if (options.deletedObservation) sql.prepare('UPDATE observations SET deleted_at=?, deletion_reason=? WHERE id=?')
        .run(1_767_225_600, 'ENC:synthetic:old-reason', ids.observationId);
    const before = readBack(ids.patientId, ids.observationId);
    const routeIds = { ...ids, patientId: options.routePatientId ?? ids.patientId,
        observationId: options.routeObservationId ?? ids.observationId };
    const original = validBody(surface, operation, ids);
    const withLink = options.link ? { ...original, servicePrescriptionItemId: options.link === 'missing'
        ? nextId(`${name}-absent-item`) : options.link === 'blank' ? '   ' : linkId } : original;
    const body = options.body !== undefined ? options.body : options.change?.(withLink) ?? withLink;
    const priorScope = state.scopeAmbulatoryId;
    if (options.wrongScope) state.scopeAmbulatoryId = 'c05-observation-other';
    let response: Response;
    try { response = await invoke(surface, operation, routeIds, body, options.raw, options.headers); }
    finally { state.scopeAmbulatoryId = priorScope; }
    const text = await response.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = { unparsed: text }; }
    const after = readBack(ids.patientId, ids.observationId);
    const result = { name, surface, operation, status: response.status, json,
        changed: JSON.stringify(after) !== JSON.stringify(before),
        observationChanged: JSON.stringify(after.allPatientObservations) !== JSON.stringify(before.allPatientObservations),
        auditDelta: after.auditAll.length - before.auditAll.length, before, after };
    records.push(result);
    return { ...result, ids };
}

const surfaces = ['web', 'v1', 'network'] as const;
function operations(surface: Surface): Operation[] {
    return surface === 'network' ? ['POST', 'PUT'] : ['POST', 'PUT', 'DELETE'];
}

/* @Codex: the fault is on the real audit table, after the real route reaches its mutation. */
test('all eight observation writes roll back on audit FAIL and IGNORE', async () => {
    for (const surface of surfaces) for (const operation of operations(surface)) {
        for (const fault of ['FAIL', 'IGNORE'] as const) {
            sql.exec(`CREATE TRIGGER synthetic_observation_audit_fault BEFORE INSERT ON audit_events BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic audit fault'" : ''}); END`);
            try {
                const result = await capture(`${surface}-${operation}-audit-${fault}`, surface, operation);
                assert.equal(result.status, 500, result.name);
                assert.deepEqual(result.after, result.before, result.name);
            } finally { sql.exec('DROP TRIGGER synthetic_observation_audit_fault'); }
        }
    }
});

test('eight ordinary writes commit one row and exactly one required audit event', async () => {
    for (const surface of surfaces) for (const operation of operations(surface)) {
        const result = await capture(`${surface}-${operation}-normal`, surface, operation);
        assert.equal(result.status, operation === 'POST' ? 201 : 200, result.name);
        assert.equal(result.auditDelta, 1, result.name);
        assert.equal(result.observationChanged, true, result.name);
        assert.deepEqual(result.after.patient, result.before.patient);
        assert.deepEqual(result.after.membership, result.before.membership);
        const event = result.after.audit.at(-1) as Record<string, unknown>;
        assert.equal(event.subject_ref, result.ids.observationId);
        assert.equal(event.subject_type, 'observation');
        if (operation === 'POST') assert.equal(event.event_type, 'observation.created');
        if (operation === 'PUT') assert.equal(event.event_type, 'observation.updated');
        if (operation === 'DELETE') assert.equal(event.event_type, 'observation.deleted');
        assert.equal(event.actor_type, 'user');
        assert.equal(event.actor_ref, surface === 'v1' ? 'synthetic-local' : 'synthetic-admin');
        const metadata = JSON.parse(event.redacted_metadata as string) as {
            changedFields: string[]; flags: string[]; resourceVersion: number;
        };
        assert.equal(metadata.resourceVersion, operation === 'POST' ? 1 : 4);
        assert.ok(metadata.changedFields.length > 0);
        if (surface === 'network') {
            assert.ok(metadata.flags.includes('auth:paired-client'));
            assert.ok(metadata.flags.includes('scope:ambulatory'));
        }
        assert.ok(!JSON.stringify(event).includes('ENC:synthetic:'));
    }
});

test('audit changedFields omits host-owned create timestamps and retains applied v1 PUT updatedAt', async () => {
    for (const surface of ['web', 'v1'] as const) {
        const created = await capture(`${surface}-host-timestamps-audit`, surface, 'POST', {
            change: (body) => ({ ...body, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-02T00:00:00.000Z' }),
        });
        assert.equal(created.status, 201, created.name);
        const event = created.after.audit.at(-1) as Record<string, unknown>;
        const metadata = JSON.parse(event.redacted_metadata as string) as { changedFields: string[] };
        for (const name of ['id', 'patientId', 'createdAt', 'updatedAt']) {
            assert.equal(metadata.changedFields.includes(name), false, `${created.name}: ${name}`);
        }
    }
    const updated = await capture('v1-applied-updatedAt-audit', 'v1', 'PUT', {
        change: (body) => ({ ...body, updatedAt: '2020-01-03T00:00:00.000Z' }),
    });
    assert.equal(updated.status, 200, updated.name);
    const event = updated.after.audit.at(-1) as Record<string, unknown>;
    const metadata = JSON.parse(event.redacted_metadata as string) as { changedFields: string[] };
    assert.equal(metadata.changedFields.includes('updatedAt'), true);
});

test('matched INSERT and UPDATE IGNORE cannot report success or append audit', async () => {
    for (const surface of surfaces) for (const operation of operations(surface)) {
        const timing = operation === 'POST' ? 'INSERT' : 'UPDATE';
        sql.exec(`CREATE TRIGGER synthetic_observation_domain_ignore BEFORE ${timing} ON observations BEGIN SELECT RAISE(IGNORE); END`);
        try {
            const result = await capture(`${surface}-${operation}-domain-IGNORE`, surface, operation);
            assert.equal(result.status, 500, result.name);
            assert.deepEqual(result.after, result.before, result.name);
        } finally { sql.exec('DROP TRIGGER synthetic_observation_domain_ignore'); }
    }
});

test('all eight writes gate missing and tombstoned parents; archived parents remain admitted', async () => {
    for (const surface of surfaces) for (const operation of operations(surface)) {
        const missing = await capture(`${surface}-${operation}-missing-parent-record`, surface, operation,
            { missingParent: true });
        assert.equal(missing.status, 404, missing.name);
        assert.deepEqual(missing.after, missing.before, missing.name);
        const deleted = await capture(`${surface}-${operation}-tombstoned-parent`, surface, operation,
            { deletedPatient: true });
        assert.equal(deleted.status, 404, deleted.name);
        assert.deepEqual(deleted.after, deleted.before, deleted.name);
        const archived = await capture(`${surface}-${operation}-archived-parent`, surface, operation,
            { archivedPatient: true });
        assert.equal(archived.status, operation === 'POST' ? 201 : 200, archived.name);
        assert.equal(archived.auditDelta, 1, archived.name);
        assert.equal(archived.observationChanged, true, archived.name);
    }
});

test('Web-only service result link stays same-patient, nullable and transaction-bound', async () => {
    for (const operation of ['POST', 'PUT'] as const) {
        const same = await capture(`web-${operation}-link-same`, 'web', operation, { link: 'same' });
        assert.equal(same.status, operation === 'POST' ? 201 : 200);
        assert.equal(same.auditDelta, 1);
        assert.ok((same.after.observation as Record<string, unknown>).service_prescription_item_id);
        for (const link of ['missing', 'cross'] as const) {
            const result = await capture(`web-${operation}-link-${link}`, 'web', operation, { link });
            assert.equal(result.status, 422, result.name);
            assert.deepEqual(result.after, result.before, result.name);
        }
    }
    for (const link of ['null', 'blank'] as const) {
        const result = await capture(`web-PUT-link-${link}`, 'web', 'PUT', { link, prelinked: true });
        assert.equal(result.status, 200);
        assert.equal((result.after.observation as Record<string, unknown>).service_prescription_item_id, null);
        assert.equal(result.auditDelta, 1);
    }
    const omitted = await capture('web-PUT-link-omitted', 'web', 'PUT', { prelinked: true });
    assert.equal(omitted.status, 200);
    assert.equal((omitted.after.observation as Record<string, unknown>).service_prescription_item_id,
        (omitted.before.observation as Record<string, unknown>).service_prescription_item_id);
    // @Codex: v1/network do not gain the Web-only result-link capability, even for an absent item.
    for (const surface of ['v1', 'network'] as const) {
        for (const operation of ['POST', 'PUT'] as const) {
            const result = await capture(`${surface}-${operation}-link-not-exposed`, surface, operation,
                { link: 'missing', prelinked: operation === 'PUT' });
            assert.equal(result.status, 400);
            assert.deepEqual(result.after, result.before);
        }
    }
});

test('scope and stale versions reject without any row or audit change', async () => {
    for (const operation of ['POST', 'PUT'] as const) {
        const out = await capture(`network-${operation}-other-scope`, 'network', operation,
            { wrongScope: true });
        assert.equal(out.status, 404);
        assert.deepEqual(out.after, out.before);
    }
    for (const surface of surfaces) {
        const stale = await capture(`${surface}-PUT-stale`, surface, 'PUT',
            { change: (body) => ({ ...body, version: 2 }) });
        assert.equal(stale.status, 409);
        assert.deepEqual(stale.after, stale.before);
        if (surface !== 'web') {
            const otherPatient = seed(`${surface}-other-patient-scope`, false);
            const wrong = await capture(`${surface}-PUT-wrong-patient`, surface, 'PUT',
                { routePatientId: otherPatient.patientId });
            assert.equal(wrong.status, 404);
            assert.deepEqual(wrong.after, wrong.before);
        }
    }
    for (const surface of ['web', 'v1'] as const) {
        const stale = await capture(`${surface}-DELETE-stale`, surface, 'DELETE',
            { change: (body) => ({ ...body, version: 2 }) });
        assert.equal(stale.status, 409);
        assert.deepEqual(stale.after, stale.before);
    }
});

test('value, code, nullable reference and source normalization retain existing semantics', async () => {
    for (const surface of surfaces) {
        for (const value of [0, 42, 'qualitativo']) {
            const result = await capture(`${surface}-POST-value-${String(value)}`, surface, 'POST',
                { change: (body) => ({ ...body, value }) });
            assert.equal(result.status, 201);
            assert.equal((result.after.observation as Record<string, unknown>).value, String(value));
        }
        const refs = await capture(`${surface}-POST-code-and-reference`, surface, 'POST',
            { change: (body) => ({ ...body, codeSystem: 'loinc', unitSystem: 'ucum',
                refLow: null, refHigh: 'Negativo', refText: null }) });
        assert.equal(refs.status, 201);
        const row = refs.after.observation as Record<string, unknown>;
        assert.equal(row.code_system, 'LOINC'); assert.equal(row.unit_system, 'UCUM');
        assert.equal(row.ref_low, null); assert.equal(row.ref_high, 'Negativo');
        assert.equal(row.ref_text, null);
        const ai = await capture(`${surface}-POST-ai-source`, surface, 'POST',
            { change: (body) => ({ ...body, source: 'ai_suggestion' }) });
        assert.equal(ai.status, 201);
        assert.equal((ai.after.observation as Record<string, unknown>).source, 'ai_suggestion');
        const manual = await capture(`${surface}-POST-null-source`, surface, 'POST',
            { change: (body) => ({ ...body, source: null }) });
        assert.equal(manual.status, 201);
        assert.equal((manual.after.observation as Record<string, unknown>).source, 'manual');
        const clear = await capture(`${surface}-PUT-null-source`, surface, 'PUT',
            { change: (body) => ({ ...body, source: null }) });
        assert.equal(clear.status, 200);
        assert.equal((clear.after.observation as Record<string, unknown>).source, null);
    }
});

test('Web actor is authoritative session despite local bearer and forged surface', async () => {
    const result = await capture('web-POST-forged-headers', 'web', 'POST',
        { headers: { authorization: 'Bearer c05-observation-synthetic-token',
            'x-mediflow-source-surface': 'job', 'x-actor-ref': 'synthetic-forged' } });
    assert.equal(result.status, 201);
    const event = result.after.audit.at(-1) as Record<string, unknown>;
    assert.equal(event.actor_ref, 'synthetic-admin');
    assert.equal(event.actor_type, 'user');
    assert.equal(event.source_surface, 'web');
});

test('explicit PUT restore remains available on Web, v1 and paired network', async () => {
    for (const surface of surfaces) {
        const result = await capture(`${surface}-PUT-restore`, surface, 'PUT',
            { deletedObservation: true,
                change: (body) => ({ ...body, deletedAt: null, deletionReason: null }) });
        assert.equal(result.status, 200);
        assert.equal((result.before.observation as Record<string, unknown>).deleted_at !== null, true);
        assert.equal((result.after.observation as Record<string, unknown>).deleted_at, null);
        assert.equal(result.auditDelta, 1);
        const event = result.after.audit.at(-1) as Record<string, unknown>;
        assert.equal(event.event_type, 'observation.updated');
        assert.deepEqual(result.after.patient, result.before.patient);
        assert.deepEqual(result.after.membership, result.before.membership);
    }
});

test('duplicate create is 409 only after admissible parent and never replays a write or audit', async () => {
    for (const surface of surfaces) {
        const ids = seed(`${surface}-duplicate-candidate`, false);
        const body = validBody(surface, 'POST', ids);
        const before = readBack(ids.patientId, ids.observationId);
        const first = await invoke(surface, 'POST', ids, body);
        assert.equal(first.status, 201);
        const firstJson = await first.json();
        const afterFirst = readBack(ids.patientId, ids.observationId);
        const second = await invoke(surface, 'POST', ids, body);
        assert.equal(second.status, 409);
        const secondJson = await second.json();
        const afterSecond = readBack(ids.patientId, ids.observationId);
        assert.deepEqual(afterSecond, afterFirst);
        assert.equal(afterFirst.auditAll.length - before.auditAll.length, 1);
        records.push({ name: `${surface}-duplicate-candidate`, firstStatus: first.status,
            firstJson, secondStatus: second.status, secondJson, before, afterFirst, afterSecond });
        if (surface === 'network') {
            const denied = await capture('network-duplicate-out-of-scope', 'network', 'POST',
                { wrongScope: true, change: (newBody) => ({ ...newBody, id: ids.observationId }) });
            assert.equal(denied.status, 404);
            assert.deepEqual(denied.after, denied.before);
        }
    }
});

test('all eight routes reject malformed envelopes and unknown own keys with no effects', async () => {
    for (const surface of surfaces) for (const operation of operations(surface)) {
        for (const raw of ['null', '[]', '"primitive"', '42', 'true', '{']) {
            const result = await capture(`${surface}-${operation}-envelope-${raw}`, surface, operation, { raw });
            assert.equal(result.status, 400, result.name);
            assert.deepEqual(result.after, result.before, result.name);
        }
        const unknown = await capture(`${surface}-${operation}-unknown-own`, surface, operation,
            { change: (body) => ({ ...body, clinicalSentinel: 'synthetic-sentinel' }) });
        assert.equal(unknown.status, 400);
        assert.deepEqual(unknown.after, unknown.before);
    }
    const prototype = await capture('web-POST-prototype-own', 'web', 'POST',
        { raw: JSON.stringify(validBody('web', 'POST', { patientId: 'placeholder', observationId: 'placeholder' }))
            .replace('"id":', '"__proto__":{"clinicalSentinel":"synthetic"},"id":') });
    assert.equal(prototype.status, 400);
    assert.deepEqual(prototype.after, prototype.before);
});

test('unsupported link keys, local PUT identity keys and date primitives reject before effects', async () => {
    for (const surface of ['v1', 'network'] as const) for (const operation of ['POST', 'PUT'] as const) {
        for (const link of [null, 'synthetic-foreign-item']) {
            const result = await capture(`${surface}-${operation}-unsupported-link-${String(link)}`, surface, operation,
                { change: (body) => ({ ...body, servicePrescriptionItemId: link }) });
            assert.equal(result.status, 400);
            assert.deepEqual(result.after, result.before);
        }
    }
    for (const surface of ['web', 'v1'] as const) {
        for (const field of ['id', 'patientId', 'createdAt']) {
            const result = await capture(`${surface}-PUT-forbidden-${field}`, surface, 'PUT',
                { change: (body) => ({ ...body, [field]: 'synthetic-foreign' }) });
            assert.equal(result.status, 400);
            assert.deepEqual(result.after, result.before);
        }
        const missing = await capture(`${surface}-PUT-missing-before-invalid`, surface, 'PUT',
            { routeObservationId: 'synthetic-absent-observation', change: (body) => ({ ...body, value: true }) });
        assert.equal(missing.status, 404);
        assert.deepEqual(missing.after, missing.before);
        for (const field of ['createdAt', 'updatedAt']) {
            const invalid = await capture(`${surface}-POST-invalid-${field}`, surface, 'POST',
                { change: (body) => ({ ...body, [field]: true }) });
            assert.equal(invalid.status, 400);
            assert.deepEqual(invalid.after, invalid.before);
            const valid = await capture(`${surface}-POST-valid-${field}`, surface, 'POST',
                { change: (body) => ({ ...body, [field]: '2000-01-01T00:00:00Z' }) });
            assert.equal(valid.status, 201);
            assert.notEqual((valid.after.observation as Record<string, unknown>)[field === 'createdAt' ? 'created_at' : 'updated_at'], 946684800);
        }
    }
    for (const surface of surfaces) for (const operation of ['POST', 'PUT'] as const) {
        for (const value of [true, [], {}]) {
            const invalid = await capture(`${surface}-${operation}-date-${JSON.stringify(value)}`, surface, operation,
                { change: (body) => ({ ...body, observedAt: value }) });
            assert.equal(invalid.status, 400);
            assert.deepEqual(invalid.after, invalid.before);
        }
    }
});

test('explicit create IDs and incrementable versions are enforced without UUID-only policy', async () => {
    for (const surface of surfaces) {
        for (const id of [null, 42, '   ']) {
            const result = await capture(`${surface}-POST-invalid-id-${String(id)}`, surface, 'POST',
                { change: (body) => ({ ...body, id }) });
            assert.equal(result.status, 400);
            assert.deepEqual(result.after, result.before);
        }
        const opaque = await capture(`${surface}-POST-opaque-id`, surface, 'POST');
        assert.equal(opaque.status, 201);
        const omitted = await capture(`${surface}-POST-id-omitted`, surface, 'POST',
            { change: (body) => { const { id: _omitted, ...rest } = body; return rest; } });
        assert.equal(omitted.status, 201);
        assert.equal(omitted.after.allPatientObservations.length, 1);
        for (const version of [0, -1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
            const bad = await capture(`${surface}-PUT-version-${version}`, surface, 'PUT',
                { change: (body) => ({ ...body, version }) });
            assert.equal(bad.status, 400);
            assert.deepEqual(bad.after, bad.before);
        }
    }
});

test('six local mutations reject over 4 MiB after auth without row or audit effects', async () => {
    const maximum = 4_194_304;
    for (const surface of ['web', 'v1'] as const) for (const operation of operations(surface)) {
        const ids = seed(`${surface}-${operation}-oversized`, operation !== 'POST');
        const before = readBack(ids.patientId, ids.observationId);
        const raw = JSON.stringify(validBody(surface, operation, ids));
        const oversized = raw.slice(0, -1) + ' '.repeat(maximum + 1 - Buffer.byteLength(raw)) + '}';
        assert.equal(Buffer.byteLength(oversized), maximum + 1);
        const response = await invoke(surface, operation, ids, null, oversized);
        assert.equal(response.status, 413);
        assert.deepEqual(readBack(ids.patientId, ids.observationId), before);
        records.push({ name: `${surface}-${operation}-oversized`, status: response.status,
            json: await response.json(), before, after: readBack(ids.patientId, ids.observationId) });
    }
});
