/* @Codex — real HTTP/paired-session wrapper/composition/grant/parser, synthetic issuer+attempt seam. */
'use strict';const {test}=require('node:test'),assert=require('node:assert/strict');const {fixture}=require('./fixtures/native-client-decrypt-host.cjs');
const namespace='http://127.0.0.1/api/v1/network/ai/chatgpt/ordinary/';
const pairing={'x-mediflow-paired-client-id':'synthetic-client','x-mediflow-paired-client-token':'synthetic-token'};
function setup(t,options={}){const f=fixture({attemptSeam:true,...options});t.after(()=>{f.zero();f.dispose();});const session=f.issue(),handler=f.load('lib/chatgpt-product/native-ordinary-http.ts').handleNativeOrdinaryHttp;
 const request=(operation,body,headers={},method='POST')=>f.http(handler,new Request(namespace+operation,{method,headers:{...pairing,'content-type':'application/json',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),session,operation);
 return{f,session,handler,request};}
for(const fn of ['patient_insight','smart_import','treatment_reasoning'])test(`HTTP ${fn}: disturbed prepare body -> selector plan -> real parser -> attempt seam`,async t=>{
 const {f,request}=setup(t);const prepared=await request('prepare',f.preparation(fn));assert.equal(prepared.status,202);const plan=(await prepared.json()).sourceProjection;assert.equal(f.counters.admission,0);
 const result=await request('project',f.body(plan),{'X-MediFlow-Ordinary-Projection':plan.grantId});assert.equal(result.status,200);assert.equal(f.counters.admission,1);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(result.headers.get('referrer-policy'),'no-referrer');
 const value=await result.json();assert.deepEqual(value.acquisition,{origin:'authenticated_client_decryption',ciphertextEquality:'not_attested'});
 const replay=await request('project',f.body(plan),{'X-MediFlow-Ordinary-Projection':plan.grantId});assert.equal(replay.status,409);assert.equal(f.counters.admission,1);
});
for(const kind of ['extra-prepare-text','wrong-pairing','missing-field','duplicate-JSON','wrong-MIME','stale-ciphertext','logout','wrong-function','extra-metadata'])test(`HTTP rejection ${kind}: zero attempt/provider/writes`,async t=>{
 const {f,request,session}=setup(t);let p=f.preparation();if(kind==='extra-prepare-text')p.text='caller';
 const prepared=await request('prepare',p,kind==='wrong-pairing'?{'x-mediflow-paired-client-token':'wrong'}:{});
 if(kind==='extra-prepare-text'||kind==='wrong-pairing'){assert.ok(!prepared.ok);assert.equal(f.counters.admission,0);return;}
 assert.equal(prepared.status,202);const plan=(await prepared.json()).sourceProjection;let body=f.body(plan);let headers={'X-MediFlow-Ordinary-Projection':plan.grantId};
 if(kind==='missing-field')body.rows[0].fields=[];if(kind==='duplicate-JSON')body=JSON.stringify(body).replace('"rows":','"rows":[],"rows":');
 if(kind==='wrong-MIME')headers['content-type']='text/plain';if(kind==='stale-ciphertext')f.rows.patients[0].notes+='changed';if(kind==='logout')f.revoke(session);
 if(kind==='wrong-function')body.functionId='smart_import';if(kind==='extra-metadata')body.sourceRevision='invented';
 assert.ok(!(await request('project',body,headers)).ok);assert.equal(f.counters.admission,0);
});
for(const confirmed of [true,false])test(`DELETE preserves truthful cleanupConfirmed=${confirmed}`,async t=>{
 const {f,request}=setup(t,{cleanupConfirmed:confirmed});const prepared=await request('prepare',f.preparation());const plan=(await prepared.json()).sourceProjection;
 const result=await request('project',undefined,{'X-MediFlow-Ordinary-Projection':plan.grantId},'DELETE');assert.equal(result.status,200);assert.equal((await result.json()).cleanupConfirmed,confirmed);
 assert.ok(!(await request('project',f.body(plan),{'X-MediFlow-Ordinary-Projection':plan.grantId})).ok);assert.equal(f.counters.admission,0);
});
test('invalid grant is resolved before touching project stream',async t=>{
 const {f,handler,session}=setup(t);let pulls=0;
 const stream=new ReadableStream({pull(){pulls++;}},{highWaterMark:0});
 const r=new Request(namespace+'project',{method:'POST',headers:{...pairing,'content-type':'application/json','X-MediFlow-Ordinary-Projection':'a'.repeat(64)},duplex:'half',body:stream});
 assert.equal((await f.http(handler,r,session)).status,409);assert.equal(pulls,0);assert.equal(f.counters.admission,0);
});
