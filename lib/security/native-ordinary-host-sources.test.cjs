/* @Codex — authentic native issuer/owner against explicit synthetic row storage. */
'use strict';
const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const f=require('./native-ordinary-host.test-support.cjs');
const {nativeSessionProjectionOwnerRegistry:registry}=require('./native-session-projection-owner-production.ts');
const s=require('./server-session-clinical-context-native-sources.ts');
beforeEach(()=>f.reset());
function acquire(functionId='patient_insight'){
 const session=f.issue(),owner=registry.acquire(session);
 const lease=owner.issueSelection({expectedEpoch:owner.snapshotSelectionEpoch(session),patientId:'synthetic-patient',ambulatoryId:'synthetic-ambulatory'});
 const capture=s.captureNativeOrdinaryHostSources(session,owner,f.preparation(functionId),lease);
 return {session,owner,lease,capture,functionId};
}
for(const functionId of ['patient_insight','smart_import','treatment_reasoning'])test(functionId+': positive genuine host capture contains only canonical synthetic rows',()=>{
 const c=acquire(functionId),result=s.readNativeOrdinaryHostSource(c.capture,c.session,functionId);
 assert.equal(result.functionId,functionId);assert.ok(Object.isFrozen(result));
 assert.match(JSON.stringify(result),/sintetic/);assert.ok(f.counters.acquisition>=3);
 assert.equal(s.nativeOrdinaryHostSourcesAreCurrent(c.capture),true);
 assert.equal(f.counters.clinicalWrites,0);assert.equal(f.counters.provider,0);
 s.closeNativeOrdinaryHostSources(c.capture);assert.equal(s.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);
});
for(const [name,mutate] of [
 ['patient revision',()=>f.rows.patients[0].version++],
 ['notes without patient revision',()=>{f.rows.patients[0].notes='Cambio sintetico'}],
 ['entry text without patient revision',()=>{f.rows.entries[0].content='Cambio sintetico'}],
 ['entry revision alone',()=>f.rows.entries[0].version++],
 ['therapy deletion',()=>{f.rows.therapies[0].deletedAt=new Date()}],
 ['therapy dosage',()=>{f.rows.therapies[0].dosage='Cambio sintetico'}],
 ['observation revision',()=>f.rows.observations[0].version++],
 ['document freshness',()=>f.rows.attachments[0].documentFreshnessEpoch++],
 ['document summary without revision',()=>{f.rows.attachments[0].summarySnapshot='Cambio sintetico'}],
 ['membership revoked',()=>{f.rows.patientsToAmbulatories=[]}],
 ['archived patient',()=>{f.rows.patients[0].isArchived=true}],
 ['pairing revoked',()=>f.setSetting('network.pairing.state',JSON.stringify({clients:[],intents:[]}))],
 ['inference capability removed',()=>f.pair({grantedCapabilities:['native.ai.configure']})],
 ['operator role changed',()=>{f.rows.users[0].role='admin'}],
])test('capture terminal on '+name,()=>{
 const c=acquire('treatment_reasoning');mutate();
 assert.equal(s.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);
 assert.throws(()=>s.readNativeOrdinaryHostSource(c.capture,c.session,c.functionId));
 assert.equal(f.counters.provider,0);assert.equal(f.counters.clinicalWrites,0);
});
test('observed source mutation then restore never revives a capture',()=>{
 const c=acquire(),text=f.rows.patients[0].notes;f.rows.patients[0].notes='Mutazione sintetica';
 assert.equal(s.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);f.rows.patients[0].notes=text;
 assert.equal(s.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);
});
test('same patient re-selection invalidates original selection lease',()=>{
 const c=acquire();c.owner.issueSelection({expectedEpoch:c.owner.snapshotSelectionEpoch(c.session),patientId:'synthetic-patient',ambulatoryId:'synthetic-ambulatory'});
 assert.equal(s.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);
});
test('clone/cross-session/cross-function/native-Web confusion cannot acquire source authority',()=>{
 const c=acquire();assert.equal(s.nativeOrdinaryHostSourcesAreCurrent({...c.capture}),false);
 assert.throws(()=>s.readNativeOrdinaryHostSource(c.capture,{...c.session},c.functionId));
 assert.throws(()=>s.readNativeOrdinaryHostSource(c.capture,c.session,'smart_import'));
 assert.throws(()=>s.captureNativeOrdinaryHostSources(f.web(),c.owner,f.preparation(),c.lease));
 assert.throws(()=>s.captureNativeOrdinaryHostSources(c.session,{...c.owner},f.preparation(),c.lease));
});
test('physical logout revokes source capture',()=>{
 const c=acquire();f.owner.serverSessions.deleteSession(c.session.id);
 assert.equal(s.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);
});
test('wrong revision fails acquisition and no ingress payload can be promoted to host rows',()=>{
 const session=f.issue(),owner=registry.acquire(session),lease=owner.issueSelection({expectedEpoch:owner.snapshotSelectionEpoch(session),patientId:'synthetic-patient',ambulatoryId:'synthetic-ambulatory'});
 assert.throws(()=>s.captureNativeOrdinaryHostSources(session,owner,{...f.preparation(),patientRevision:2},lease));
 const prior=f.counters.acquisition;
 assert.throws(()=>s.captureNativeOrdinaryHostSources(session,owner,{...f.preparation(),input:{sources:[{text:'Inventato'}]}},lease));
 assert.equal(f.counters.acquisition,prior);assert.equal(f.counters.ingest,0);assert.equal(f.counters.provider,0);
});
for(const functionId of ['patient_insight','smart_import','treatment_reasoning'])test(functionId+': ciphertext/empty chart fail closed without decrypt or fallback',()=>{
 f.rows.patients[0].notes='ENC:synthetic-ciphertext';assert.throws(()=>acquire(functionId));
 f.reset();f.rows.patients[0].notes=null;f.rows.patients[0].diagnoses=null;for(const t of ['entries','therapies','observations','attachments'])f.rows[t]=[];
 assert.throws(()=>acquire(functionId));assert.equal(f.counters.provider,0);assert.equal(f.counters.clinicalWrites,0);
});
