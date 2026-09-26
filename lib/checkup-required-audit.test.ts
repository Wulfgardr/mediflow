/* @Codex: candidate real-SQLite oracle for the eight ordinary checkup mutations. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-c05-checkup-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
process.env.MEDIFLOW_LOCAL_API_TOKEN = 'c05-checkup-synthetic-token';
const state = { session: { id: 'synthetic-web', userId: 'synthetic-admin', role: 'admin', authChannel: 'web' } as Record<string, unknown> | null,
    scopeAmbulatoryId: 'c05-checkup-a' };
const stateKey = Symbol.for(`c05-checkup-seam-${dataDir}`);
(globalThis as unknown as Record<symbol, typeof state>)[stateKey] = state;
function seam(name: string, source: string) {
    const path = join(dataDir, name);
    writeFileSync(path, source, { mode: 0o600 });
    return pathToFileURL(path).href;
}
const auth = seam('auth.cjs', `const state=globalThis[Symbol.for(${JSON.stringify(`c05-checkup-seam-${dataDir}`)})];
exports.requireSession=async()=>state.session;
exports.requireLocalApiActorSession=async()=>({id:'synthetic-local',userId:'synthetic-local',role:'admin',authChannel:'system'});
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});
exports.forbiddenResponse=()=>Response.json({error:'Forbidden'},{status:403});`);
const token = seam('token.cjs', `exports.requireLocalApiToken=(request)=>request.headers.get('authorization')==='Bearer c05-checkup-synthetic-token'?null:Response.json({error:'Unauthorized'},{status:401});
exports.hasValidLocalApiToken=(request)=>request.headers.get('authorization')==='Bearer c05-checkup-synthetic-token';`);
const network = seam('network.cjs', `const state=globalThis[Symbol.for(${JSON.stringify(`c05-checkup-seam-${dataDir}`)})];
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
const { ambulatories, patients, patientsToAmbulatories, checkups } = load('./schema.ts') as typeof import('./schema.ts');
const webCreate = load('../app/api/checkups/route.ts') as typeof import('../app/api/checkups/route.ts');
const webItem = load('../app/api/checkups/[id]/route.ts') as typeof import('../app/api/checkups/[id]/route.ts');
const v1Create = load('../app/api/v1/patients/[id]/checkups/route.ts') as typeof import('../app/api/v1/patients/[id]/checkups/route.ts');
const v1Item = load('../app/api/v1/patients/[id]/checkups/[checkupId]/route.ts') as typeof import('../app/api/v1/patients/[id]/checkups/[checkupId]/route.ts');
const networkCreate = load('../app/api/v1/network/patients/[id]/checkups/route.ts') as typeof import('../app/api/v1/network/patients/[id]/checkups/route.ts');
const networkItem = load('../app/api/v1/network/patients/[id]/checkups/[checkupId]/route.ts') as typeof import('../app/api/v1/network/patients/[id]/checkups/[checkupId]/route.ts');
const sql = new Database(join(dataDir, 'medical.db'));
const records: Record<string, unknown>[] = [];
let serial = 0;
const nextId = (name: string) => `c05-checkup-${++serial}-${name}`;

test.after(() => {
    const report = process.env.MEDIFLOW_CHECKUP_CANDIDATE_REPORT;
    if (report) writeFileSync(report, `${JSON.stringify({ records }, null, 2)}\n`);
    sql.close(); dbServer.$client.close(); hooks.deregister();
    delete (globalThis as unknown as Record<symbol, typeof state>)[stateKey];
    rmSync(dataDir, { recursive: true, force: true });
});

function seed(name: string, withCheckup: boolean, deleted = false, archived = false) {
    const patientId = nextId(`${name}-patient`);
    const checkupId = nextId(`${name}-checkup`);
    dbServer.insert(ambulatories).values({ id: 'c05-checkup-a', name: 'Synthetic checkup ambulatory', type: 'live' }).onConflictDoNothing().run();
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient',
        taxCode: `SYN${serial}`, deletedAt: deleted ? new Date('2026-01-01T00:00:00Z') : null,
        notes: 'ENC:synthetic:patient', isArchived: archived }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: 'c05-checkup-a' }).run();
    if (withCheckup) dbServer.insert(checkups).values({ id: checkupId, patientId,
        date: new Date('2026-01-01T00:00:00Z'), title: 'Synthetic checkup',
        notes: 'ENC:synthetic:notes', status: 'pending', source: 'manual', version: 3 }).run();
    return { patientId, checkupId };
}

function readBack(patientId: string, checkupId: string) {
    const fresh = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try {
        return {
            checkup: fresh.prepare('SELECT * FROM checkups WHERE id=?').get(checkupId) ?? null,
            allPatientCheckups: fresh.prepare('SELECT * FROM checkups WHERE patient_id=? ORDER BY id').all(patientId),
            patient: fresh.prepare('SELECT * FROM patients WHERE id=?').get(patientId) ?? null,
            membership: fresh.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id').all(patientId),
            audit: fresh.prepare("SELECT * FROM audit_events WHERE subject_type='checkup' AND (subject_ref=? OR subject_ref IN (SELECT id FROM checkups WHERE patient_id=?)) ORDER BY rowid").all(checkupId, patientId),
            auditAll: fresh.prepare("SELECT * FROM audit_events WHERE subject_type='checkup' ORDER BY rowid").all(),
        };
    } finally { fresh.close(); }
}

type Surface = 'web' | 'v1' | 'network';
type Operation = 'POST' | 'PUT' | 'DELETE';
function request(method: Operation, body: unknown, surface: Surface, raw?: string, headers: Record<string,string> = {}) {
    return new Request('http://127.0.0.1/api/checkups', { method,
        headers: { 'content-type': 'application/json', ...(surface === 'web' ? {} : { authorization: 'Bearer c05-checkup-synthetic-token' }), ...headers },
        body: raw ?? JSON.stringify(body),
    });
}
async function invoke(surface: Surface, operation: Operation, ids: { patientId: string; checkupId: string }, body: unknown,
    raw?: string, headers: Record<string,string> = {}) {
    const req = request(operation, body, surface, raw, headers);
    if (surface === 'web') return operation === 'POST' ? webCreate.POST(req)
        : operation === 'PUT' ? webItem.PUT(req, { params: Promise.resolve({ id: ids.checkupId }) })
            : webItem.DELETE(req, { params: Promise.resolve({ id: ids.checkupId }) });
    if (surface === 'v1') return operation === 'POST' ? v1Create.POST(req, { params: Promise.resolve({ id: ids.patientId }) })
        : operation === 'PUT' ? v1Item.PUT(req, { params: Promise.resolve({ id: ids.patientId, checkupId: ids.checkupId }) })
            : v1Item.DELETE(req, { params: Promise.resolve({ id: ids.patientId, checkupId: ids.checkupId }) });
    return operation === 'POST' ? networkCreate.POST(req, { params: Promise.resolve({ id: ids.patientId }) })
        : networkItem.PUT(req, { params: Promise.resolve({ id: ids.patientId, checkupId: ids.checkupId }) });
}
function validBody(surface: Surface, operation: Operation, ids: { patientId: string; checkupId: string }) {
    if (operation === 'POST') return { id: ids.checkupId, ...(surface === 'web' ? { patientId: ids.patientId } : {}),
        date: '2026-05-02T09:00:00.000Z', title: 'Synthetic checkup', notes: 'ENC:synthetic:notes', status: 'pending', source: 'manual' };
    if (operation === 'DELETE') return { version: 3, deletionReason: 'ENC:synthetic:reason' };
    return { version: 3, title: 'Updated synthetic checkup', notes: 'ENC:synthetic:newnotes' };
}
async function capture(name: string, surface: Surface, operation: Operation, options: {
    body?: unknown; raw?: string; deletedPatient?: boolean; archivedPatient?: boolean;
    routePatientId?: string; routeCheckupId?: string; change?: (body: Record<string,unknown>) => unknown;
    headers?: Record<string,string>; wrongScope?: boolean; seedCheckup?: boolean; deletedCheckup?: boolean;
    missingParent?: boolean; prototypeOwn?: boolean;
} = {}) {
    const ids = seed(name, options.seedCheckup ?? operation !== 'POST', options.deletedPatient, options.archivedPatient);
    if (options.missingParent) {
        sql.pragma('foreign_keys = OFF');
        try { sql.prepare('DELETE FROM patients WHERE id=?').run(ids.patientId); }
        finally { sql.pragma('foreign_keys = ON'); }
    }
    if (options.deletedCheckup) sql.prepare('UPDATE checkups SET deleted_at=?, deletion_reason=? WHERE id=?')
        .run(1_767_225_600, 'ENC:synthetic:old-reason', ids.checkupId);
    const before = readBack(ids.patientId, ids.checkupId);
    const routeIds = { ...ids, patientId: options.routePatientId ?? ids.patientId,
        checkupId: options.routeCheckupId ?? ids.checkupId };
    const original = validBody(surface, operation, ids);
    const body = options.body !== undefined ? options.body : options.change?.(original) ?? original;
    const priorScope = state.scopeAmbulatoryId;
    if (options.wrongScope) state.scopeAmbulatoryId = 'c05-checkup-other';
    let response: Response;
    const raw = options.prototypeOwn ? JSON.stringify(body).replace(/}$/, ',"__proto__":"synthetic"}') : options.raw;
    try { response = await invoke(surface, operation, routeIds, body, raw, options.headers); }
    finally { state.scopeAmbulatoryId = priorScope; }
    const text = await response.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = { unparsed: text }; }
    const after = readBack(ids.patientId, ids.checkupId);
    const result = { name, surface, operation, status: response.status, json,
        changed: JSON.stringify(after) !== JSON.stringify(before),
        checkupChanged: JSON.stringify(after.allPatientCheckups) !== JSON.stringify(before.allPatientCheckups),
        auditDelta: after.auditAll.length - before.auditAll.length, before, after };
    records.push(result);
    return { ...result, ids };
}

test('all eight operations rollback on audit FAIL and IGNORE',async()=>{
    for (const surface of ['web','v1','network'] as const)
      for (const operation of (surface==='network'?['POST','PUT']:['POST','PUT','DELETE']) as Operation[])
        for (const fault of ['FAIL','IGNORE'] as const) {
          sql.exec(`CREATE TRIGGER c05_checkup_audit_fault BEFORE INSERT ON audit_events BEGIN SELECT RAISE(${fault}${fault==='FAIL'?", 'synthetic audit fault'":''}); END`);
          try {
            const r=await capture(`${surface}-${operation}-audit-${fault}`,surface,operation);
            assert.equal(r.status,500,r.name);
            assert.deepEqual(r.after,r.before,r.name);
          } finally {sql.exec('DROP TRIGGER c05_checkup_audit_fault');}
        }
});

test('all eight ordinary operations commit one row and exactly one required audit',async()=>{
    for (const surface of ['web','v1','network'] as const)
      for (const operation of (surface==='network'?['POST','PUT']:['POST','PUT','DELETE']) as Operation[]) {
        const r=await capture(`${surface}-${operation}-normal`,surface,operation);
        assert.equal(r.status,operation==='POST'?201:200,r.name);
        assert.equal(r.checkupChanged,true,r.name);
        assert.equal(r.auditDelta,1,r.name);
        const event=r.after.audit.at(-1) as Record<string,unknown>;
        assert.equal(event.subject_ref,r.ids.checkupId);
        assert.equal(event.event_type,operation==='POST'?'checkup.created':operation==='DELETE'?'checkup.deleted':'checkup.updated');
        assert.ok(!JSON.stringify(event).includes('ENC:synthetic:'),r.name);
        assert.deepEqual(r.after.membership,r.before.membership,r.name);
      }
});

test('domain INSERT or UPDATE IGNORE rolls back instead of reporting success or conflict',async()=>{
    for (const surface of ['web','v1','network'] as const)
      for (const operation of (surface==='network'?['POST','PUT']:['POST','PUT','DELETE']) as Operation[]) {
        const timing=operation==='POST'?'INSERT':'UPDATE';
        sql.exec(`CREATE TRIGGER c05_checkup_domain_ignore BEFORE ${timing} ON checkups BEGIN SELECT RAISE(IGNORE); END`);
        try {
          const r=await capture(`${surface}-${operation}-domain-IGNORE`,surface,operation);
          assert.equal(r.status,500,r.name);
          assert.deepEqual(r.after,r.before,r.name);
        } finally {sql.exec('DROP TRIGGER c05_checkup_domain_ignore');}
      }
});

test('parent missing or tombstoned is 404 without effects; archived remains admissible',async()=>{
    for (const surface of ['web','v1','network'] as const)
      for (const operation of (surface==='network'?['POST','PUT']:['POST','PUT','DELETE']) as Operation[]) {
        for (const kind of ['missing','deleted'] as const) {
          const r=await capture(`${surface}-${operation}-parent-${kind}`,surface,operation,
            {missingParent:kind==='missing',deletedPatient:kind==='deleted'});
          assert.equal(r.status,404,r.name);
          assert.deepEqual(r.after,r.before,r.name);
        }
        const archived=await capture(`${surface}-${operation}-parent-archived`,surface,operation,{archivedPatient:true});
        assert.equal(archived.status,operation==='POST'?201:200,archived.name);
        assert.equal(archived.auditDelta,1,archived.name);
      }
});

test('scoped identity, stale version, input precedence and legacy mapping remain distinct',async()=>{
    for (const surface of ['web','v1','network'] as const) {
      const stale=await capture(`${surface}-PUT-stale`,surface,'PUT',{change:(b)=>({...b,version:2})});
      assert.equal(stale.status,409,stale.name); assert.deepEqual(stale.after,stale.before,stale.name);
      const missing=await capture(`${surface}-PUT-missing-invalid`,surface,'PUT',
        {routeCheckupId:'synthetic-absent',change:(b)=>({...b,title:42})});
      assert.equal(missing.status,surface==='network'?400:404,missing.name);assert.deepEqual(missing.after,missing.before);
      if (surface==='network') for (const operation of ['POST','PUT'] as const) {
        const denied=await capture(`network-${operation}-wrong-scope`,'network',operation,{wrongScope:true});
        assert.equal(denied.status,404);assert.deepEqual(denied.after,denied.before);
      }
      if (surface==='web') {
        const zero=await capture('web-POST-date-zero','web','POST',{change:(b)=>({...b,date:0,source:'external'})});
        assert.equal(zero.status,201);assert.equal((zero.after.checkup as Record<string,unknown>).date,0);
        assert.equal((zero.after.checkup as Record<string,unknown>).source,'external');
      } else {
        const zero=await capture(`${surface}-POST-date-zero`,surface,'POST',{change:(b)=>({...b,date:0})});
        assert.equal(zero.status,400);assert.deepEqual(zero.after,zero.before);
      }
    }
});

test('explicit restore is an updated event, without changing parent, membership or sealed notes',async()=>{
    for (const surface of ['web','v1','network'] as const) {
      const r=await capture(`${surface}-PUT-restore`,surface,'PUT',
        {deletedCheckup:true,change:(b)=>({...b,deletedAt:null,deletionReason:null})});
      assert.equal(r.status,200,r.name);assert.equal(r.auditDelta,1,r.name);
      const event=r.after.audit.at(-1) as Record<string,unknown>;
      assert.equal(event.event_type,'checkup.updated');
      assert.deepEqual(r.after.patient,r.before.patient);
      assert.deepEqual(r.after.membership,r.before.membership);
      assert.equal((r.after.checkup as Record<string,unknown>).notes,'ENC:synthetic:newnotes');
    }
});

test('Web audit actor and surface follow admitted session despite bearer and forged headers',async()=>{
    const r=await capture('web-POST-spoof-bearer','web','POST',
        {headers:{authorization:'Bearer c05-checkup-synthetic-token',
            'x-mediflow-source-surface':'job','x-actor-ref':'synthetic-spoof'}});
    assert.equal(r.status,201);
    const event=r.after.audit.at(-1) as Record<string,unknown>;
    assert.equal(event.actor_type,'user');
    assert.equal(event.actor_ref,'synthetic-admin');
    assert.equal(event.source_surface,'web');
    const metadata=JSON.parse(event.redacted_metadata as string) as {flags:string[]};
    assert.deepEqual(metadata.flags,['auth:session']);
});
