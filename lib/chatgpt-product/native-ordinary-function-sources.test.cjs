/* @Codex — real native issuer/owner/application services; explicit synthetic rows.
 * DS uses a TEST-ONLY plain-text parser, not OCR/AnyDoc worker proof. Source authority is real.
 * No qualified platform, remote model, alternative provider or clinical writer is used. */
'use strict';
const {test,beforeEach,afterEach}=require('node:test');const assert=require('node:assert/strict');
const {randomBytes,createHash}=require('node:crypto');
const f=require('../security/native-ordinary-host.test-support.cjs');
let parserCalls=0,parserHook=null;
f.replace('lib/domain/documents/anydoc-local-extraction-runner.ts',{
 async extractAnyDocLocalBytes(id,raw){
  parserCalls++;const bytes=Buffer.from(raw);assert.equal(bytes.toString(),'Testo documento esclusivamente sintetico host.');
  await parserHook?.();
  return buildAnyDocLocalExtraction({attachmentId:id,sourceSha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length},bytes.toString());
 },
});
const native=require('../security/native-inference-lifecycle.ts');
const {nativeSessionProjectionOwnerRegistry:registry,resolveNativeOrdinaryClinicalContext}=require('../security/native-session-projection-owner-production.ts');
const source=require('../security/server-session-clinical-context-native-sources.ts');
const {parseNativeOrdinaryPreparation}=require('./native-ordinary-wire.ts');
const {buildAnyDocLocalExtraction}=require('../domain/documents/anydoc-local-extraction-contract.ts');
const {composeAnyDocCurrentSelectionExtraction}=require('../domain/documents/anydoc-current-source-composition.ts');
const {createDocumentSynthesisProductionOperationForTest}=require('../ai-providers/fabric/document-synthesis-production-operation.ts');
const {createTreatmentReasoningAuthenticatedProjectionBroker}=require('../ai-providers/fabric/treatment-reasoning-authenticated-projection.ts');
const {ingestNativeSessionSmartImportAttachmentWithOwner}=require('../security/server-session-smart-import-attachment-ingest.ts');
const {prepareNativeOrdinary}=require('./native-ordinary-composition.ts');
const {parseOrdinaryStoredSettings}=require('./ordinary-settings.ts');
const flow=require('./ordinary-flow.ts');
beforeEach(()=>{f.reset();parserCalls=0;parserHook=null});
afterEach(()=>f.reset());
const requestId=()=>`synthetic_${randomBytes(16).toString('hex')}`;
function acquire(fn){
 const session=f.issue(),owner=registry.acquire(session),selection=owner.issueSelection({expectedEpoch:owner.snapshotSelectionEpoch(session),patientId:'synthetic-patient',ambulatoryId:'synthetic-ambulatory'});
 const capture=fn==='document_synthesis'?null:source.captureNativeOrdinaryHostSources(session,owner,f.preparation(fn),selection);
 return {session,owner,selection,capture};
}
function register(session,dispose){
 const port=native.mintResourcePort(session);if(!port)return null;
 const registration=native.registerPrivateResource(port,dispose);if(!registration){native.releaseResourcePort(port);return null}
 return ()=>{native.unregisterPrivateResource(port,registration);native.releaseResourcePort(port)};
}
test('Smart Import selector -> host source capture -> original native attachment ingest -> original one-use projection',()=>{
 const c=acquire('smart_import');const captured=source.readNativeOrdinaryHostSource(c.capture,c.session,'smart_import');
 const {sessionRef,selectionEpoch,patientRef,ambulatoryRef,leaseRef}=c.selection;
 const handle=ingestNativeSessionSmartImportAttachmentWithOwner(c.session,c.owner,{tuple:{sessionRef,selectionEpoch,patientRef,ambulatoryRef,leaseRef},attachment:captured.input,requestId:requestId()});
 const service=c.owner.resolveProjectionService(c.session);
 const projection=service.consume({handle,capability:'smart_import',requestId:requestId()});
 assert.match(JSON.stringify(projection),/Nota esclusivamente sintetica host/);
 assert.equal(source.nativeOrdinaryHostSourcesAreCurrent(c.capture),true);
 assert.throws(()=>service.consume({handle,capability:'smart_import',requestId:requestId()}));
 source.closeNativeOrdinaryHostSources(c.capture);assert.equal(f.counters.provider,0);assert.equal(f.counters.clinicalWrites,0);
});
test('Treatment Reasoning selector -> host sources -> original native broker/lease commit, capture stays current',async()=>{
 const c=acquire('treatment_reasoning');const captured=source.readNativeOrdinaryHostSource(c.capture,c.session,'treatment_reasoning');
 const broker=createTreatmentReasoningAuthenticatedProjectionBroker({acquireContext:async()=>({session:c.session,owner:c.owner}),clock:()=>new Date().toISOString(),entropy:()=>randomBytes(16),
  readPatientVersion:(patientId,ambulatoryId)=>resolveNativeOrdinaryClinicalContext(c.session,{patientId,ambulatoryId}).patientVersion,
  registerResource:(sessionId,dispose)=>sessionId===c.session.id?register(c.session,dispose):null});
 const handle=(await broker.acquireIngest()).ingest({projection:captured.input,requestId:requestId()});
 const execution=(await broker.acquirePreview()).begin({handle,requestId:requestId()});
 assert.match(JSON.stringify(execution.projection),/Nota esclusivamente sintetica host/);
 assert.equal(source.nativeOrdinaryHostSourcesAreCurrent(c.capture),true);
 assert.equal(execution.commit(),true);assert.equal(execution.commit(),false);
 assert.equal(source.nativeOrdinaryHostSourcesAreCurrent(c.capture),true);
 source.closeNativeOrdinaryHostSources(c.capture);assert.equal(f.counters.provider,0);assert.equal(f.counters.clinicalWrites,0);
});
async function document(){
 const c=acquire('document_synthesis');
 const service=createDocumentSynthesisProductionOperationForTest({
  acquireContext:async()=>({session:c.session,owner:c.owner}),
  readCurrentness:(id,patientId,ambulatoryId)=>{
   resolveNativeOrdinaryClinicalContext(c.session,{patientId,ambulatoryId});
   const row=f.rows.attachments.find(row=>row.id===id&&row.patientId===patientId);
   return row?{documentSourceRef:row.documentSourceRef,documentRevision:row.documentRevision,documentFreshnessEpoch:row.documentFreshnessEpoch}:null;
  },readLaneEnabled:()=>true,extract:(session,attachmentId)=>composeAnyDocCurrentSelectionExtraction(session,{attachmentId}),
  execute:async()=>{f.counters.provider++;throw Error('NO_PROVIDER_ALLOWED_IN_SOURCE_TEST')},entropy:()=>randomBytes(16),
 });
 const operation=await service.acquire();assert.ok(operation,'original test seam must be enabled by node --test');
 return {...c,operation};
}
test('Document Synthesis selector -> actual attachment source authority -> original capture/ingest; host bytes only',async()=>{
 const c=await document();const selector=parseNativeOrdinaryPreparation(f.preparation('document_synthesis'));
 const capture=await c.operation.capture(selector.input);assert.equal(capture.status,'available');
 const ingest=await c.operation.ingest({captureHandle:capture.captureHandle});assert.equal(ingest.status,'available');
 assert.equal(parserCalls,1);assert.equal(f.counters.provider,0);assert.equal(f.counters.clinicalWrites,0);
 assert.equal((await c.operation.ingest({captureHandle:capture.captureHandle})).code,'capture_consumed');
 // Test publication barrier WITHOUT sending anything to a model.
 f.rows.attachments[0].documentFreshnessEpoch++;
 const published=await c.operation.preview({previewHandle:ingest.previewHandle});assert.equal(published.status,'denied');assert.equal(published.code,'currentness_mismatch');
 assert.equal(f.counters.provider,0);
});
test('Document Synthesis rejects foreign ID and source text before parser/ingest',async()=>{
 const c=await document();
 for(const input of [{attachmentId:'synthetic-foreign'}, {attachmentId:'synthetic-attachment-1',text:'forged'}])assert.equal((await c.operation.capture(input)).status,'denied');
 assert.equal(parserCalls,0);assert.equal(f.counters.provider,0);
});
test('Document Synthesis source change BEFORE extraction prevents parser and provider',async()=>{
 const c=await document(),capture=await c.operation.capture({attachmentId:'synthetic-attachment-1'});assert.equal(capture.status,'available');
 f.rows.attachments[0].documentRevision++;
 assert.equal((await c.operation.ingest({captureHandle:capture.captureHandle})).code,'currentness_mismatch');
 assert.equal(parserCalls,0);assert.equal(f.counters.provider,0);
});
test('Document Synthesis source change DURING async parser prevents ingest publication',async()=>{
 const c=await document(),capture=await c.operation.capture({attachmentId:'synthetic-attachment-1'});assert.equal(capture.status,'available');
 parserHook=async()=>{f.rows.attachments[0].documentFreshnessEpoch++};
 assert.equal((await c.operation.ingest({captureHandle:capture.captureHandle})).status,'denied');
 assert.equal(parserCalls,1);assert.equal(f.counters.provider,0);
});
test('Document Synthesis cipher bytes cannot be replaced with client cleartext or alternate decryption',async()=>{
 const c=await document();f.rows.attachments[0].data='ENC:synthetic';
 const capture=await c.operation.capture({attachmentId:'synthetic-attachment-1'});assert.equal(capture.status,'available');
 assert.equal((await c.operation.ingest({captureHandle:capture.captureHandle})).status,'denied');assert.equal(parserCalls,0);assert.equal(f.counters.provider,0);
});
for(const fn of ['patient_insight','smart_import','treatment_reasoning'])test(fn+': actual fixed composition reaches original preview with closed clinical lane, no provider',async()=>{
 const settings=parseOrdinaryStoredSettings();f.setSetting('ai.fabric.chatgptOrdinary',JSON.stringify({...settings,enabled:true}));
 const session=f.issue();const response=await prepareNativeOrdinary(new Request('http://localhost/api/v1/network/ai/chatgpt/ordinary/prepare'),session,f.preparation(fn));
 const body=await response.json();assert.equal(response.status,fn==='treatment_reasoning'?403:200,JSON.stringify(body));
 assert.match(JSON.stringify(body),/kill_switch_disabled|lane_disabled|ai_smart_import_disabled/,JSON.stringify(body));assert.ok(f.counters.acquisition>2);
 assert.equal(registry.acquire(session).snapshotSelectionEpoch(session),1,'PI must reuse captured lease');
 assert.equal(f.counters.provider,0);assert.equal(f.counters.clinicalWrites,0);
 const status=await flow.ordinaryFunctionCommand(session,'status',{},new AbortController().signal);assert.equal((await status.json()).phase,'closed');
});
test('native selection owner failure stays a closed context denial, never an upstream failure',async()=>{
 const settings=parseOrdinaryStoredSettings();f.setSetting('ai.fabric.chatgptOrdinary',JSON.stringify({...settings,enabled:true}));
 f.rows.patientsToAmbulatories=[];
 await assert.rejects(prepareNativeOrdinary(new Request('http://localhost/api/v1/network/ai/chatgpt/ordinary/prepare'),f.issue(),f.preparation('patient_insight')),
  error=>error?.code==='revoked');
 assert.equal(f.counters.provider,0);assert.equal(f.counters.clinicalWrites,0);
});
test('original flow rechecks a genuine host capture after awaited original handler before publishing',async()=>{
 f.setSetting('ai.fabric.chatgptOrdinary',JSON.stringify({...parseOrdinaryStoredSettings(),enabled:true}));
 const c=acquire('patient_insight');
 await assert.rejects(flow.beginOrdinaryFunction(new Request('http://localhost/synthetic'), 'patient_insight', c.session, async()=>{
  flow.bindNativeOrdinaryHostSources(c.capture);
  await Promise.resolve();f.rows.entries[0].content='Cambiato dopo acquisizione';
  return Response.json({proposal:'SYNTHETIC_NOT_A_PROVIDER_OUTPUT'});
 }),{code:'revoked'});
 assert.equal(source.nativeOrdinaryHostSourcesAreCurrent(c.capture),false);assert.equal(f.counters.provider,0);
});
test('native attempt veto is checked before any preparation/platform/transport and when state is read',async()=>{
 const c=acquire('patient_insight');const {createOrdinaryProductAttempt}=require('../chatgpt-execution/ordinary-product-attempt.ts');
 let touches=0;const platform={snapshot(){touches++;throw Error('NO_QUALIFICATION')},async create(){touches++;throw Error('NO_PLATFORM')},async close(){}};
 const attempt=await createOrdinaryProductAttempt(c.session,platform,()=>source.nativeOrdinaryHostSourcesAreCurrent(c.capture));
 assert.equal(attempt.snapshot().state,'empty');f.rows.entries[0].version++;
 assert.throws(()=>attempt.snapshot(),{code:'revoked'});assert.equal(touches,0);await attempt.dispose();
 await assert.rejects(createOrdinaryProductAttempt(c.session,platform,()=>false));assert.equal(touches,0);
});
