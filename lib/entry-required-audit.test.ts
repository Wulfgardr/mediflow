/* @Codex: real SQLite candidate oracle for the eight ordinary diary mutations. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-c05-diary-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
process.env.MEDIFLOW_LOCAL_API_TOKEN = 'c05-diary-synthetic-token';
const state: { session: Record<string, unknown> | null } = {
    session: { id: 'synthetic-web', userId: 'synthetic-admin', role: 'admin', authChannel: 'web' },
};
const stateKey = Symbol.for(`c05-diary-seam-${dataDir}`);
(globalThis as unknown as Record<symbol, typeof state>)[stateKey] = state;
const seam = (name: string, source: string) => {
    const path = join(dataDir, name);
    writeFileSync(path, source, { mode: 0o600 });
    return pathToFileURL(path).href;
};
const auth = seam('auth.cjs', `const state=globalThis[Symbol.for(${JSON.stringify(`c05-diary-seam-${dataDir}`)})];
exports.requireSession=async()=>state.session;
exports.requireLocalApiActorSession=async()=>({id:'synthetic-local',userId:'synthetic-local',role:'admin',authChannel:'system'});
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});
exports.forbiddenResponse=()=>Response.json({error:'Forbidden'},{status:403});`);
const token = seam('token.cjs', `exports.requireLocalApiToken=(request)=>request.headers.get('authorization')==='Bearer c05-diary-synthetic-token'?null:Response.json({error:'Unauthorized'},{status:401});
exports.hasValidLocalApiToken=(request)=>request.headers.get('authorization')==='Bearer c05-diary-synthetic-token';`);
const network = seam('network.cjs', `exports.requireNetworkWriteContext=async(request)=>({ok:true,context:{request,scopeAmbulatoryId:'c05-diary-a',pairedClient:{clientId:'synthetic-paired'},session:{id:'synthetic-native',userId:'synthetic-admin',role:'admin',authChannel:'native'}}});`);
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
const { ambulatories, patients, patientsToAmbulatories, entries } = load('./schema.ts') as typeof import('./schema.ts');
const webCreate = load('../app/api/entries/route.ts') as typeof import('../app/api/entries/route.ts');
const webItem = load('../app/api/entries/[id]/route.ts') as typeof import('../app/api/entries/[id]/route.ts');
const v1Create = load('../app/api/v1/patients/[id]/entries/route.ts') as typeof import('../app/api/v1/patients/[id]/entries/route.ts');
const v1Item = load('../app/api/v1/patients/[id]/entries/[entryId]/route.ts') as typeof import('../app/api/v1/patients/[id]/entries/[entryId]/route.ts');
const networkCreate = load('../app/api/v1/network/patients/[id]/entries/route.ts') as typeof import('../app/api/v1/network/patients/[id]/entries/route.ts');
const networkItem = load('../app/api/v1/network/patients/[id]/entries/[entryId]/route.ts') as typeof import('../app/api/v1/network/patients/[id]/entries/[entryId]/route.ts');
const sql = new Database(join(dataDir, 'medical.db'));
const observations: Record<string, unknown>[] = [];
let serial = 0;
const nextId = (name: string) => `c05-diary-${++serial}-${name}`;

test.after(() => {
    const report = process.env.MEDIFLOW_DIARY_CANDIDATE_REPORT;
    if (report) writeFileSync(report, `${JSON.stringify({ observations }, null, 2)}\n`);
    sql.close(); dbServer.$client.close(); hooks.deregister();
    delete (globalThis as unknown as Record<symbol, typeof state>)[stateKey];
    rmSync(dataDir, { recursive: true, force: true });
});

function seed(name: string, withEntry: boolean, deleted = false, archived = false) {
    const patientId = nextId(`${name}-patient`);
    const entryId = nextId(`${name}-entry`);
    dbServer.insert(ambulatories).values({ id: 'c05-diary-a', name: 'Synthetic diary ambulatory', type: 'live' }).onConflictDoNothing().run();
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient',
        taxCode: `SYN${serial}`, deletedAt: deleted ? new Date('2026-01-01T00:00:00Z') : null,
        notes: 'ENC:synthetic:patient', isArchived: archived }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: 'c05-diary-a' }).run();
    if (withEntry) dbServer.insert(entries).values({ id: entryId, patientId, type: 'note', title: 'ENC:synthetic:title',
        content: 'ENC:synthetic:content', date: new Date('2026-01-01T00:00:00Z'), version: 3,
        metadata: 'ENC:synthetic:metadata' }).run();
    return { patientId, entryId };
}

function readBack(patientId: string, entryId: string) {
    const fresh = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try {
        return {
            entry: fresh.prepare('SELECT * FROM entries WHERE id=?').get(entryId) ?? null,
            allPatientEntries: fresh.prepare('SELECT * FROM entries WHERE patient_id=? ORDER BY id').all(patientId),
            patient: fresh.prepare('SELECT * FROM patients WHERE id=?').get(patientId) ?? null,
            memberships: fresh.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id').all(patientId),
            audit: fresh.prepare("SELECT * FROM audit_events WHERE subject_type='entry' AND (subject_ref=? OR subject_ref IN (SELECT id FROM entries WHERE patient_id=?)) ORDER BY rowid").all(entryId, patientId),
        };
    } finally { fresh.close(); }
}

function request(method: string, body: unknown, surface: string, raw?: string, extraHeaders: Record<string, string> = {}) {
    return new Request('http://127.0.0.1/api/entries', { method,
        headers: { 'content-type': 'application/json', ...(surface === 'web' ? {} : { authorization: 'Bearer c05-diary-synthetic-token' }),
            ...extraHeaders },
        body: raw ?? JSON.stringify(body),
    });
}

type Surface = 'web' | 'v1' | 'network';
type Operation = 'POST' | 'PUT' | 'DELETE';
async function invoke(surface: Surface, operation: Operation, ids: { patientId: string; entryId: string }, body: unknown,
    raw?: string, extraHeaders: Record<string, string> = {}, suppliedRequest?: Request) {
    const req = suppliedRequest ?? request(operation, body, surface, raw, extraHeaders);
    if (surface === 'web') {
        return operation === 'POST' ? webCreate.POST(req)
            : operation === 'PUT' ? webItem.PUT(req, { params: Promise.resolve({ id: ids.entryId }) })
                : webItem.DELETE(req, { params: Promise.resolve({ id: ids.entryId }) });
    }
    if (surface === 'v1') {
        return operation === 'POST' ? v1Create.POST(req, { params: Promise.resolve({ id: ids.patientId }) })
            : operation === 'PUT' ? v1Item.PUT(req, { params: Promise.resolve({ id: ids.patientId, entryId: ids.entryId }) })
                : v1Item.DELETE(req, { params: Promise.resolve({ id: ids.patientId, entryId: ids.entryId }) });
    }
    return operation === 'POST' ? networkCreate.POST(req, { params: Promise.resolve({ id: ids.patientId }) })
        : networkItem.PUT(req, { params: Promise.resolve({ id: ids.patientId, entryId: ids.entryId }) });
}

function validBody(surface: Surface, operation: Operation, ids: { patientId: string; entryId: string }) {
    if (operation === 'POST') return {
        id: ids.entryId, ...(surface === 'web' ? { patientId: ids.patientId } : {}),
        type: 'note', date: '2026-05-02T09:00:00.000Z',
        title: 'ENC:dGl0bGVpdg==:dGl0bGVjaXBoZXI=', content: 'ENC:Y29udGVudGl2:Y29udGVudGNpcGhlcg==',
    };
    if (operation === 'DELETE') return { version: 3, deletionReason: 'ENC:synthetic:reason' };
    return { version: 3, title: 'ENC:dGl0bGVpdg==:dGl0bGVjaXBoZXI=' };
}

async function capture(name: string, surface: Surface, operation: Operation, options: {
    body?: unknown; raw?: string; deletedPatient?: boolean; routePatientId?: string;
    mutateBody?: (body: Record<string, unknown>) => unknown; headers?: Record<string, string>;
} = {}) {
    const ids = seed(name, operation !== 'POST', options.deletedPatient);
    const before = readBack(ids.patientId, ids.entryId);
    const routeIds = { ...ids, patientId: options.routePatientId ?? ids.patientId };
    const body = options.body ?? options.mutateBody?.(validBody(surface, operation, ids)) ?? validBody(surface, operation, ids);
    const response = await invoke(surface, operation, routeIds, body, options.raw, options.headers);
    const after = readBack(ids.patientId, ids.entryId);
    const rowChanged = JSON.stringify(after.allPatientEntries) !== JSON.stringify(before.allPatientEntries);
    const restUnchanged = JSON.stringify(after.patient) === JSON.stringify(before.patient)
        && JSON.stringify(after.memberships) === JSON.stringify(before.memberships);
    observations.push({ name, surface, operation, status: response.status,
        entryChanged: rowChanged, patientAndMembershipUnchanged: restUnchanged,
        auditCount: after.audit.length, before, after });
    assert.equal(restUnchanged, true);
    return { response, before, after, ids };
}

function assertRejected(result: Awaited<ReturnType<typeof capture>>, status: number) {
    assert.equal(result.response.status, status);
    assert.deepEqual(result.after, result.before);
}

function assertAccepted(result: Awaited<ReturnType<typeof capture>>, status: number) {
    assert.equal(result.response.status, status);
    assert.notDeepEqual(result.after.allPatientEntries, result.before.allPatientEntries);
    assert.equal(result.after.audit.length, 1);
}

for (const surface of ['web', 'v1', 'network'] as const) {
    for (const operation of (surface === 'network' ? ['POST', 'PUT'] : ['POST', 'PUT', 'DELETE']) as Operation[]) {
        for (const fault of ['FAIL', 'IGNORE'] as const) {
            test(`${surface} ${operation} audit INSERT ${fault} candidate`, async () => {
                sql.exec(`CREATE TRIGGER c05_diary_audit_fault BEFORE INSERT ON audit_events BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic audit fault'" : ''}); END`);
                try {
                    const result = await capture(`${surface}-${operation}-${fault}`, surface, operation);
                    assert.equal(result.after.audit.length, 0);
                    assert.equal(result.response.status, 500);
                    assert.deepEqual(result.after, result.before);
                } finally { sql.exec('DROP TRIGGER c05_diary_audit_fault'); }
            });
        }
    }
}

for (const surface of ['web', 'v1', 'network'] as const) {
    for (const operation of ['POST', 'PUT'] as const) {
        for (const raw of ['null', '[]', '{']) {
            test(`${surface} ${operation} envelope ${raw}`, async () => {
                assertRejected(await capture(`${surface}-${operation}-envelope-${raw}`, surface, operation, { raw }), 400);
            });
        }
    }
}

for (const surface of ['web', 'v1'] as const) {
    for (const raw of ['null', '[]', '{']) {
        test(`${surface} DELETE envelope ${raw}`, async () => {
            assertRejected(await capture(`${surface}-DELETE-envelope-${raw}`, surface, 'DELETE', { raw }), 400);
        });
    }
}

for (const surface of ['web', 'v1', 'network'] as const) {
    for (const operation of ['POST', 'PUT'] as const) {
        test(`${surface} ${operation} unknown property with valid mutation candidate`, async () => {
            assertRejected(await capture(`${surface}-${operation}-unknown`, surface, operation,
                { mutateBody: (body) => ({ ...body, unknownSyntheticProperty: 'nonclinical' }) }), 400);
        });
        test(`${surface} ${operation} invalid date candidate`, async () => {
            assertRejected(await capture(`${surface}-${operation}-invalid-date`, surface, operation,
                { mutateBody: (body) => ({ ...body, date: 'not-a-date' }) }), 400);
        });
        test(`${surface} ${operation} numeric date candidate`, async () => {
            assertAccepted(await capture(`${surface}-${operation}-numeric-date`, surface, operation,
                { mutateBody: (body) => ({ ...body, date: 42 }) }), operation === 'POST' ? 201 : 200);
        });
        test(`${surface} ${operation} invalid type candidate`, async () => {
            assertRejected(await capture(`${surface}-${operation}-invalid-type`, surface, operation,
                { mutateBody: (body) => ({ ...body, type: 42 }) }), 400);
        });
        test(`${surface} ${operation} parent deleted candidate`, async () => {
            assertRejected(await capture(`${surface}-${operation}-parent-deleted`, surface, operation,
                { deletedPatient: true }), 404);
        });
    }
    test(`${surface} POST explicit nonstring ID candidate`, async () => {
        assertRejected(await capture(`${surface}-POST-nonstring-id`, surface, 'POST',
            { mutateBody: (body) => ({ ...body, id: 42 }) }), 400);
    });
    test(`${surface} POST replay same explicit ID candidate`, async () => {
        const ids = seed(`${surface}-replay`, false);
        const body = validBody(surface, 'POST', ids);
        const before = readBack(ids.patientId, ids.entryId);
        const first = await invoke(surface, 'POST', ids, body);
        const afterFirst = readBack(ids.patientId, ids.entryId);
        const second = await invoke(surface, 'POST', ids, body);
        const afterSecond = readBack(ids.patientId, ids.entryId);
        assert.equal(first.status, 201);
        assert.equal(second.status, surface === 'network' ? 200 : 409);
        assert.deepEqual(afterSecond, afterFirst);
        assert.equal(afterSecond.audit.length, 1);
        observations.push({ name: 'same-id-replay', surface, operation: 'POST',
            firstStatus: first.status, secondStatus: second.status, before, afterFirst, afterSecond });
    });
    test(`${surface} PUT stale version candidate`, async () => {
        const result = await capture(`${surface}-PUT-stale`, surface, 'PUT',
            { mutateBody: (body) => ({ ...body, version: 2 }) });
        assert.equal(result.response.status, 409);
        assert.deepEqual(result.after, result.before);
    });
    if (surface !== 'web') {
        test(`${surface} PUT cross-patient route candidate`, async () => {
            const other = seed(`${surface}-other-existing-patient`, false);
            const result = await capture(`${surface}-PUT-cross-patient`, surface, 'PUT',
                { routePatientId: other.patientId });
            assert.equal(result.response.status, 404);
            assert.deepEqual(result.after, result.before);
        });
    }
    if (surface !== 'network') {
        test(`${surface} DELETE stale version candidate`, async () => {
            const result = await capture(`${surface}-DELETE-stale`, surface, 'DELETE',
                { mutateBody: (body) => ({ ...body, version: 2 }) });
            assert.equal(result.response.status, 409);
            assert.deepEqual(result.after, result.before);
        });
    }
}

for (const surface of ['web', 'v1'] as const) {
        test(`${surface} DELETE unknown own property with valid payload`, async () => {
            assertRejected(await capture(`${surface}-DELETE-unknown`, surface, 'DELETE',
                { mutateBody: (body) => ({ ...body, unknownSyntheticProperty: 'nonclinical' }) }), 400);
        });
        test(`${surface} DELETE with deleted parent`, async () => {
            assertRejected(await capture(`${surface}-DELETE-parent-deleted`, surface, 'DELETE',
                { deletedPatient: true }), 404);
        });
}
for (const surface of ['web', 'v1', 'network'] as const) {
        test(`${surface} POST boolean date true`, async () => {
            assertRejected(await capture(`${surface}-POST-date-boolean`, surface, 'POST',
                { mutateBody: (body) => ({ ...body, date: true }) }), 400);
        });
}
test('Web POST extra bearer plus spoofed surface and actor headers retains session attribution', async () => {
        const result = await capture('web-POST-bearer-spoof', 'web', 'POST', { headers: {
            authorization: 'Bearer c05-diary-synthetic-token', 'x-mediflow-source-surface': 'job',
            'x-actor-ref': 'spoofed-actor',
        } });
        assertAccepted(result, 201);
        assert.equal((result.after.audit[0] as Record<string, unknown>).actor_ref, 'synthetic-admin');
        assert.equal((result.after.audit[0] as Record<string, unknown>).source_surface, 'web');
});
test('Web POST spoofed headers without bearer retains session attribution', async () => {
        const result = await capture('web-POST-header-spoof', 'web', 'POST', { headers: {
            'x-mediflow-source-surface': 'job', 'x-actor-ref': 'spoofed-actor',
        } });
        assertAccepted(result, 201);
        assert.equal((result.after.audit[0] as Record<string, unknown>).source_surface, 'web');
});

for (const surface of ['web', 'v1', 'network'] as const) {
    for (const operation of (surface === 'network' ? ['POST', 'PUT'] : ['POST', 'PUT', 'DELETE']) as Operation[]) {
        test(`${surface} ${operation} successful single atomic row and audit`, async () => {
            assertAccepted(await capture(`${surface}-${operation}-positive`, surface, operation),
                operation === 'POST' ? 201 : 200);
        });
        test(`${surface} ${operation} accepts archived active parent`, async () => {
            const ids = seed(`${surface}-${operation}-archived`, operation !== 'POST', false, true);
            const before = readBack(ids.patientId, ids.entryId);
            const response = await invoke(surface, operation, ids, validBody(surface, operation, ids));
            const after = readBack(ids.patientId, ids.entryId);
            assert.equal(response.status, operation === 'POST' ? 201 : 200);
            assert.equal(after.audit.length, 1);
            assert.equal((after.patient as Record<string, unknown>).is_archived, 1);
            assert.deepEqual(after.patient, before.patient);
            assert.deepEqual(after.memberships, before.memberships);
        });
        if (operation !== 'POST') {
            test(`${surface} ${operation} matched UPDATE IGNORE rolls back without audit`, async () => {
                const ids = seed(`${surface}-${operation}-update-ignore`, true);
                const before = readBack(ids.patientId, ids.entryId);
                sql.exec('CREATE TRIGGER c05_diary_update_ignore BEFORE UPDATE ON entries BEGIN SELECT RAISE(IGNORE); END');
                try {
                    const response = await invoke(surface, operation, ids, validBody(surface, operation, ids));
                    assert.equal(response.status, 500);
                    assert.deepEqual(readBack(ids.patientId, ids.entryId), before);
                } finally { sql.exec('DROP TRIGGER c05_diary_update_ignore'); }
            });
        }
    }
    test(`${surface} PUT restores an entry tombstone with version CAS`, async () => {
        const ids = seed(`${surface}-entry-restore`, true);
        sql.prepare('UPDATE entries SET deleted_at=?, deletion_reason=? WHERE id=?').run(
            1_767_225_600, 'ENC:synthetic:old-reason', ids.entryId);
        const before = readBack(ids.patientId, ids.entryId);
        const response = await invoke(surface, 'PUT', ids,
            { version: 3, deletedAt: null, deletionReason: null });
        const after = readBack(ids.patientId, ids.entryId);
        assert.equal(response.status, 200);
        assert.equal((after.entry as Record<string, unknown>).deleted_at, null);
        assert.equal((after.entry as Record<string, unknown>).version, 4);
        assert.equal((after.entry as Record<string, unknown>).content, (before.entry as Record<string, unknown>).content);
        assert.equal((after.audit[0] as Record<string, unknown>).event_type, 'entry.updated');
        assert.equal(after.audit.length, 1);
    });
}

test('Web legacy create accepts createdAt and normalized updatedAt without client ownership of createdAt', async () => {
    const ids = seed('web-legacy-times', false);
    const body = { ...validBody('web', 'POST', ids), createdAt: '2000-01-01T00:00:00.000Z',
        updatedAt: '2026-05-03T10:00:00.000Z', metadata: { source: 'synthetic' },
        attachments: [{ id: 'synthetic-ref' }] };
    const response = await invoke('web', 'POST', ids, body);
    const after = readBack(ids.patientId, ids.entryId);
    assert.equal(response.status, 201);
    assert.notEqual((after.entry as Record<string, unknown>).created_at, 946684800);
    assert.equal((after.entry as Record<string, unknown>).updated_at, Date.parse('2026-05-03T10:00:00.000Z') / 1000);
    assert.equal((after.entry as Record<string, unknown>).metadata, '{"source":"synthetic"}');
    assert.equal((after.entry as Record<string, unknown>).attachments, '[{"id":"synthetic-ref"}]');
    assert.equal(after.audit.length, 1);
});

/* @Codex: route-level byte fixture verifies admission before any SQLite read/write. */
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
    const req = new Request('http://127.0.0.1/api/entries', { method: operation, body: stream,
        headers: { 'content-type': 'application/json',
            ...(surface === 'v1' ? { authorization: 'Bearer c05-diary-synthetic-token' } : {}),
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

for (const surface of ['web', 'v1'] as const) {
    for (const operation of ['POST', 'PUT', 'DELETE'] as const) {
        test(`${surface} ${operation} local JSON 4 MiB + 1 byte is 413 with no effects`, async () => {
            const ids = seed(`${surface}-${operation}-budget-over`, operation !== 'POST');
            const before = readBack(ids.patientId, ids.entryId);
            const bytes = paddedBytes(validBody(surface, operation, ids), 4_194_305);
            const fixture = streamedRequest(surface, operation,
                [bytes.subarray(0, 4_194_304), bytes.subarray(4_194_304)]);
            const response = await invoke(surface, operation, ids, {}, undefined, {}, fixture.req);
            assert.equal(response.status, 413);
            assert.deepEqual(fixture.counts(), { pulls: 2, cancels: 1 });
            assert.deepEqual(readBack(ids.patientId, ids.entryId), before);
        });
        test(`${surface} ${operation} denies before body access`, async () => {
            const ids = seed(`${surface}-${operation}-auth-before-body`, operation !== 'POST');
            const before = readBack(ids.patientId, ids.entryId);
            let bodyAccessed = false;
            const previous = state.session;
            if (surface === 'web') state.session = null;
            const poison = {
                get headers() {
                    if (surface === 'web') { bodyAccessed = true; throw new Error('Web denied headers accessed'); }
                    return new Headers();
                },
                get body() { bodyAccessed = true; throw new Error('Denied body accessed'); },
                json() { bodyAccessed = true; throw new Error('Denied JSON parsed'); },
                text() { bodyAccessed = true; throw new Error('Denied text parsed'); },
            } as unknown as Request;
            try {
                const response = await invoke(surface, operation, ids, {}, undefined, {}, poison);
                assert.equal(response.status, 401);
                assert.equal(bodyAccessed, false);
                assert.deepEqual(readBack(ids.patientId, ids.entryId), before);
            } finally { state.session = previous; }
        });
    }
}

test('Web POST admits exactly 4 MiB including a split UTF-8 code point', async () => {
    const ids = seed('web-exact-utf8-budget', false);
    const body = { ...validBody('web', 'POST', ids), type: 'note🩺' };
    const bytes = paddedBytes(body, 4_194_304);
    const emoji = bytes.indexOf(0xf0);
    assert.ok(emoji > 0);
    const fixture = streamedRequest('web', 'POST', [bytes.subarray(0, emoji + 1), bytes.subarray(emoji + 1)]);
    const response = await invoke('web', 'POST', ids, {}, undefined, {}, fixture.req);
    assert.equal(response.status, 201);
    assert.equal(fixture.counts().cancels, 0);
    assert.equal(readBack(ids.patientId, ids.entryId).audit.length, 1);
});

test('declared oversize rejects without pulling, misleading length cannot bypass actual bytes', async () => {
    const ids = seed('web-declared-budget', false);
    const before = readBack(ids.patientId, ids.entryId);
    const valid = paddedBytes(validBody('web', 'POST', ids), 4_194_304);
    const declared = streamedRequest('web', 'POST', [valid], { 'content-length': '4194305' });
    assert.equal((await invoke('web', 'POST', ids, {}, undefined, {}, declared.req)).status, 413);
    assert.deepEqual(declared.counts(), { pulls: 0, cancels: 1 });
    const actual = paddedBytes(validBody('web', 'POST', ids), 4_194_305);
    const misleading = streamedRequest('web', 'POST',
        [actual.subarray(0, 4_194_304), actual.subarray(4_194_304)], { 'content-length': '0' });
    assert.equal((await invoke('web', 'POST', ids, {}, undefined, {}, misleading.req)).status, 413);
    assert.deepEqual(misleading.counts(), { pulls: 2, cancels: 1 });
    assert.deepEqual(readBack(ids.patientId, ids.entryId), before);
});

for (const surface of ['web', 'v1', 'network'] as const) {
    test(`${surface} POST rejects explicitly blank ID without generating another`, async () => {
        assertRejected(await capture(`${surface}-blank-id`, surface, 'POST',
            { mutateBody: (body) => ({ ...body, id: '  ' }) }), 400);
    });
    for (const version of [0, Number.MAX_SAFE_INTEGER]) {
        test(`${surface} PUT rejects unsafe version ${version}`, async () => {
            assertRejected(await capture(`${surface}-unsafe-version-${version}`, surface, 'PUT',
                { mutateBody: (body) => ({ ...body, version }) }), 400);
        });
    }
    test(`${surface} PUT retains legacy empty-string tombstone clear`, async () => {
        const ids = seed(`${surface}-legacy-empty-clear`, true);
        sql.prepare('UPDATE entries SET deleted_at=?, deletion_reason=? WHERE id=?').run(
            1_767_225_600, 'ENC:synthetic:old-reason', ids.entryId);
        const response = await invoke(surface, 'PUT', ids,
            { version: 3, deletedAt: '', deletionReason: null });
        const after = readBack(ids.patientId, ids.entryId);
        assert.equal(response.status, 200);
        assert.equal((after.entry as Record<string, unknown>).deleted_at, null);
        assert.equal(after.audit.length, 1);
        assert.equal((after.audit[0] as Record<string, unknown>).event_type, 'entry.updated');
    });
}

for (const surface of ['web', 'v1'] as const) {
    test(`${surface} DELETE invalid tombstone preserves legacy error and state`, async () => {
        const result = await capture(`${surface}-DELETE-invalid-tombstone-compat`, surface, 'DELETE',
            { mutateBody: (body) => ({ ...body, deletedAt: 'not-a-date' }) });
        assertRejected(result, 400);
        assert.deepEqual(await result.response.json(), { error: 'Invalid deletedAt' });
    });
    for (const deletedAt of [null, '']) {
        test(`${surface} DELETE rejects explicit empty tombstone ${String(deletedAt)}`, async () => {
            assertRejected(await capture(`${surface}-DELETE-empty-tombstone-${String(deletedAt)}`, surface, 'DELETE',
                { mutateBody: (body) => ({ ...body, deletedAt }) }), 400);
        });
    }
}

test('network exact replay is denied after parent tombstone, without another audit', async () => {
    const ids = seed('network-replay-parent-deleted', false);
    const body = validBody('network', 'POST', ids);
    const first = await invoke('network', 'POST', ids, body);
    assert.equal(first.status, 201);
    sql.prepare('UPDATE patients SET deleted_at=? WHERE id=?').run(1_767_225_600, ids.patientId);
    const beforeRetry = readBack(ids.patientId, ids.entryId);
    const retry = await invoke('network', 'POST', ids, body);
    assert.equal(retry.status, 404);
    assert.deepEqual(readBack(ids.patientId, ids.entryId), beforeRetry);
});

test('network scope is enforced inside the operation', async () => {
    const ids = seed('network-wrong-scope', true);
    sql.prepare('DELETE FROM patients_to_ambulatories WHERE patient_id=?').run(ids.patientId);
    const before = readBack(ids.patientId, ids.entryId);
    const response = await invoke('network', 'PUT', ids, validBody('network', 'PUT', ids));
    assert.equal(response.status, 404);
    assert.deepEqual(readBack(ids.patientId, ids.entryId), before);
});

test('network host boundary preserves AI, timestamp and sealed-field restrictions', async () => {
    for (const [name, addition, status] of [
        ['ai', { aiSummary: 'synthetic' }, 403],
        ['timestamp', { createdAt: '2026-05-02T09:00:00Z' }, 400],
        ['plaintext', { title: 'plaintext' }, 400],
    ] as const) {
        assertRejected(await capture(`network-boundary-${name}`, 'network', 'POST',
            { mutateBody: (body) => ({ ...body, ...addition }) }), status);
    }
});

test('local structured metadata and paired sealed metadata retain normalized representation', async () => {
    const local = await capture('web-structured-metadata', 'web', 'POST', {
        mutateBody: (body) => ({ ...body, metadata: { synthetic: true }, attachments: [{ id: 'synthetic-ref' }] }),
    });
    assertAccepted(local, 201);
    assert.equal((local.after.entry as Record<string, unknown>).metadata, '{"synthetic":true}');
    assert.equal((local.after.entry as Record<string, unknown>).attachments, '[{"id":"synthetic-ref"}]');
    const paired = await capture('network-sealed-metadata', 'network', 'POST', {
        mutateBody: (body) => ({ ...body, metadata: 'ENC:bWV0YWRhdGFpdg==:bWV0YWRhdGFjaXBoZXI=' }),
    });
    assertAccepted(paired, 201);
    assert.equal((paired.after.entry as Record<string, unknown>).metadata, 'ENC:bWV0YWRhdGFpdg==:bWV0YWRhdGFjaXBoZXI=');
    const metadata = JSON.parse((paired.after.audit[0] as Record<string, unknown>).redacted_metadata as string);
    assert.deepEqual(metadata.flags, ['auth:paired-client', 'paired-client:synthetic-paired', 'scope:ambulatory']);
    assert.equal(JSON.stringify(metadata).includes('bWV0YWRhdGF'), false);
});
