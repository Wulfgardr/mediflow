/* @Codex — synthetic dependency adapter for the bounded snapshot.
 * REAL: native-inference wrapper, selection owner, host row reader, grant broker,
 * strict transport, PI/SI/TR canonical parsers, attachment source authority.
 * SIMULATED: unavailable session issuer/environment/DB/Next request context.
 * NOT covered: real issuer qualification, TLS, AnyDoc worker, provider execution.
 * Omitted parser helpers THROW if invoked; no replacement parser is hidden here.
 */
'use strict';
const assert = require('node:assert/strict'), { randomBytes, createHash } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { loader } = require('./native-client-decrypt-loader.cjs');
function fixture(options = {}) {
  const sessions = new WeakMap(), liveSessions = new Set(), rawPorts = new WeakMap(), rawUses = new WeakMap(), bindings = new WeakMap();
  const counters = { admission: 0, provider: 0, clinicalWrites: 0, forbiddenParserCalls: 0 };
  const opaque = () => Object.freeze(Object.create(null));
  const rawCurrent = record => !!record?.active && !!sessions.get(record.session)?.active && record.session.expiresAt > Date.now();
  function revoke(session) {
    const rec = sessions.get(session); if (!rec?.active) return;
    rec.active = false;
    for (const [registration, item] of [...rec.resources]) { rec.resources.delete(registration); item.dispose(); }
  }
  const serverSessions = {
    mintNativeSessionResourcePort(session) { if (!sessions.get(session)?.active || session.expiresAt <= Date.now()) return null; const p = opaque(); rawPorts.set(p, { active: true, session }); return p; },
    beginNativeSessionResourceUse(port) { const p = rawPorts.get(port); if (!rawCurrent(p)) return null; const use = opaque(); rawUses.set(use, { active: true, port: p }); return use; },
    withCurrentNativeSessionResourceBinding(use, work) { const u = rawUses.get(use); if (!u?.active || !rawCurrent(u.port)) return false; const binding = opaque(); bindings.set(binding, u.port.session); work(binding); return u.active && rawCurrent(u.port); },
    commitNativeSessionResourceUse(use) { const u = rawUses.get(use); if (!u?.active || !rawCurrent(u.port)) return false; u.active = false; return true; },
    abortNativeSessionResourceUse(use) { const u = rawUses.get(use); if (!u?.active) return false; u.active = false; return true; },
    releaseNativeSessionResourcePort(port) { const p = rawPorts.get(port); if (!p?.active) return false; p.active = false; return true; },
    registerNativeSessionPrivateResource(port, dispose) { const p = rawPorts.get(port); if (!rawCurrent(p)) return null; const registration = opaque(); sessions.get(p.session).resources.set(registration, { port, dispose }); return registration; },
    unregisterNativeSessionPrivateResource(port, registration) { const p = rawPorts.get(port); return !!p && sessions.get(p.session).resources.delete(registration); },
    revokeNativeSessionResourceAuthority: revoke,
  };
  const rows = { patients: [], entries: [], therapies: [], observations: [], attachments: [], users: [], patientsToAmbulatories: [] };
  const names = { patients: ['id','firstName','lastName','birthDate','version','notes','diagnoses','updatedAt','deletedAt','isArchived'],
    entries: ['id','patientId','title','content','date','version','updatedAt','deletedAt'],
    therapies: ['id','patientId','drugName','dosage','activePrinciple','aic','atc','updatedAt','startDate','version','deletedAt','status'],
    observations: ['id','patientId','display','value','unitCode','observedAt','version','updatedAt','deletedAt'],
    attachments: ['id','patientId','name','summarySnapshot','createdAt','documentSourceRef','documentRevision','documentFreshnessEpoch'],
    users: ['id','username','role'], patientsToAmbulatories: ['patientId','ambulatoryId'] };
  const schema = Object.fromEntries(Object.entries(names).map(([table, columns]) => [table,
    Object.fromEntries([['$table', table], ...columns.map(name => [name, { table, name }])])]));
  const get = (row, col) => row[col.name];
  const drizzle = { sql: (strings, ...values) => ({ strings: [...strings], values }),
    eq: (col, value) => row => get(row, col) === value, and: (...ps) => row => ps.every(p => !p || p(row)),
    isNull: col => row => get(row, col) == null, asc: col => ({ col, direction: 1 }), desc: col => ({ col, direction: -1 }) };
  const db = {
    transaction(work) { return work(db); },
    select(fields) {
      let table, predicate = () => true, limit = Infinity, ordering = [];
      const query = { from(t) { table = t.$table; return query; }, where(p) { predicate = p; return query; },
        limit(n) { limit = n; return query; }, orderBy(...order) { ordering = order; return query; },
        all() { return rows[table].filter(predicate).sort((a,b) => { for (const {col,direction} of ordering) {
          const x = get(a,col),y = get(b,col); if (x < y) return -direction; if (x > y) return direction;
        } return 0; }).slice(0,limit).map(row => Object.fromEntries(Object.entries(fields).map(([k,col]) => [k,get(row,col)]))); },
        get() { return query.all()[0]; } }; return query;
    },
    get(query) {
      const sql = query.strings.join('?').replace(/\s+/g,' '), v = query.values;
      if (sql.includes('FROM attachments WHERE id = ? AND patient_id = ?')) {
        const row = rows.attachments.find(row => row.id === v[1] && row.patientId === v[2]);
        return row && { id:row.id, patientId:row.patientId, data:v[0]?.strings.join('') === "''" ? '' : row.data,
          sourceRef:row.documentSourceRef, revision:row.documentRevision, freshnessEpoch:row.documentFreshnessEpoch };
      }
      throw Error('SYNTHETIC_SQL_NOT_IMPLEMENTED');
    },
  };
  for (const verb of ['insert','update','delete','run','exec']) db[verb] = () => { counters.clinicalWrites++; throw Error('NO_CLINICAL_WRITES'); };
  function resolve(session, pair) {
    const patient = rows.patients.find(p => p.id === pair.patientId && !p.deletedAt && !p.isArchived);
    if (!sessions.get(session)?.active || !patient || !rows.patientsToAmbulatories.some(p => p.patientId === pair.patientId && p.ambulatoryId === pair.ambulatoryId)) throw Error('SYNTHETIC_CONTEXT_REVOKED');
    return Object.freeze({ patientId:pair.patientId, ambulatoryId:pair.ambulatoryId, patientVersion:patient.version });
  }
  const unused = () => { counters.forbiddenParserCalls++; throw Error('OMITTED_HELPER_MUST_NOT_BE_USED'); };
  const cookies = new AsyncLocalStorage();
  const stubs = new Map([
    ['drizzle-orm', drizzle], ['next/headers', { cookies: async () => ({ get: () => ({ value: cookies.getStore() }) }) }],
    ['lib/db-server', { dbServer: db }], ['lib/schema', schema], ['lib/patient-lifecycle', { activePatients: () => row => row.deletedAt == null && !row.isArchived }],
    ['lib/security/web-auth-lifecycle-owner-adapter', { serverSessions }],
    ['lib/security/native-inference-environment', { withCurrentNativeInferenceEnvironment(binding, work) { const s = bindings.get(binding); if (!s || !sessions.get(s)?.active) return false; work(); return sessions.get(s).active; } }],
    ['lib/security/server-session', { getSession: id => [...liveSessions].find(s => s.id === id && sessions.get(s)?.active), peekSession: id => [...liveSessions].find(s => s.id === id && sessions.get(s)?.active), registerServerSessionResource: unused,
      SESSION_COOKIE_NAME:'mediflow_session', isPairedNativeServerSession: (s,b) => sessions.get(s)?.active && b.clientId === 'synthetic-client' && b.tokenHash === 'synthetic-binding', retireServerSessionForLogout: id => { for(const s of liveSessions) if(s.id === id) revoke(s); } }],
    ['lib/security/server-auth', { requireSession: async () => null }],
    ['lib/network-home-base-server', { getNetworkOperatingMode: async () => 'network-home-base', authenticateNetworkPairedClient: async request => request.headers.get('x-mediflow-paired-client-id') === 'synthetic-client' && request.headers.get('x-mediflow-paired-client-token') === 'synthetic-token' ? {clientId:'synthetic-client',clientPlatform:'macos',tokenHash:'synthetic-binding'}:null }],
    ['lib/typed-projection-broker', { createTypedProjectionBroker: unused, ProjectionBrokerError: class extends Error {} }],
    ['lib/security/server-session-projection-broker', { bindProjectionBrokerToActiveWebSessionResource: unused, bindProjectionBrokerToServerSession: unused, bindProjectionBrokerToNativeSessionResource: unused }],
    ['lib/security/server-session-clinical-context', { createCanonicalNativeClinicalContextResolver: () => resolve }],
    ['lib/security/server-session-projection-owner-production', { serverSessionProjectionOwnerRegistry: { acquire: unused } }],
    ['lib/security/ordinary-session-authority', {}],
    ['lib/clinical-rich-text', { clinicalRichTextToPlainText: unused }],
    ['lib/chatgpt-product/ordinary-wire', { parseOrdinaryRemoteReceipt: unused, parseOrdinaryRemoteProvenance: unused }],
    ['lib/treatment-reasoning-context', { buildTreatmentReasoningContextBundle: unused }],
  ]);
  // Optional attempt seam is AFTER actual chart-source admission. It does not execute a provider,
  // claim genuine consent, or replace any source parser. Used only by HTTP/Swift transport tests.
  if (options.attemptSeam) {
    const ExecutionError = class extends Error { constructor(code) { super(code); this.code = code; } };
    stubs.set('lib/chatgpt-execution/execution-contract', { ExecutionError });
    stubs.set('lib/chatgpt-execution/execution-mac-product', { reportMacProductPreparationDiagnostic: () => {} });
    stubs.set('lib/security/server-session-authenticated-selection', {
      createAuthenticatedWebSessionSelectionService: ({acquireOwner}) => ({issue: async input => (await acquireOwner()).issueSelection(input)}) });
    stubs.set('lib/chatgpt-product/ordinary-http', { parseOrdinaryCommand: unused });
    stubs.set('lib/chatgpt-product/ordinary-flow', {
      bindNativeOrdinaryHostSources: unused, ordinaryFunctionCommand: unused,
      cancelNativeOrdinaryProjectionAttempt: async () => options.cleanupConfirmed !== false,
      ordinaryFailure(error) { const code = error?.code ?? 'upstream_error';return Response.json({code}, {status:code === 'session_expired'?401:code === 'invalid_request'?400:409}); },
      async beginOrdinaryFunction(request, fn, session) {
        assert.equal(request.body, null);assert.equal(request.signal.aborted, false);
        const context=load('lib/chatgpt-product/native-ordinary-composition.ts').getNativeOrdinaryApplicationContext();
        const source=load('lib/security/server-session-clinical-context-native-sources.ts');
        assert.ok(context?.sources);const ready=source.readNativeOrdinaryHostSource(context.sources, session, fn);
        assert.equal(ready.functionId,fn);counters.admission++;
        const attempt='00000000-0000-4000-8000-000000000001';
        return Response.json({schema:'mediflow.chatgpt-ordinary-flow.v1',phase:'needs_consent',attemptId:attempt,functionId:fn,expiresAt:Date.now()+60000,
          acquisition:source.nativeOrdinarySourceAcquisition(context.sources),
          disclosure:{schema:'mediflow.chatgpt-ordinary-disclosure.v1',revision:'00000000-0000-4000-8000-000000000002',operation:fn,
            profileVersion:'mediflow.ordinary-redacted-profile.v1',contextRevision:'synthetic-NOT-PRODUCTION',attemptRevision:attempt,
            qualificationRevision:'synthetic-NOT-QUALIFIED',sourceSha256:'sha256_'+ 'a'.repeat(64),payloadSha256:'b'.repeat(64),payloadBytes:320,
            egress:['auth.openai.com:443','chatgpt.com:443'],proposalOnly:true,clinicalWrites:0}});
      }
    });
  }
  const engine = loader(stubs), load = engine.load;
  const source = load('lib/security/server-session-clinical-context-native-sources.ts');
  const production = load('lib/security/native-session-projection-owner-production.ts');
  function issue() {
    const now = Date.now(), session = Object.freeze({ id:randomBytes(32).toString('hex'), userId:'synthetic-user', username:'synthetic-user', role:'admin', authChannel:'native', createdAt:now, expiresAt:now+600000 });
    sessions.set(session,{active:true,resources:new Map()});liveSessions.add(session);return session;
  }
  const at = new Date('2026-09-19T10:00:00.000Z');
  rows.patients.push({ id:'synthetic-patient', firstName:'Synthetic',lastName:'Fixture',birthDate:null,version:1,notes:'ENC:synthetic-not-a-crypto-proof',diagnoses:null,updatedAt:at,deletedAt:null,isArchived:false });
  rows.patientsToAmbulatories.push({ patientId:'synthetic-patient', ambulatoryId:'synthetic-ambulatory' });
  rows.users.push({ id:'synthetic-user',username:'synthetic-user',role:'admin' });
  rows.attachments.push({id:'synthetic-attachment',patientId:'synthetic-patient',name:'Documento sintetico',summarySnapshot:null,createdAt:at,data:'ENC:synthetic-binary-not-a-crypto-proof',documentSourceRef:'a'.repeat(64),documentRevision:1,documentFreshnessEpoch:1});
  function preparation(fn='patient_insight') { return {functionId:fn,patientId:'synthetic-patient',ambulatoryId:'synthetic-ambulatory',patientRevision:1,input:fn==='document_synthesis'?{attachmentId:'synthetic-attachment'}:{selector:'current_'+fn}}; }
  function acquire(fn='patient_insight', session=issue()) {
    const request=preparation(fn),owner=production.nativeSessionProjectionOwnerRegistry.acquire(session);
    const lease=owner.issueSelection({expectedEpoch:owner.snapshotSelectionEpoch(session),patientId:request.patientId,ambulatoryId:request.ambulatoryId});
    const capture=source.captureNativeOrdinaryProjectionSources(session,owner,request,lease),plan=source.issueNativeOrdinaryProjection(capture);
    return {request,session,owner,lease,capture,plan};
  }
  function body(plan, values = {}) { return {schemaVersion:plan.schemaVersion,functionId:plan.functionId,rows:plan.roster.map(row=>({entity:row.entity,id:row.id,fields:row.fields.map(name=>({name,value:values[row.entity+'.'+name] ?? (name==='diagnoses'?'[]':'Fonte esclusivamente sintetica')}))}))}; }
  function zero() { assert.equal(counters.provider,0);assert.equal(counters.clinicalWrites,0);assert.equal(counters.forbiddenParserCalls,0); }
  return { ...engine, source, production, rows, db, counters, issue, acquire, preparation, body, revoke, zero,
    dispose(){ for(const s of liveSessions)revoke(s); },
    http(handler, request, session, operation = 'project') { return cookies.run(session.id,()=>handler(request,operation)); },
    fingerprint: value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  };
}
module.exports={fixture};
