/** Synthetic CLI measurement bank. No UI or clinical qualification. Run only with an explicit isolated archive and evidence directory. */
import {fileURLToPath} from 'node:url';import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import{execFile}from'node:child_process';import{promisify}from'node:util';const execFileAsync=promisify(execFile);
import{generateMasterKey,wrapMasterKeyVersioned}from'../lib/security/security.ts';
import{db}from'../lib/db.ts';
import{AttachmentCollectionView}from'../lib/attachment-collection-client.ts';
import{createModelPreviewClient}from'../lib/function-models/preview-client.ts';
import{buildPatientInsightPreviewRequest}from'../lib/ai-providers/fabric/patient-insight-preview-contract.ts';
import{buildPatientSmartImportProjectionCaptureInput}from'../lib/domain/documents/patient-smart-import-projection-capture.ts';
import{createSmartImportReviewBrowserController}from'../lib/security/smart-import-review-browser-controller.ts';
import{createDocumentSynthesisReviewBrowserController}from'../lib/ai-providers/fabric/document-synthesis-review-browser-controller.ts';
const E=process.env.MEDIFLOW_MEASUREMENT_EVIDENCE,base=process.env.I2_BASE_URL,model='qwen3.5:35b-a3b';if(!E||!path.isAbsolute(E)||!process.env.MEDIFLOW_DATA_DIR?.startsWith(E+'/synthetic-')||!base||new URL(base).hostname!=='127.0.0.1'||['','3000','11434'].includes(new URL(base).port))throw new Error('explicit_isolated_synthetic_paths_required');
if(!path.relative(path.resolve(fileURLToPath(new URL('..',import.meta.url))),E).startsWith('..'+path.sep))throw new Error('evidence_outside_repository_required');
const nativeFetch=globalThis.fetch,cookies=new Map();let archiveGeneration,etag,currentCase='preparation',aborter=null,picker=null,controller=null,previewStarted=null;
const raw=fs.openSync(E+'/i2-http.jsonl','wx');
const save=(name,value)=>fs.writeFileSync(E+'/'+name+'.json',JSON.stringify(value,null,2)+'\n');
const request=async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input.toString(),base);if(url.origin!==base)throw new Error('external_request_denied');
 const headers=new Headers(init.headers);headers.set('Cookie',[...cookies].map(([k,v])=>k+'='+v).join('; '));headers.set('Origin',base);headers.set('Referer',base+'/');headers.set('Sec-Fetch-Site','same-origin');if(archiveGeneration)headers.set('x-mediflow-archive-generation',archiveGeneration);
 const signal=init.signal&&aborter?AbortSignal.any([init.signal,aborter.signal]):init.signal??aborter?.signal;
 if(url.pathname.endsWith('/preview')&&url.pathname.startsWith('/api/ai/')){previewStarted=Date.now();save('pending-preview',{currentCase,at:new Date().toISOString(),path:url.pathname});}
 let response;try{response=await nativeFetch(url,{...init,headers,signal})}catch(e){save('i2-transport-failure',{path:url.pathname,error:String(e),cause:e.cause?String(e.cause):null,code:e.cause?.code??null});throw e}
 for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0];const i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}
 if(response.headers.has('etag')&&url.pathname.startsWith('/api/auth/'))etag=response.headers.get('etag');
 let body;try{body=await response.clone().json()}catch{body='non_json'}
 fs.writeSync(raw,JSON.stringify({currentCase,path:url.pathname,method:init.method??'GET',status:response.status,body})+'\n');
 return response;
};
globalThis.fetch=request;
async function json(url,body,headers={}){const r=await request(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(url+': '+r.status+' '+JSON.stringify(data));return data;}
const probe=await new Promise(resolve=>{const s=net.connect(9,'192.0.2.1');const t=setTimeout(()=>{s.destroy();resolve('timeout')},2000);s.on('error',e=>{clearTimeout(t);resolve(e.code)})});save('i2-client-network-probe',{probe});if(probe!=='EPERM')throw new Error('network_not_denied');
try{
 await request('/api/auth/check');const key=await generateMasterKey(),salt=crypto.getRandomValues(new Uint8Array(16));
 const setup=await json('/api/auth/setup',{username:'admin',password:'1234',displayName:'Operatore Sintetico',ambulatoryName:'Ambulatorio Sintetico',salt:Buffer.from(salt).toString('base64'),encryptedMasterKey:await wrapMasterKeyVersioned(key,'1234',salt)},{'If-Match':etag,'Idempotency-Key':crypto.randomUUID()});archiveGeneration=setup.archiveGeneration;db.setKey(key);
 for(const[key,value]of Object.entries({aiProvider:'ollama',aiModel:model,aiModel_clinical:model,aiModel_reasoning:model,aiUrl:'http://127.0.0.1:11434',ollamaUrl:'http://127.0.0.1:11434',aiPatientInsightKillSwitch:'enabled',aiSmartImportKillSwitch:'enabled',aiDocumentSynthesisKillSwitch:'enabled'}))await json('/api/settings',{key,value});
 const admission=await execFileAsync(process.execPath,['scripts/run-strip-types.mjs','scripts/setup-local-provider.mjs','admit','--data-dir',process.env.MEDIFLOW_DATA_DIR,'--confirm-local-change'],{cwd:process.cwd(),env:process.env,encoding:'utf8'}).then(r=>r.stdout);save('i2-onboarding',{output:admission});
 const ambs=await(await request('/api/ambulatories')).json(),ambulatoryId=ambs[0].id;
 const source='Documento interamente sintetico. Cefalea lieve riferita. Ibuprofene sospeso il 12 ottobre 2026. Nessuna terapia attiva. Rivalutazione clinica da concordare.';
 const patientId=await db.patients.add({id:crypto.randomUUID(),firstName:'Persona',lastName:'Inventata',taxCode:'',notes:source,ambulatoryId,createdAt:new Date(),updatedAt:new Date(),version:1});
 for(let i=0;i<12;i++)await db.entries.add({id:crypto.randomUUID(),patientId,type:'note',title:'Controllo sintetico '+(i+1),date:new Date('2026-11-'+String(i+1).padStart(2,'0')+'T09:00:00Z'),content:'Evento inventato '+(i+1)+'. Cefalea lieve riferita, intensita '+(i%3+1)+'/10. Terapia sintomatica sospesa. Rivalutazione del follow-up clinico da concordare. Non risultano segni neurologici focali. Confermare la situazione con il medico.',createdAt:new Date(),updatedAt:new Date()});
 const collection=AttachmentCollectionView.capture(patientId,await db.attachments.query({patientId}).toArray());
 const bytes=fs.readFileSync(E+'/synthetic-fixture.pdf');
 const attachmentId=await db.attachments.add({id:crypto.randomUUID(),patientId,name:'fonte-sintetica.pdf',type:'application/pdf',size:bytes.length,data:'data:application/pdf;base64,'+bytes.toString('base64'),createdAt:new Date()},{attachmentCollection:collection});
 const outcomes=[];
 for(const functionId of ['patient_insight','smart_import']){
  for(const scenario of ['cancel','revoke']){
   currentCase=functionId+'/'+scenario;save('i2-current-case',{currentCase,at:new Date().toISOString()});aborter=new AbortController();previewStarted=null;
   picker=createModelPreviewClient(functionId,request);picker.reset(true);await picker.read();picker.choose('');
   const patient=await db.patients.get(patientId),entries=await db.entries.query({patientId}).toArray(),therapies=await db.therapies.query({patientId}).toArray();
   const start=performance.now(),beganAt=new Date().toISOString();let result,error=null,intervention=null;
   try{
    if(scenario==='error'){
     await picker.begin();const r=await picker.fetch('/api/ai/'+functionId.replaceAll('_','-')+'/preview',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});result={status:r.status,body:await r.json()};if(r.ok)throw new Error('invalid_request_accepted');
    }else{
     await picker.begin();let work;
     if(functionId==='patient_insight')work=picker.fetch('/api/ai/patient-insight/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(buildPatientInsightPreviewRequest({patient,entries,therapies,requestId:'pi_'+crypto.randomUUID(),capturedAt:new Date().toISOString()}))}).then(async r=>({httpStatus:r.status,body:await r.json()}));
     else if(functionId==='smart_import'){
      controller=createSmartImportReviewBrowserController({fetch:picker.fetch});const proposal=await controller.readProposal(patientId);work=controller.run({patientId,proposal,ambulatory:proposal.ambulatories[0],captureInput:buildPatientSmartImportProjectionCaptureInput(patient,entries,[],therapies)},true);
     }else{
      controller=createDocumentSynthesisReviewBrowserController({fetch:picker.fetch,readAttachment:async id=>await db.attachments.get(id)});const proposal=await controller.readProposal(patientId);work=controller.run({patientId,attachmentId,proposal,ambulatory:proposal.ambulatories[0]},true);
     }
     let finished=false;work.finally(()=>{finished=true}).catch(()=>{});
     if(scenario==='cancel'||scenario==='revoke'){
      while(!previewStarted&&!finished)await new Promise(r=>setTimeout(r,50));
      if(!finished){await new Promise(r=>setTimeout(r,1500));
       if(finished){intervention={kind:'not_performed',reason:'inference_already_finished'};}else if(scenario==='cancel'){intervention={at:new Date().toISOString(),kind:'abort_transport',previewStarted,inFlightBeforeIntervention:!finished};picker.reset(false);controller?.reset();aborter.abort();}
       else{intervention={at:new Date().toISOString(),kind:'authenticated_application_lock',previewStarted,inFlightBeforeIntervention:!finished};await request('/api/auth/check');const response=await json('/api/auth/lock',{}, {'If-Match':etag,'Idempotency-Key':crypto.randomUUID()});intervention.response=response;}
      }
     }
     result=await work;
    }
   }catch(e){error={name:e.name,code:e.code??null,message:e.message}}
   finally{picker.reset(false);controller?.reset();controller=null;aborter=null;}
   const out={functionId,scenario,beganAt,endedAt:new Date().toISOString(),elapsedMs:performance.now()-start,result,error,intervention};outcomes.push(out);save('i2-outcomes',outcomes);
   await new Promise(r=>setTimeout(r,1500));
   if(scenario==='revoke'){await request('/api/auth/check');const login=await json('/api/auth/login',{username:'admin',password:'1234'},{'If-Match':etag,'Idempotency-Key':crypto.randomUUID()});archiveGeneration=login.archiveGeneration;}
  }
 }
}catch(e){save('i2-bank-failure',{name:e.name,message:e.message,stack:e.stack});process.exitCode=1}
finally{db.setKey(null);globalThis.fetch=nativeFetch;fs.closeSync(raw)}
