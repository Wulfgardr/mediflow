/* @Codex — test-only JSON-lines bridge: ciphertext enters from Swift, never a key/PIN.
 * URLProtocol -> real HTTP handlers/source parser; issuer+attempt adapters are explicit.
 * This is not a socket/TLS/real-provider/AnyDoc-worker qualification.
 */
'use strict';
const {createInterface}=require('node:readline');const assert=require('node:assert/strict');const {fixture}=require('./native-client-decrypt-host.cjs');
if(Number(process.versions.node.split('.')[0])!==24){process.stderr.write('NOT_RUN: Node 24 required\n');process.exit(77);}
const f=fixture({attemptSeam:true}),session=f.issue(),handler=f.load('lib/chatgpt-product/native-ordinary-http.ts').handleNativeOrdinaryHttp;
let beforeDenied=false,reads=0,projects=0,initialized=false;
async function run(m){
 if(m.action==='init'){
   assert.deepEqual(Object.keys(m).sort(),['action','ciphertext']);assert.ok(typeof m.ciphertext==='string'&&m.ciphertext.startsWith('ENC:'));
   f.rows.patients[0].notes=m.ciphertext;const c=f.acquire('patient_insight',session);
   try{f.source.captureNativeOrdinaryHostSources(session,c.owner,c.request,c.lease);}catch{beforeDenied=true;}
   f.source.cancelNativeOrdinaryProjection(session,c.plan.grantId);initialized=true;
   return{cookie:`mediflow_session=${session.id}`,beforeDenied};
 }
 if(m.action==='stats')return{beforeDenied,reads,projects,...f.counters};
 if(m.action==='mutate'){f.rows.patients[0].notes+='tamper';return{changed:true};}
 assert.ok(initialized&&m.action==='http');const url=new URL(m.url);assert.equal(url.hostname,'localhost');
 const headers=new Headers(m.headers);assert.equal(headers.get('x-mediflow-paired-client-id'),'synthetic-client');assert.equal(headers.get('x-mediflow-paired-client-token'),'synthetic-token');
 assert.ok(headers.get('cookie').includes(session.id));
 let response;
 if(url.pathname==='/api/v1/network/patients/synthetic-patient'){
   assert.equal(m.method,'GET');assert.equal(headers.get('cache-control'),'no-store');reads++;
   response=Response.json({...f.rows.patients[0],taxCode:'SYNTHETIC',ambulatoryId:'synthetic-ambulatory'});
 }else{
   const operation=url.pathname.split('/').at(-1);assert.ok(['prepare','project'].includes(operation));if(operation==='project'&&m.method==='POST')projects++;
   const body=m.bodyBase64?Buffer.from(m.bodyBase64,'base64'):undefined;
   const req=new Request(url,{method:m.method,headers,...(body?{body}:{})});response=await f.http(handler,req,session,operation);
 }
 return{status:response.status,bodyBase64:Buffer.from(await response.arrayBuffer()).toString('base64')};
}
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});let chain=Promise.resolve();
lines.on('line',line=>{chain=chain.then(async()=>{try{assert.ok(line.length<=4*1024*1024);const result=await run(JSON.parse(line));process.stdout.write(JSON.stringify({ok:true,result})+'\n');}catch{process.stdout.write(JSON.stringify({ok:false,error:'SYNTHETIC_BRIDGE_DENIED'})+'\n');}});});
lines.on('close',()=>{void chain.finally(()=>f.dispose());});
