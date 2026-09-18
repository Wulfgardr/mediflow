/* @Codex — exact DTO + genuine paired-session HTTP ingress, synthetic row/cookie adapters.
 * Sentinels DENY unexpected downstream activity; they cannot confer source/platform authority. */
'use strict';
const {test,beforeEach}=require('node:test');const assert=require('node:assert/strict');
const f=require('../security/native-ordinary-host.test-support.cjs');
const wire=require('./native-ordinary-wire.ts');
const pairing=require('../network-pairing-model.ts');
// A denied body must not reach any acquisition/ingest/provider attempt. Deny-only tripwires.
for(const [file,name,kind] of [
 ['lib/chatgpt-execution/ordinary-product-attempt.ts','createOrdinaryProductAttempt','provider'],
 ['lib/security/server-session-authenticated-smart-import-attachment-ingest-production.ts','acquireAuthenticatedSmartImportAttachmentIngest','ingest'],
 ['lib/ai-providers/fabric/treatment-reasoning-production-root.ts','acquireTreatmentReasoningIngest','ingest'],
 ['lib/ai-providers/fabric/document-synthesis-production-operation.ts','acquireDocumentSynthesisProductionOperation','ingest'],
 ['lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts','acquireAuthenticatedPatientInsightPreview','ingest'],
])f.replace(file,{[name](){f.counters[kind]++;throw Error('DENY_ONLY_DOWNSTREAM_SENTINEL')}});
const {prepareNativeOrdinary}=require('./native-ordinary-composition.ts');
const {handleNativeOrdinaryHttp}=require('./native-ordinary-http.ts');
const {requirePairedNativeSession}=require('../security/paired-native-session.ts');
const {nativeSessionProjectionOwnerRegistry:registry}=require('../security/native-session-projection-owner-production.ts');
beforeEach(()=>f.reset());
const functions=['patient_insight','smart_import','document_synthesis','treatment_reasoning'];
for(const fn of functions)test(fn+': valid closed selector is copied/frozen and matches only its OpenAPI branch',()=>{
 const raw=f.preparation(fn),result=wire.parseNativeOrdinaryPreparation(raw);
 assert.deepEqual(result,raw);assert.notEqual(result,raw);assert.notEqual(result.input,raw.input);
 assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.input));
 const spec=require('../../docs/openapi/native-ordinary-v1.json');
 const schema=spec.components.schemas.NativeOrdinaryPreparation.oneOf;
 const matches=schema.filter(s=>s.properties.functionId.const===fn);assert.equal(matches.length,1);
 const reference=matches[0].properties.input; const body=reference.$ref ? spec.components.schemas[reference.$ref.split('/').at(-1)] : reference;assert.equal(body.additionalProperties,false);
 assert.deepEqual(Object.keys(result.input),body.required);
 for(const [k,v] of Object.entries(result.input))if(body.properties[k].const)assert.equal(v,body.properties[k].const);
});
for(const fn of functions)for(const other of functions.filter(x=>x!==fn))test(fn+' rejects fields/selector belonging to '+other,()=>{
 assert.throws(()=>wire.parseNativeOrdinaryPreparation({...f.preparation(fn),input:f.preparation(other).input}),{code:'invalid_request'});
});
test('all extra keys, missing keys, nonordinary objects and invalid primitive types denied at both levels',()=>{
 for(const fn of functions){
   const valid=f.preparation(fn);
   for(const key of ['sources','projection','text','sourceRevision','capturedAt','requestId','patientId','attachmentId','capability','apply','__proto__','toJSON']){
     if(!Object.hasOwn(valid.input,key))assert.throws(()=>wire.parseNativeOrdinaryPreparation({...valid,input:{...valid.input,[key]:'FORGED'}}),{code:'invalid_request'});
     if(!Object.hasOwn(valid,key))assert.throws(()=>wire.parseNativeOrdinaryPreparation({...valid,[key]:'FORGED'}),{code:'invalid_request'});
   }
   for(const key of Object.keys(valid)){const copy={...valid};delete copy[key];assert.throws(()=>wire.parseNativeOrdinaryPreparation(copy))}
   for(const input of [null,undefined,[],{},true,'x',1,Object.assign(Object.create(null),valid.input),Object.assign(Object.create({}),valid.input)])assert.throws(()=>wire.parseNativeOrdinaryPreparation({...valid,input}));
 }
 for(const value of [null,[],Object.assign(Object.create(null),f.preparation()),Object.assign(Object.create({}),f.preparation())])assert.throws(()=>wire.parseNativeOrdinaryPreparation(value));
});
test('zero proxy/accessor/coercion callbacks at outer, input and field level, including revoked proxy',()=>{
 let calls=0;const trap=()=>{calls++;throw Error('SHOULD_NOT_RUN')};const valid=f.preparation();
 for(const key of Object.keys(valid)){const v={...valid};Object.defineProperty(v,key,{enumerable:true,get:trap});assert.throws(()=>wire.parseNativeOrdinaryPreparation(v))}
 for(const enumerable of [true,false]){const v={...valid.input};Object.defineProperty(v,'selector',{enumerable,get:trap});assert.throws(()=>wire.parseNativeOrdinaryPreparation({...valid,input:v}))}
 const hidden={...valid.input};Object.defineProperty(hidden,'selector',{value:'current_patient_insight',enumerable:false});assert.throws(()=>wire.parseNativeOrdinaryPreparation({...valid,input:hidden}));
 const symbolic={...valid.input,[Symbol('extra')]:1};assert.throws(()=>wire.parseNativeOrdinaryPreparation({...valid,input:symbolic}));
 for(const wrap of [v=>v,v=>({...valid,input:v})])assert.throws(()=>wire.parseNativeOrdinaryPreparation(wrap(new Proxy(valid.input,{get:trap,getPrototypeOf:trap,ownKeys:trap,getOwnPropertyDescriptor:trap}))));
 const revoked=Proxy.revocable(valid,{});revoked.revoke();assert.throws(()=>wire.parseNativeOrdinaryPreparation(revoked.proxy));
 for(const key of ['patientId','patientRevision','functionId'])assert.throws(()=>wire.parseNativeOrdinaryPreparation({...valid,[key]:{valueOf:trap,toString:trap}}));
 assert.equal(calls,0);
});
test('UTF16 identifier bounds, safe integer revisions, whitespace/control/lone-surrogate failures',()=>{
 const valid=f.preparation();
 for(const key of ['patientId','ambulatoryId']){
  for(const value of ['', ' ', ' x','x ', 'a\n', 'a\0b','a\x7fb','x'.repeat(161),'\ud800','\udfff',null,1])assert.throws(()=>wire.parseNativeOrdinaryPreparation({...valid,[key]:value}));
  assert.equal(wire.parseNativeOrdinaryPreparation({...valid,[key]:'x'.repeat(160)})[key].length,160);
  assert.equal(wire.parseNativeOrdinaryPreparation({...valid,[key]:'😀'.repeat(80)})[key].length,160);
  assert.throws(()=>wire.parseNativeOrdinaryPreparation({...valid,[key]:'😀'.repeat(81)}));
 }
 for(const patientRevision of [0,-0,-1,1.1,Infinity,NaN,Number.MAX_SAFE_INTEGER+1,1n,'1',true,null])assert.throws(()=>wire.parseNativeOrdinaryPreparation({...valid,patientRevision}));
 assert.equal(wire.parseNativeOrdinaryPreparation({...valid,patientRevision:Number.MAX_SAFE_INTEGER}).patientRevision,Number.MAX_SAFE_INTEGER);
 for(const attachmentId of ['', ' ', ' x', 'x ', 'x'.repeat(201),'\ud800',1,null])assert.throws(()=>wire.parseNativeOrdinaryPreparation({...f.preparation('document_synthesis'),input:{attachmentId}}));
 assert.equal(wire.parseNativeOrdinaryPreparation({...f.preparation('document_synthesis'),input:{attachmentId:'a'.repeat(200)}}).input.attachmentId.length,200);
});
function sessionAndRequest(body){
 const token='synthetic-paired-secret-'.repeat(3),tokenHash=pairing.hashNetworkPairedClientToken(token);
 f.pair({tokenHash});const session=f.issue({},{tokenHash});f.setSessionCookie(session.id);
 const request=new Request('http://localhost/api/v1/network/ai/chatgpt/ordinary/prepare',{method:'POST',headers:{'Content-Type':'application/json',
  [pairing.NETWORK_PAIRED_CLIENT_ID_HEADER]:f.binding.clientId,[pairing.NETWORK_PAIRED_CLIENT_TOKEN_HEADER]:token},body:typeof body==='string'?body:JSON.stringify(body)});
 return {session,request};
}
for(const fn of functions)test(fn+': valid real IDs/revision + fabricated clinical input denied BEFORE acquisition, ingest or provider',async()=>{
 for(const input of [{text:'Inventato non presente nella cartella'},{sources:[{summary:'Inventato'}]},
   {projection:{patientRevision:1,sources:['Inventato']}},{...f.preparation(fn).input,text:'Inventato'}]){
  const raw={...f.preparation(fn),input};const {session,request}=sessionAndRequest(raw);
  assert.equal(await requirePairedNativeSession(request),session,'fixture MUST authenticate genuinely before denial test');
  const owner=registry.acquire(session);assert.equal(owner.snapshotSelectionEpoch(session),0);
  const response=await handleNativeOrdinaryHttp(request,'prepare');
  assert.equal(response.status,400);assert.equal((await response.json()).code,'invalid_request');
  assert.equal(owner.snapshotSelectionEpoch(session),0,'operation/selection not started');
  await assert.rejects(prepareNativeOrdinary(new Request(request.url),session,raw),{code:'invalid_request'});
  assert.deepEqual(f.counters,{acquisition:0,ingest:0,provider:0,clinicalWrites:0});
 }
});
test('strict HTTP JSON rejects duplicate keys, >4096 bytes, wrong function and extra keys before acquisition',async()=>{
 const valid=JSON.stringify(f.preparation());
 for(const body of [valid.replace('"patientId":','"patientId":"synthetic-patient","patientId":'),
  ' '.repeat(4097)+valid,JSON.stringify({...f.preparation(),input:{selector:'current_smart_import'}}),JSON.stringify({...f.preparation(),text:'forged'})]){
  const {session,request}=sessionAndRequest(body);assert.equal(await requirePairedNativeSession(request),session);
  const response=await handleNativeOrdinaryHttp(request,'prepare');assert.equal(response.status,400);
  assert.deepEqual(f.counters,{acquisition:0,ingest:0,provider:0,clinicalWrites:0});
 }
});
