/* @Codex: ordinary route handlers with synthetic admission seams and real SQLite readback. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-checkup-date-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const token = 'synthetic-checkup-date-token';
process.env.MEDIFLOW_LOCAL_API_TOKEN = token;
function seam(name: string, source: string) {
    const path = join(dataDir, name);
    writeFileSync(path, source, { mode: 0o600 });
    return pathToFileURL(path).href;
}
const auth = seam('auth.cjs', `
exports.requireSession=async()=>({id:'synthetic-web',userId:'synthetic-admin',role:'admin',authChannel:'web'});
exports.requireLocalApiActorSession=async()=>({id:'synthetic-local',userId:'synthetic-local',role:'admin',authChannel:'system'});
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});
exports.forbiddenResponse=()=>Response.json({error:'Forbidden'},{status:403});`);
const local = seam('local.cjs', `
exports.requireLocalApiToken=(request)=>request.headers.get('authorization')==='Bearer ${token}'?null:Response.json({error:'Unauthorized'},{status:401});
exports.hasValidLocalApiToken=(request)=>request.headers.get('authorization')==='Bearer ${token}';`);
const network = seam('network.cjs', `
exports.requireNetworkWriteContext=async(request)=>({ok:true,context:{request,scopeAmbulatoryId:'synthetic-date-ambulatory',pairedClient:{clientId:'synthetic-paired'},session:{id:'synthetic-native',userId:'synthetic-admin',role:'admin',authChannel:'native'}}});`);
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
        next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const replacements: Record<string, string> = {
    '@/lib/security/server-auth': auth,
    '@/lib/security/local-api-auth': local,
    '@/lib/network-write-context': network,
};
const hooks = registerHooks({ resolve(specifier, context, next) {
    const url = replacements[specifier];
    return url ? { url, shortCircuit: true } : next(specifier, context);
} });
const { dbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const { ambulatories, patients, patientsToAmbulatories, checkups } = load('./schema.ts') as typeof import('./schema.ts');
const webCreate = load('../app/api/checkups/route.ts') as typeof import('../app/api/checkups/route.ts');
const webItem = load('../app/api/checkups/[id]/route.ts') as typeof import('../app/api/checkups/[id]/route.ts');
const v1Create = load('../app/api/v1/patients/[id]/checkups/route.ts') as typeof import('../app/api/v1/patients/[id]/checkups/route.ts');
const v1Item = load('../app/api/v1/patients/[id]/checkups/[checkupId]/route.ts') as typeof import('../app/api/v1/patients/[id]/checkups/[checkupId]/route.ts');
const networkCreate = load('../app/api/v1/network/patients/[id]/checkups/route.ts') as typeof import('../app/api/v1/network/patients/[id]/checkups/route.ts');
const networkItem = load('../app/api/v1/network/patients/[id]/checkups/[checkupId]/route.ts') as typeof import('../app/api/v1/network/patients/[id]/checkups/[checkupId]/route.ts');
test.after(() => {
    dbServer.$client.close();
    hooks.deregister();
    rmSync(dataDir, { recursive: true, force: true });
});

let serial = 0;
type Surface = 'web' | 'v1' | 'network';
type Operation = 'POST' | 'PUT';
const initialDate = '2026-01-01T00:00:00.000Z';
const nextDate = '2026-10-09T09:30:00.000Z';
function seed(operation: Operation) {
    const patientId = `synthetic-date-patient-${++serial}`;
    const checkupId = `synthetic-date-checkup-${serial}`;
    dbServer.insert(ambulatories).values({ id: 'synthetic-date-ambulatory', name: 'Synthetic', type: 'live' }).onConflictDoNothing().run();
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: `SYNDATE${serial}` }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: 'synthetic-date-ambulatory' }).run();
    if (operation === 'PUT') dbServer.insert(checkups).values({ id: checkupId, patientId,
        date: new Date(initialDate), title: 'Synthetic', notes: 'ENC:synthetic:notes', status: 'pending', source: 'manual', version: 3 }).run();
    return { patientId, checkupId };
}
function readBack() {
    const fresh = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try {
        return {
            checkups: fresh.prepare('SELECT * FROM checkups ORDER BY id').all(),
            patients: fresh.prepare('SELECT * FROM patients ORDER BY id').all(),
            membership: fresh.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id, ambulatory_id').all(),
            audit: fresh.prepare('SELECT * FROM audit_events ORDER BY rowid').all(),
        };
    } finally { fresh.close(); }
}
async function invoke(surface: Surface, operation: Operation, ids: ReturnType<typeof seed>, changes: Record<string, unknown>) {
    const body = operation === 'POST'
        ? { id: ids.checkupId, ...(surface === 'web' ? { patientId: ids.patientId } : {}),
            title: 'Synthetic', date: nextDate, notes: 'ENC:synthetic:notes', ...changes }
        : { version: 3, ...changes };
    const request = new Request('http://127.0.0.1/api/checkups', { method: operation,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    if (surface === 'web') return operation === 'POST' ? webCreate.POST(request)
        : webItem.PUT(request, { params: Promise.resolve({ id: ids.checkupId }) });
    if (surface === 'v1') return operation === 'POST' ? v1Create.POST(request, { params: Promise.resolve({ id: ids.patientId }) })
        : v1Item.PUT(request, { params: Promise.resolve({ id: ids.patientId, checkupId: ids.checkupId }) });
    return operation === 'POST' ? networkCreate.POST(request, { params: Promise.resolve({ id: ids.patientId }) })
        : networkItem.PUT(request, { params: Promise.resolve({ id: ids.patientId, checkupId: ids.checkupId }) });
}

for (const surface of ['web', 'v1', 'network'] as const) {
    for (const operation of ['POST', 'PUT'] as const) {
        const fields = operation === 'POST' ? ['date']
            : surface === 'network' ? ['date', 'deletedAt'] : ['date', 'updatedAt', 'deletedAt'];
        for (const field of fields) {
            test(`${surface} ${operation}: malformed ${field} leaves domain and audit unchanged`, async () => {
                for (const value of [true, [nextDate], { toString: 7 }]) {
                    const ids = seed(operation);
                    const before = readBack();
                    const response = await invoke(surface, operation, ids, { [field]: value });
                    assert.equal(response.status, 400, JSON.stringify(value));
                    const body = await response.json();
                    if (surface !== 'web' || operation !== 'POST') {
                        assert.deepEqual(body, { error: `Invalid ${field}` });
                    }
                    assert.deepEqual(readBack(), before);
                }
            });
        }
        test(`${surface} ${operation}: valid string and numeric dates still persist with one audit event`, async () => {
            for (const date of [nextDate, Date.parse(nextDate)]) {
                const ids = seed(operation);
                const before = readBack();
                const response = await invoke(surface, operation, ids, { date });
                assert.equal(response.status, operation === 'POST' ? 201 : 200);
                await response.json();
                const after = readBack();
                const row = after.checkups.find(value => (value as { id: string }).id === ids.checkupId) as Record<string, unknown>;
                assert.ok(row);
                assert.equal(row.date, Date.parse(nextDate) / 1000);
                assert.equal(row.version, operation === 'POST' ? 1 : 4);
                assert.equal(after.audit.length - before.audit.length, 1);
                assert.deepEqual(after.patients, before.patients);
                assert.deepEqual(after.membership, before.membership);
            }
        });
    }
}
