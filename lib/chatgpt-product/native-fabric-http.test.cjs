/* Genuine native sessions, source capture, owners, dispatch and parsers.
 * Synthetic rows, local readiness/transport and plain-text AnyDoc extraction only.
 * No network, model process, installed artifact or clinical writer. */
const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const f=require('../security/native-ordinary-host.test-support.cjs');
const pairing=require('../network-pairing-model.ts');
const model=require('../ai-providers/fabric/function-model-preferences.ts');
let sources,activeFunction,providerHook=null,providerCalls=0;
const lifecycle=provider=>({status:'available',record:{schemaVersion:'mediflow.ai.provider-lifecycle-record.v1',
 lifecycle:{schemaVersion:'mediflow.ai.provider-lifecycle.v1',provider,credentialClass:'local_model',status:'available_unqualified'},
 actorClass:'host_service',actorRef:'actor_'+'a'.repeat(32),version:1,hostTimestamp:new Date().toISOString(),receiptRef:'receipt_'+'b'.repeat(32)}});
f.replace('lib/ai-providers/fabric/function-model-preferences-production.ts',{readProductionFunctionModelSources:()=>sources});
f.replace('lib/ai-providers/fabric/provider-lifecycle-service.ts',{createHostProviderLifecycleService:(options={})=>({service:{read:()=>lifecycle(options.provider??'ollama')}})});
f.replace('lib/ai-providers/host-local-provider-readiness.ts',{observeClinical:async()=>({status:'available',code:null,observation:{venue:'local_process',state:'available',reason:null}})});
const select=f.db.dbServer.select;
f.db.dbServer.select=(...args)=>{const q=select(...args);q.then=(resolve,reject)=>Promise.resolve(q.all()).then(resolve,reject);return q};
const locality=require('../ai-providers/ollama-locality.ts');
f.replace('lib/ai-providers/ollama-locality.ts',{...locality,attestLocalOllamaModel:async(_endpoint,requestedModel)=>({authorityPlane:'clinical_application',provider:'ollama',executionMode:'local',endpointClass:'loopback',requestedModel,canonicalModel:requestedModel,digest:'sha256:synthetic',serverVersion:'0.32.5',checkedAt:new Date().toISOString()})});
f.replace('lib/domain/documents/anydoc-local-extraction-runner.ts',{async extractAnyDocLocalBytes(id,raw){
 const bytes=Buffer.from(raw);return require('../domain/documents/anydoc-local-extraction-contract.ts').buildAnyDocLocalExtraction({attachmentId:id,sourceSha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length},bytes.toString());
}});
function output(fn){
 if(fn==='treatment_reasoning')return {
    schemaVersion: 'mediflow.treatment_reasoning.v1',
    task: 'treatment_reasoning',
    summary: 'Sintesi sintetica da revisionare.',
    data: {
        recommendation: 'Rivedere le fonti sintetiche prima di ogni decisione.',
        keyEvidence: [{ id: 'evidence.synthetic.finding', statement: 'Evidenza sintetica circoscritta.', evidenceRefs: ['source_'+createHash('sha256').update('therapy\0synthetic-therapy-1').digest('hex').slice(0,40)] }],
        reasoning: ['Le fonti richiedono revisione clinica.'],
        caveats: ['Fixture sintetica, non prescrittiva.'],
        safetyFlags: [{ id: 'safety.synthetic.flag', severity: 'caution', label: 'Revisione richiesta', rationale: 'Il risultato resta review-only.', evidenceRefs: ['source_'+createHash('sha256').update('clinical-entry\0synthetic-entry-1').digest('hex').slice(0,40)] }],
        suggestedActions: [{ id: 'action.synthetic.review', intent: 'review_only', label: 'Rivedi evidenze', rationale: 'Nessuna scrittura clinica consentita.', writePolicy: 'review_only', evidenceRefs: ['source_'+createHash('sha256').update('therapy\0synthetic-therapy-1').digest('hex').slice(0,40)] }],
        trace: { mode: 'local_model', toolsUsed: ['tool.synthetic.local'], limitations: ['Nessun lookup esterno.'] },
    },
    sourceBindings: [
        { claimPath: 'summary', claim: 'Sintesi sintetica da revisionare.', evidenceRefs: ['source_'+createHash('sha256').update('therapy\0synthetic-therapy-1').digest('hex').slice(0,40)] },
        { claimPath: 'data.recommendation', claim: 'Rivedere le fonti sintetiche prima di ogni decisione.', evidenceRefs: ['source_'+createHash('sha256').update('therapy\0synthetic-therapy-1').digest('hex').slice(0,40)] },
        { claimPath: 'data.reasoning.0', claim: 'Le fonti richiedono revisione clinica.', evidenceRefs: ['source_'+createHash('sha256').update('therapy\0synthetic-therapy-1').digest('hex').slice(0,40)] },
        { claimPath: 'data.caveats.0', claim: 'Fixture sintetica, non prescrittiva.', evidenceRefs: ['source_'+createHash('sha256').update('clinical-entry\0synthetic-entry-1').digest('hex').slice(0,40)] },
    ],
};
 if(fn==='document_synthesis')return {schemaVersion:'mediflow.document-synthesis.provider-envelope.v2',output:{schemaVersion:'mediflow.ai.extract.v1',task:fn,summary:'Sintesi sintetica',data:{qualityLevel:'green',medications:[],diagnoses:[],problemStatements:[],therapyCandidates:[],servicePrescriptions:[]}},citations:[{label:'S1',quote:'Testo documento esclusivamente sintetico host.'}],claims:[{claimPath:'summary',labels:['S1']},{claimPath:'data.qualityLevel',labels:['S1']}]};
 return {schemaVersion:'mediflow.ai.extract.v1',task:fn,summary:'Sintesi sintetica [S1]',data:fn==='patient_insight'?{currentState:['Stato sintetico [S1]'],alerts:[],nextSteps:[],gaps:[]}:{diagnoses:[],therapies:[],servicePrescriptions:[]}};
}
require('../ai-providers/ollama.ts').OllamaProviderAdapter.prototype.chat=async()=>{providerCalls++;await providerHook?.();return {content:JSON.stringify(output(activeFunction)),stats:{latency:1,tokensIn:1,tokensOut:1}}};
f.replace('lib/athena-mlx-runtime.ts',{generateWithAthenaMlx:async()=>{providerCalls++;await providerHook?.();return {content:JSON.stringify(output('treatment_reasoning'))}},isAthenaMlxModelAvailable:()=>true});
globalThis.fetch=async()=>{throw Error('NO_NETWORK_IN_SYNTHETIC_TEST')};
const native=require('../security/native-inference-lifecycle.ts');
const {handleNativeFabricHttp:handle}=require('./native-fabric-http.ts');
const {handleNativeOrdinaryHttp:ordinary}=require('./native-ordinary-http.ts');
const {nativeSessionProjectionOwnerRegistry:registry}=require('../security/native-session-projection-owner-production.ts');
const {requirePairedNativeSession}=require('../security/paired-native-session.ts');
const token='synthetic-paired-token-'.repeat(3),tokenHash=pairing.hashNetworkPairedClientToken(token);
let session,headers;
beforeEach(()=>{
 f.reset();providerCalls=0;providerHook=null;
 sources={settings:{aiProvider:'ollama',aiUrl:'http://127.0.0.1:11434',aiModel_clinical:'synthetic-clinical:1',aiModel_reasoning:'synthetic-reasoning:1',...Object.fromEntries(Object.values(model.FUNCTION_SWITCH_KEYS).map(k=>[k,'enabled']))},ollamaLifecycle:lifecycle('ollama'),athenaLifecycle:lifecycle('athena_mlx'),athenaIdentity:'synthetic-artifact-v1',athenaAvailable:true};
 for(const [k,v]of Object.entries(sources.settings))f.setSetting(k,v);
 f.pair({tokenHash,clientPlatform:'ios'});session=f.issue({},{tokenHash,clientPlatform:'ios'});f.setSessionCookie(session.id);
 headers={'Content-Type':'application/json',[pairing.NETWORK_PAIRED_CLIENT_ID_HEADER]:f.binding.clientId,[pairing.NETWORK_PAIRED_CLIENT_TOKEN_HEADER]:token};
});
afterEach(()=>{require('@mediflow/web-auth-lifecycle-owner').serverSessions.deleteSession(session.id)});
function req(op,body,extra={},signal){return new Request('http://localhost/api/v1/network/ai/fabric/'+op,{method:op==='status'?'GET':'POST',headers:{...headers,...extra},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)}),signal})}
async function call(op,body,extra={},signal){return handle(req(op,body,extra,signal),op)}
async function ready(fn='patient_insight'){
 activeFunction=fn;const request=req('prepare',f.preparation(fn));assert.equal(await requirePairedNativeSession(request),session);
 const r=await handle(request,'prepare'),value=await r.json();assert.equal(r.status,200,JSON.stringify(value));assert.equal(value.phase,'ready');assert.equal(providerCalls,0);return value;
}
for(const fn of model.FUNCTION_MODEL_IDS)test(fn+': real native capture -> owner -> fixed dispatch -> synthetic transport -> original proposal; no write',async()=>{
 const prepared=await ready(fn);const response=await call('generate',{attemptId:prepared.attemptId});const value=await response.json();
 assert.equal(response.status,200,JSON.stringify(value));assert.equal(value.phase,'completed',JSON.stringify(value));
 assert.equal(providerCalls,1);assert.equal(value.selection.modelOptionId,prepared.selection.modelOptionId);assert.equal(value.selection.venue,'local');
 const root=value.result,proposal=['patient_insight','smart_import'].includes(fn)?root.preview:fn==='document_synthesis'?root.publication:root;
 assert.equal(proposal.status??root.status,'available');if(process.env.MEDIFLOW_FABRIC_CONTRACT_OUTPUT)require('node:fs').writeFileSync(require('node:path').join(process.env.MEDIFLOW_FABRIC_CONTRACT_OUTPUT,fn+'.json'),JSON.stringify(value));
 assert.equal(value.clinicalWrites,0);assert.equal(value.apply,'denied');assert.equal(f.counters.clinicalWrites,0);
 assert.doesNotMatch(JSON.stringify(value.selection),/endpoint|127\.0\.0\.1|token|prompt/);
 assert.equal((await call('generate',{attemptId:prepared.attemptId})).status,409,'one-shot');
 const status=await call('status',undefined,{'X-MediFlow-Fabric-Attempt':prepared.attemptId});assert.equal((await status.json()).phase,'current');
 assert.equal((await(await call('cancel',{attemptId:prepared.attemptId})).json()).cleanupConfirmed,true);
 assert.equal((await call('status',undefined,{'X-MediFlow-Fabric-Attempt':prepared.attemptId})).status,409);
});
for(const key of ['provider','model','endpoint','prompt','venue','apply','modelOptionId','sources'])test('rejects arbitrary '+key+' before source acquisition or transport',async()=>{
 const response=await call('prepare',{...f.preparation(),[key]:'forged'});assert.equal(response.status,400);assert.equal(f.counters.acquisition,0);assert.equal(providerCalls,0);
});
test('strict body/query/header, session and capability denial precede capture',async()=>{
 for(const request of [req('prepare',' '.repeat(4097)+JSON.stringify(f.preparation())),req('prepare',JSON.stringify(f.preparation()).replace('"patientId":','"patientId":"other","patientId":')),req('prepare',f.preparation(),{'x-mediflow-function-model':'{}'}),new Request(req('prepare',f.preparation()).url+'?provider=ollama',{method:'POST',headers,body:JSON.stringify(f.preparation())})])assert.equal((await handle(request,'prepare')).status,400);
 f.pair({tokenHash,clientPlatform:'ios',grantedCapabilities:[]});assert.equal((await call('prepare',f.preparation())).status,401);assert.equal(f.counters.acquisition,0);
});
for(const fn of model.FUNCTION_MODEL_IDS)test(fn+': disabled/unavailable fail closed before capture',async()=>{
 sources.settings[model.FUNCTION_SWITCH_KEYS[fn]]='disabled';assert.equal((await call('prepare',f.preparation(fn))).status,403);
 sources.settings[model.FUNCTION_SWITCH_KEYS[fn]]='enabled';sources.ollamaLifecycle={status:'denied',reason:'missing'};sources.athenaAvailable=false;
 assert.equal((await call('prepare',f.preparation(fn))).status,503);assert.equal(providerCalls,0);assert.equal(f.counters.acquisition,0);
});
for(const fn of model.FUNCTION_MODEL_IDS)for(const change of ['model','disable','source','version','membership','session','cancel','abort'])test(fn+'/'+change+': change during synthetic provider await never publishes; no fallback',async()=>{
 const prepared=await ready(fn);const abort=new AbortController();
 providerHook=async()=>{
  if(change==='model'){sources.settings.aiModel_clinical='synthetic-new:1';sources.athenaIdentity='synthetic-new-artifact';}
  if(change==='disable')sources.settings[model.FUNCTION_SWITCH_KEYS[fn]]='disabled';
  if(change==='source'){f.rows.entries[0].content='Fonte sintetica modificata';f.rows.attachments[0].documentFreshnessEpoch++;}
  if(change==='version')f.rows.patients[0].version++;
  if(change==='membership')f.rows.patientsToAmbulatories=[];
  if(change==='session')require('@mediflow/web-auth-lifecycle-owner').serverSessions.deleteSession(session.id);
  if(change==='cancel')assert.equal((await call('cancel',{attemptId:prepared.attemptId})).status,200);
  if(change==='abort')abort.abort();
 };
 const response=await call('generate',{attemptId:prepared.attemptId},{},abort.signal);const result=await response.json();
 assert.notEqual(result.phase,'completed');assert.equal(providerCalls,1);assert.equal(f.counters.clinicalWrites,0);
});
test('config/source changes after publication revoke status and cannot resurrect A-B-A',async()=>{
 const p=await ready();assert.equal((await call('generate',{attemptId:p.attemptId})).status,200);
 const original=sources.settings.aiModel_clinical;sources.settings.aiModel_clinical='new-synthetic-model';
 assert.equal((await call('status',undefined,{'X-MediFlow-Fabric-Attempt':p.attemptId})).status,409);
 sources.settings.aiModel_clinical=original;assert.equal((await call('status',undefined,{'X-MediFlow-Fabric-Attempt':p.attemptId})).status,409);
});
test('selection changes terminally even A-B-A; another session cannot use/cancel handle',async()=>{
 const p=await ready();const other=f.issue({},{tokenHash,clientPlatform:'ios'});f.setSessionCookie(other.id);
 assert.equal((await call('generate',{attemptId:p.attemptId})).status,409);assert.equal((await call('cancel',{attemptId:p.attemptId})).status,409);
 f.setSessionCookie(session.id);registry.acquire(session).issueSelection({expectedEpoch:registry.acquire(session).snapshotSelectionEpoch(session),patientId:'synthetic-patient',ambulatoryId:'synthetic-ambulatory'});assert.equal((await call('generate',{attemptId:p.attemptId})).status,409);assert.equal(providerCalls,0);
});
test('ENC projection remains one-shot, lane-bound and ready without provider execution',async()=>{
 f.rows.patients[0].notes='ENC:synthetic-ciphertext';
 let response=await call('prepare',f.preparation());const plan=(await response.json()).sourceProjection;assert.equal(response.status,202);assert.ok(plan);
 const projection={schemaVersion:'mediflow.native-ordinary.source-projection.v1',functionId:'patient_insight',rows:[{entity:'patient',id:'synthetic-patient',fields:[{name:'notes',value:'Nota sintetica decifrata'}]}]};
 const project=req('project',projection,{'X-MediFlow-Ordinary-Projection':plan.grantId});response=await handle(project,'project');
 const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));assert.equal(value.phase,'ready');assert.equal(providerCalls,0);
 assert.equal((await call('project',projection,{'X-MediFlow-Ordinary-Projection':plan.grantId})).status,409);
 await call('cancel',{attemptId:value.attemptId});
 response=await call('prepare',f.preparation());const second=(await response.json()).sourceProjection;
 const ordinaryProject=new Request('http://localhost/api/v1/network/ai/chatgpt/ordinary/project',{method:'POST',headers:{...headers,'X-MediFlow-Ordinary-Projection':second.grantId},body:JSON.stringify(projection)});
 assert.equal((await ordinary(ordinaryProject,'project')).status,409);assert.equal(providerCalls,0);
});

test('unreachable synthetic local runtime produces no completed proposal or alternative',async()=>{
 const p=await ready();providerHook=async()=>{throw Error('SYNTHETIC_LOCAL_UNREACHABLE')};
 const r=await call('generate',{attemptId:p.attemptId});assert.equal(r.status,503);assert.notEqual((await r.json()).phase,'completed');assert.equal(providerCalls,1);
 assert.equal((await(await call('cancel',{attemptId:p.attemptId})).json()).cleanupConfirmed,true);
});
test('configuration changed between prepare and generate denies before transport',async()=>{
 const p=await ready();sources.settings.aiModel_clinical='changed-synthetic:1';
 assert.equal((await call('generate',{attemptId:p.attemptId})).status,409);assert.equal(providerCalls,0);
});
test('projection config change or extra plaintext row is terminal before provider',async()=>{
 for(const mode of ['config','row']){
  f.rows.patients[0].notes='ENC:synthetic';const r=await call('prepare',f.preparation());const plan=(await r.json()).sourceProjection;assert.ok(plan);
  if(mode==='config')sources.settings.aiModel_clinical='synthetic-new:1';
  const projection={schemaVersion:'mediflow.native-ordinary.source-projection.v1',functionId:'patient_insight',rows:[{entity:'patient',id:'synthetic-patient',fields:[{name:'notes',value:'Nota sintetica'}]},...(mode==='row'?[{entity:'patient',id:'other-patient',fields:[{name:'notes',value:'forged'}]}]:[])]};
  const response=await call('project',projection,{'X-MediFlow-Ordinary-Projection':plan.grantId});assert.ok(response.status>=400);assert.equal(providerCalls,0);
 }
});

test('P2 lost ENC prepare response: no-ID closure revokes the still-consumable grant',async()=>{
 f.rows.patients[0].notes='ENC:synthetic';
 const prepared=await call('prepare',f.preparation());const lost=await prepared.json();assert.equal(prepared.status,202);
 const closed=await call('status');const status=await closed.json();
 assert.equal(status.phase,'closed');assert.equal(status.cleanupConfirmed,true);
 const projection={schemaVersion:'mediflow.native-ordinary.source-projection.v1',functionId:'patient_insight',rows:[{entity:'patient',id:'synthetic-patient',fields:[{name:'notes',value:'Nota sintetica'}]}]};
 const consumed=await call('project',projection,{'X-MediFlow-Ordinary-Projection':lost.sourceProjection.grantId});
 assert.equal(consumed.status,409,'cleanupConfirmed must leave no consumable grant');assert.equal(providerCalls,0);
});

test('P2 pending grants: closure is session- and lane-scoped; explicit revocation leaves no authority',async()=>{
 const projection={schemaVersion:'mediflow.native-ordinary.source-projection.v1',functionId:'patient_insight',rows:[{entity:'patient',id:'synthetic-patient',fields:[{name:'notes',value:'Nota sintetica'}]}]};
 f.rows.patients[0].notes='ENC:synthetic';
 const local=await(await call('prepare',f.preparation())).json();
 const other=f.issue({},{tokenHash,clientPlatform:'ios'});f.setSessionCookie(other.id);
 assert.equal((await(await call('status')).json()).cleanupConfirmed,true);
 f.setSessionCookie(session.id);
 assert.equal((await call('project',projection,{'X-MediFlow-Ordinary-Projection':local.sourceProjection.grantId})).status,200,'another session cannot revoke this grant');
 const current=await(await call('status')).json();assert.equal(current.phase,'busy');assert.equal(current.cleanupConfirmed,false);
 // A fresh selection retires the previous ready operation without entering ordinary inference.
 const ordinaryRequest=new Request('http://localhost/api/v1/network/ai/chatgpt/ordinary/prepare',{method:'POST',headers,body:JSON.stringify(f.preparation())});
 const remote=await(await ordinary(ordinaryRequest,'prepare')).json();assert.equal(remote.phase,'needs_source_projection');
 assert.equal((await(await call('status')).json()).cleanupConfirmed,true);
 const source=require('../security/server-session-clinical-context-native-sources.ts');
 const capture=source.claimNativeOrdinaryProjection(session,remote.sourceProjection.grantId);assert.ok(capture,'Fabric closure must leave the ordinary lane intact');
 source.closeNativeOrdinaryHostSources(capture);
 const revoked=await(await call('prepare',f.preparation())).json();
 require('@mediflow/web-auth-lifecycle-owner').serverSessions.deleteSession(session.id);
 assert.throws(()=>source.claimNativeOrdinaryProjection(session,revoked.sourceProjection.grantId));
 assert.equal((await call('status')).status,401);assert.equal(providerCalls,0);
});
