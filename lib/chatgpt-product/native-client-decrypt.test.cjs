/* @Codex — bounded-snapshot tests. No real ciphertext/Swift, TLS, provider, or AnyDoc-worker claim. */
'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {fixture}=require('./fixtures/native-client-decrypt-host.cjs');
const fnames=['patient_insight','smart_import','treatment_reasoning'];
function harness(t){const f=fixture();t.after(()=>{f.zero();f.dispose();});return f;}
function finish(f,c,body=f.body(c.plan)){f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId);f.source.finalizeNativeOrdinaryChartProjection(c.capture,body);f.source.completeNativeOrdinaryProjection(c.capture);return f.source.readNativeOrdinaryHostSource(c.capture,c.session,c.request.functionId);}
for(const fn of fnames)test(`real ${fn} canonical parser: encrypted roster -> exact projection -> ready capture`,t=>{
 const f=harness(t),c=f.acquire(fn); assert.equal(c.plan.functionId,fn);
 assert.deepEqual(c.plan.roster,[{entity:'patient',id:'synthetic-patient',fields:['notes']}]);
 assert.ok(!JSON.stringify(c.plan).includes('ENC:'));assert.ok(!JSON.stringify(c.plan).includes('Fonte'));
 assert.throws(()=>f.source.readNativeOrdinaryHostSource(c.capture,c.session,fn));
 const before=structuredClone(f.rows),result=finish(f,c); assert.equal(result.functionId,fn);
 assert.ok(JSON.stringify(result.input).includes('Fonte esclusivamente sintetica'));
 assert.deepEqual(f.rows,before);assert.deepEqual(f.source.nativeOrdinarySourceAcquisition(c.capture),{origin:'authenticated_client_decryption',ciphertextEquality:'not_attested'});
 assert.throws(()=>f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId));
 f.source.nativeOrdinaryProjectionHandedOff(c.capture); assert.ok(f.source.nativeOrdinaryHostSourcesAreCurrent(c.capture));
 assert.ok(f.source.nativeOrdinarySourceMatchesGrant(c.capture,c.session,c.plan.grantId));
});
test('legacy capture rejects ENC before canonical parser',t=>{
 const f=harness(t),c=f.acquire();assert.throws(()=>f.source.captureNativeOrdinaryHostSources(c.session,c.owner,c.request,c.lease));
});
test('host non-ENC field cannot become caller text; structured diagnoses admitted via canonical parser',t=>{
 const f=harness(t);f.rows.patients[0].diagnoses='ENC:synthetic-diagnoses';const c=f.acquire('patient_insight');
 const body=f.body(c.plan,{'patient.diagnoses':JSON.stringify([{system:'synthetic',code:'S01',description:'Condizione sintetica'}])});
 const v=finish(f,c,body);assert.deepEqual(v.input.sources.conditions,[{label:'Condizione sintetica'}]);
 assert.equal(f.rows.patients[0].firstName,'Synthetic');
});
test('TR sourceRevision binds ciphertext snapshot rather than submitted text',t=>{
 const f=harness(t),c=f.acquire('treatment_reasoning');
 const read=f.load('lib/security/server-session-clinical-context-native-source-rows.ts').readNativeOrdinarySourceRows;
 const original=f.fingerprint(read({patientId:c.request.patientId,ambulatoryId:c.request.ambulatoryId},'treatment_reasoning'));
 const v=finish(f,c);assert.equal(v.input.sourceRevision,`source_${original}`);
});
const corruptions={
 'missing row':b=>b.rows=[], 'extra row':b=>b.rows.push(structuredClone(b.rows[0])),
 'duplicate row':b=>b.rows=[b.rows[0],b.rows[0]], 'missing field':b=>b.rows[0].fields=[],
 'extra field':b=>b.rows[0].fields.push({name:'firstName',value:'Caller replacement'}),
 'duplicate field':b=>b.rows[0].fields.push(b.rows[0].fields[0]),
 'wrong entity':b=>b.rows[0].entity='entries','wrong id':b=>b.rows[0].id='other-patient',
 'wrong field':b=>b.rows[0].fields[0].name='diagnoses','cross function':b=>b.functionId='smart_import',
 'DS as JSON':b=>b.functionId='document_synthesis','caller revision':b=>b.patientRevision=1,
 'caller capture time':b=>b.capturedAt=new Date().toISOString(),'caller source digest':b=>b.sourceRevision='invented',
 'residual ENC':b=>b.rows[0].fields[0].value='left ENC:synthetic right',
 'failed decrypt sentinel':b=>b.rows[0].fields[0].value='[LOCKED DATA]',
 'null plaintext':b=>b.rows[0].fields[0].value=null, 'unpaired surrogate':b=>b.rows[0].fields[0].value='\ud800',
 'NUL plaintext':b=>b.rows[0].fields[0].value='synthetic\0text','oversize plaintext':b=>b.rows[0].fields[0].value='x'.repeat(262145),
 'sparse roster':b=>delete b.rows[0], 'array extra property':b=>b.rows.extra='not permitted',
 'row extra property':b=>b.rows[0].revision=1,'field extra property':b=>b.rows[0].fields[0].ciphertextEquality='attested',
 'getter field':b=>Object.defineProperty(b.rows[0].fields[0],'value',{enumerable:true,get(){throw Error('getter invoked');}}),
 'proxy body':b=>new Proxy(b,{get(){throw Error('proxy invoked');}}),
};
for(const [name,change]of Object.entries(corruptions))test(`terminal rejection: ${name}; zero provider/writes`,t=>{
 const f=harness(t),c=f.acquire();let b=f.body(c.plan);const replacement=change(b);if(name==='proxy body')b=replacement;
 f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId);
 assert.throws(()=>f.source.finalizeNativeOrdinaryChartProjection(c.capture,b));
 assert.equal(f.source.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);
 assert.throws(()=>f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId));
});
const stale={
 'altered ciphertext':f=>f.rows.patients[0].notes+='altered',
 'patient revision':f=>f.rows.patients[0].version++,
 'non-ENC host metadata':f=>f.rows.patients[0].firstName='Changed host',
 'membership removed':f=>f.rows.patientsToAmbulatories.length=0,
 'archived patient':f=>f.rows.patients[0].isArchived=true,
 'deleted patient':f=>f.rows.patients[0].deletedAt=new Date(),
 'native logout':(f,c)=>f.revoke(c.session),
 'selection lock/dispose':(f,c)=>c.owner.dispose(),
};
for(const [name,mutate] of Object.entries(stale))for(const stage of ['before-body','before-dispatch','before-publication'])test(`${name} ${stage} denies without provider/writes`,t=>{
 const f=harness(t),c=f.acquire();if(stage!=='before-body')finish(f,c);
 mutate(f,c);assert.equal(f.source.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);
 assert.throws(()=>stage==='before-body'?f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId):f.source.readNativeOrdinaryHostSource(c.capture,c.session,c.request.functionId));
});
test('observed A -> B -> A is terminal at real selection owner',t=>{
 const f=harness(t),c=f.acquire();
 f.rows.patients.push({...f.rows.patients[0],id:'synthetic-patient-B'});
 f.rows.patientsToAmbulatories.push({patientId:'synthetic-patient-B',ambulatoryId:c.request.ambulatoryId});
 c.owner.issueSelection({expectedEpoch:c.owner.snapshotSelectionEpoch(c.session),patientId:'synthetic-patient-B',ambulatoryId:c.request.ambulatoryId});
 c.owner.issueSelection({expectedEpoch:c.owner.snapshotSelectionEpoch(c.session),patientId:c.request.patientId,ambulatoryId:c.request.ambulatoryId});
 assert.equal(f.source.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);assert.throws(()=>f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId));
});
test('one observed ciphertext mismatch remains revoked after restoration',t=>{
 const f=harness(t),c=f.acquire(),original=f.rows.patients[0].notes;f.rows.patients[0].notes+='changed';
 assert.equal(f.source.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);f.rows.patients[0].notes=original;
 assert.equal(f.source.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);
});
test('grant expiry checked synchronously, including clock rollback after an observed expiry',t=>{
 const f=harness(t),c=f.acquire(),now=Date.now;try{Date.now=()=>c.plan.expiresAt;assert.throws(()=>f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId));}finally{Date.now=now;}
 assert.equal(f.source.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);
});
test('processing phase has finite synchronous deadline',t=>{
 const f=harness(t),c=f.acquire(),now=Date.now;f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId);
 try{Date.now=()=>now()+120001;assert.equal(f.source.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);}finally{Date.now=now;}
});
test('other issued session cannot claim/cancel legitimate grant; fake capture fails',t=>{
 const f=harness(t),c=f.acquire(),other=f.issue();assert.throws(()=>f.source.claimNativeOrdinaryProjection(other,c.plan.grantId));
 f.source.cancelNativeOrdinaryProjection(other,c.plan.grantId);assert.ok(f.source.nativeOrdinaryHostSourcesAreCurrent(c.capture));
 assert.throws(()=>f.source.completeNativeOrdinaryProjection(Object.freeze({})));
 finish(f,c);
});
test('opaque grant requires native authority; no descriptor/session may mint another',t=>{
 const f=harness(t),c=f.acquire();assert.throws(()=>f.source.claimNativeOrdinaryProjection(c.session,'0'.repeat(64)));
 assert.throws(()=>f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId.toUpperCase()));
 assert.throws(()=>f.source.captureNativeOrdinaryProjectionSources(c.session,{},c.request,c.lease));
});
test('pre-attempt cancel closes signal and denies replay without creating an attempt',t=>{
 const f=harness(t),c=f.acquire(),signal=f.source.nativeOrdinaryHostSourceSignal(c.capture);f.source.cancelNativeOrdinaryProjection(c.session,c.plan.grantId);
 assert.equal(signal.aborted,true);assert.throws(()=>f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId));assert.equal(f.counters.admission,0);
});
test('DS real native attachment authority consumes bounded binary and wipes owned copy; witness survives finalization',async t=>{
 const f=harness(t),c=f.acquire('document_synthesis');assert.deepEqual(c.plan.roster,[{entity:'attachment_bytes',id:'synthetic-attachment',fields:['data']}]);
 f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId);
 const use=f.source.consumeNativeOrdinaryDocumentProjection(c.capture,c.session,'synthetic-attachment');
 const transport=f.load('lib/domain/documents/attachment-extraction-projection-transport.ts');
 const payload=Buffer.from('synthetic binary fixture; NOT AnyDoc extraction proof');
 const admitted=await transport.readAttachmentExtractionProjectionBytes(new Request('http://127.0.0.1/synthetic',{method:'POST',headers:{'content-type':'application/octet-stream','content-length':String(payload.length)},body:payload}),use);
 assert.ok(admitted);const begun=use.consume(admitted);assert.equal(begun.status,'begun');assert.deepEqual(Buffer.from(begun.bytes),payload);
 admitted.fill(0);assert.equal(use.finalize(),true);assert.ok(begun.bytes.every(b=>b===0));use.dispose();
 f.source.completeNativeOrdinaryProjection(c.capture);assert.equal(f.source.readNativeOrdinaryHostSource(c.capture,c.session,'document_synthesis').functionId,'document_synthesis');
 f.rows.attachments[0].data+='altered after finalize';assert.equal(f.source.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);
});
for(const mutation of ['data','documentRevision','documentFreshnessEpoch','documentSourceRef'])test(`DS ${mutation} invalidates full witness`,t=>{
 const f=harness(t),c=f.acquire('document_synthesis');if(typeof f.rows.attachments[0][mutation]==='number')f.rows.attachments[0][mutation]++;else f.rows.attachments[0][mutation]+='changed';
 assert.throws(()=>f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId));
});
test('DS cancellation while binary is retained wipes source-owned bytes',t=>{
 const f=harness(t),c=f.acquire('document_synthesis');f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId);
 const use=f.source.consumeNativeOrdinaryDocumentProjection(c.capture,c.session,'synthetic-attachment'),owned=use.consume(new Uint8Array([1,2,3]));assert.equal(owned.status,'begun');
 f.revoke(c.session);assert.ok(owned.bytes.every(b=>b===0));assert.equal(use.finalize(),false);use.dispose();
});
const malformedJSON=['{"a":1,"a":2}','{"nested":{"a":1,"a":2}}','{"a":','',Buffer.from([0xff])];
for(let i=0;i<malformedJSON.length;i++)test(`strict JSON transport denies malformed/duplicate/fatal-UTF8 ${i}`,async t=>{
 const f=harness(t),read=f.load('lib/chatgpt-product/native-ordinary-projection-transport.ts').readNativeOrdinaryProjectionJson;
 await assert.rejects(()=>read(new Request('http://127.0.0.1/synthetic',{method:'POST',headers:{'content-type':'application/json'},body:malformedJSON[i]}),{signal:new AbortController().signal,current:()=>true}));
});
for(const headers of [{'content-type':'text/plain'},{'content-type':'application/json; charset=utf-8'},{'content-type':'application/json','content-encoding':'gzip'},{'content-type':'application/json','content-length':'0'},{'content-type':'application/json','content-length':'2097153'},{'content-type':'application/json','content-length':'999'}])test(`strict JSON MIME/length ${JSON.stringify(headers)}`,async t=>{
 const f=harness(t),read=f.load('lib/chatgpt-product/native-ordinary-projection-transport.ts').readNativeOrdinaryProjectionJson;
 await assert.rejects(()=>read(new Request('http://127.0.0.1/synthetic',{method:'POST',headers,body:'{}'}),{signal:new AbortController().signal,current:()=>true}));
});
test('suspended JSON stream is cancelled on actual native lifecycle revocation',async t=>{
 const f=harness(t),c=f.acquire();f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId);let cancelled=false;
 const request=new Request('http://127.0.0.1/synthetic',{method:'POST',headers:{'content-type':'application/json'},duplex:'half',body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}})});
 const promise=f.load('lib/chatgpt-product/native-ordinary-projection-transport.ts').readNativeOrdinaryProjectionJson(request,f.source.nativeOrdinaryProjectionReadControl(c.capture));
 f.revoke(c.session);await assert.rejects(promise);assert.equal(cancelled,true);
});

test('session DTO clone cannot read, claim or cancel an authentic capture',t=>{
 const f=harness(t),c=f.acquire(),clone={...c.session};
 assert.throws(()=>f.source.claimNativeOrdinaryProjection(clone,c.plan.grantId));
 f.source.cancelNativeOrdinaryProjection(clone,c.plan.grantId);assert.ok(f.source.nativeOrdinaryHostSourcesAreCurrent(c.capture));
 finish(f,c);assert.throws(()=>f.source.readNativeOrdinaryHostSource(c.capture,clone,c.request.functionId));
 assert.equal(f.source.nativeOrdinarySourceMatchesGrant(c.capture,clone,c.plan.grantId),false);
});

test('DS native authority -> original pinned AnyDoc worker -> final witness (requires included worker)',async t=>{
 const fs=require('node:fs'),path=require('node:path');const f=harness(t);
 if(!fs.existsSync(path.join(f.root,'scripts/anydoc-local-extraction-worker.mjs'))){t.skip('NOT_RUN: pinned AnyDoc worker omitted from bounded snapshot');return;}
 const c=f.acquire('document_synthesis');f.source.claimNativeOrdinaryProjection(c.session,c.plan.grantId);
 const use=f.source.consumeNativeOrdinaryDocumentProjection(c.capture,c.session,'synthetic-attachment');
 const payload=Buffer.from('{\\rtf1\\ansi Synthetic current source note.}');
 const read=f.load('lib/domain/documents/attachment-extraction-projection-transport.ts').readAttachmentExtractionProjectionBytes;
 const bytes=await read(new Request('http://127.0.0.1/synthetic',{method:'POST',headers:{'content-type':'application/octet-stream'},body:payload}),use);
 assert.ok(bytes);const begun=use.consume(bytes);bytes.fill(0);assert.equal(begun.status,'begun');
 const extract=f.load('lib/domain/documents/anydoc-local-extraction-runner.ts').extractAnyDocLocalBytes;
 const result=await extract('synthetic-attachment',begun.bytes);assert.ok(use.current());assert.equal(result.status,'extracted');
 assert.equal(result.markdown,'Synthetic current source note.');assert.equal(result.writes,0);assert.equal(result.apply,'none');
 assert.equal(use.finalize(),true);assert.ok(begun.bytes.every(b=>b===0));use.dispose();f.source.completeNativeOrdinaryProjection(c.capture);
});
