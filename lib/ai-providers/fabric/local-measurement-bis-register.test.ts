import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {test} from 'node:test';

const root=process.env.MEDIFLOW_WUL840_BIS_ROOT ? new URL('file://'+process.env.MEDIFLOW_WUL840_BIS_ROOT+'/') : new URL('../../../',import.meta.url);
const directory='docs/quality/intelligence/2026-11-14-ollama/';
const read=(name:string)=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const register=process.env.MEDIFLOW_WUL840_BIS_REGISTER ? JSON.parse(fs.readFileSync(process.env.MEDIFLOW_WUL840_BIS_REGISTER,'utf8')) : read('docs/quality/intelligence/registro-0.9.1.json');
const functions=['patient_insight','smart_import','document_synthesis'];
type Sample={scenario:string;mode:string;phase:string;run:number;elapsedMs:number;outcome:string;timeout:boolean;coldModelAbsent:boolean|null;warmModelDigest?:string|null;memory:{rssSamplesBytes:number[];peakRssBytes:number|null}};
type Group={scenario:string;mode:string;n:number;errors:number;timeouts:number;p50Ms:number;p95Ms:number;maxMs:number;latencyBudgetMs:number|null};

function validateRegister(value:typeof register,m:ReturnType<typeof read>){
 assert.equal(value.contractSha256,createHash('sha256').update(fs.readFileSync(new URL(value.contract,root))).digest('hex'));
 assert.equal(value.sourceRevision,m.sourceRevision);
 assert.match(value.sourceRevision,/^[a-f0-9]{40}$/);
 assert.equal(value.purpose,'coverage_only_no_runtime_admission');
 assert.equal(value.cells.length,6);
 assert.deepEqual(value.cells.map((c:{id:string})=>c.id).sort(),functions.flatMap(f=>['ollama','chatgpt'].map(p=>f+'/'+p)).sort());
 assert.equal(value.localProfile.target,'Mac17,10 Apple M5 Max 48 GB');
 assert.equal(value.localProfile.memoryBytes,48*1024**3);
 assert.equal(value.localProfile.latencyBudgetMs,null);
 assert.equal(value.localProfile.memoryBudgetBytes,null);
 assert.equal(value.localProfile.measuredBudgets.evidence,directory+'measurements.json');
 assert.deepEqual(value.localProfile.measuredBudgets.cells,m.frozenBaselines.functions);
 assert.deepEqual(value.localProfile.measuredBudgets.provisionalSingleI2,m.frozenBaselines.i2);
 for(const functionId of functions)for(const provider of ['ollama','chatgpt']){
  const cell=value.cells.find((c:{id:string})=>c.id===functionId+'/'+provider);
  assert.ok(cell?.runtimeProof,cell?.id+': runtimeProof disposition required');
  assert.equal(cell.runtimeProof.path,directory+'measurements.json');
  assert.equal(cell.runtimeProof.sourceRevision,m.sourceRevision);
  assert.equal(cell.runtimeProof.qualification,false);
  assert.ok(fs.existsSync(new URL(cell.runtimeProof.path,root)));
  assert.equal(cell.qualification,'not_qualified');
  assert.equal(cell.dataClass,'synthetic_only');
  assert.ok(cell.blockedBy.length>0);
  assert.deepEqual(cell.surfaces,{web:'not_verified',gpui:'not_verified',chat:'not_verified',headless:'not_verified'});
  if(provider==='ollama'){
   assert.equal(cell.runtimeProof.status,'executed_with_limits');
   assert.deepEqual(cell.modelIdentity,m.modelIdentity);
   assert.equal(cell.proof.path,directory+'measurements.json');
   assert.equal(cell.proof.sourceRevision,m.sourceRevision);
  }else{
   assert.equal(cell.runtimeProof.status,'not_executed_requires_I4');
   assert.equal(cell.modelIdentity,null);
   assert.equal(cell.proof,null);
   assert.ok(cell.blockedBy.includes('I-4'));
  }
 }
}

test('WUL-840 bis records an explicit runtime proof disposition for all six required cells',()=>{
 const m=read(directory+'measurements.json');
 validateRegister(register,m);
 assert.equal(m.sourceRevision,'bfddf87a5334fd7d86d7c184deac77630a332042');
 assert.equal(m.mainRevision,'4c7f140ff1becd9066ff45fabdf1862bcd14fd9c');
 assert.equal(m.buildId,'9cA97OtPjSbZv7nm6GyzX');
 assert.equal(m.modelIdentity.digest,'26025611beeb3fe9e4850b1fdae686bebba7cdfa7f13ddb04955f19872ee022a');
 assert.equal(m.modelIdentity.name,'qwen3.5:35b-a3b');
 assert.equal(m.modelIdentity.providerVersion,'0.40.16');
 assert.equal(m.admission.status,'passed');
 assert.equal(m.admission.onboarding.outcome,'admitted');
 assert.equal(m.admission.onboarding.lifecycle,'available_unqualified');
 assert.equal(m.admission.networkProbe,'EPERM');
 assert.equal(m.warmResidencies.length,11);
 assert.equal(m.warmResidencies.filter((r:{recovery:boolean})=>r.recovery).length,1);
 for(const row of m.warmResidencies){assert.equal(row.attestation.digest,m.modelIdentity.digest);assert.equal(row.residentDigest,m.modelIdentity.digest);}
 for(const mutate of [
  (r:typeof register)=>{r.contractSha256='0'.repeat(64)},
  (r:typeof register)=>{r.sourceRevision='0'.repeat(40)},
  (r:typeof register)=>{r.cells[0].runtimeProof=null},
  (r:typeof register)=>{r.cells[0].modelIdentity.digest='0'.repeat(64)},
  (r:typeof register)=>{r.cells[0].qualification='qualified'},
  (r:typeof register)=>{r.localProfile.measuredBudgets.cells.patient_insight.latencyMs=0},
  (r:typeof register)=>{r.cells.find((c:{provider:string})=>c.provider==='chatgpt').modelIdentity=m.modelIdentity},
 ]){const changed=structuredClone(register);mutate(changed);assert.throws(()=>validateRegister(changed,m));}
});

test('WUL-840 bis keeps every failed and timed out C-L result in the ranks and derives +20% without qualification',()=>{
 const m=read(directory+'measurements.json');
 assert.equal(m.qualification,false);
 assert.equal(m.methodSha256,createHash('sha256').update(fs.readFileSync(new URL(directory+'metodo-v3.md',root))).digest('hex'));
 assert.equal(m.methodSha256,'e9b4d65e6c95517620b30679478d3f4358ee9ea9edb158c31792eb1200fcb00f');
 assert.match(m.mainRevision,/^[a-f0-9]{40}$/);
 assert.ok(Date.parse(m.methodFrozenAt)<Math.min(...[...m.i2,...m.cl].map((r:{beganAt:string})=>Date.parse(r.beganAt))));
 const expected=['load-100-30-10','fragile-realistic','smart-import-load','pdf-text-10p-10MiB','pdf-scan-10p-10MiB'];
 assert.deepEqual([...new Set(m.cl.map((r:Sample)=>r.scenario))].sort(),expected.sort());
 assert.equal(m.aggregates.length,10);
 assert.equal(m.cl.filter((r:Sample)=>r.phase==='measured').length,300);
 assert.equal(m.cl.filter((r:Sample)=>r.phase==='warmup').length,5);
 const recovery=m.cl.filter((r:Sample)=>r.phase==='recovery_warmup');
 assert.equal(recovery.length,1);
 assert.ok(Date.parse(m.resumption.frozenAt)<Date.parse(recovery[0].beganAt));
 assert.equal(m.resumption.completedOutcomesRetained,true);
 assert.equal(m.resumption.interruptedAttemptHadCompletedOutcome,false);
 assert.equal(m.resumption.files['resume-method.md'],createHash('sha256').update(fs.readFileSync(new URL(directory+'resume-method.md',root))).digest('hex'));
 assert.equal(m.pdfFixtures.length,2);
 for(const fixture of m.pdfFixtures){assert.equal(fixture.pages,10);assert.equal(fixture.bytes,10*1024**2);assert.equal(fixture.sha256,m.bankSourceSha256['banco/'+fixture.name]);}
 for(const counts of Object.values(m.fixtureCountsByStage))assert.deepEqual(counts,{events:100,therapies:30,documents:10});
 for(const group of m.aggregates as Group[]){
  const rows=(m.cl as Sample[]).filter(r=>r.scenario===group.scenario&&r.mode===group.mode&&r.phase==='measured');
  const times=rows.map(r=>r.elapsedMs).sort((a,b)=>a-b);
  assert.equal(rows.length,30);assert.equal(group.n,30);assert.equal(new Set(rows.map(r=>r.run)).size,30);
  const errors=rows.filter(r=>r.outcome!=='available').length;
  assert.equal(group.errors,errors);assert.equal(group.timeouts,rows.filter(r=>r.timeout).length);
  assert.equal(group.p50Ms,times[14]);assert.equal(group.p95Ms,times[28]);assert.equal(group.maxMs,times[29]);
  assert.equal(group.latencyBudgetMs,errors?null:Math.ceil(times[28]*1.2));
  for(const row of rows){
   assert.ok(Number.isFinite(row.elapsedMs)&&row.elapsedMs>=0);
   if(group.mode==='cold')assert.equal(row.coldModelAbsent,true);
   else assert.equal(row.warmModelDigest,m.modelIdentity.digest);
   const values=row.memory.rssSamplesBytes;assert.ok(values.every(v=>Number.isSafeInteger(v)&&v>0));
   assert.equal(row.memory.peakRssBytes,values.length?Math.max(...values):null);
  }
  const peaks=rows.map(r=>r.memory.peakRssBytes);
  assert.equal((group as Group&{rssBudgetBytes:number|null}).rssBudgetBytes,errors||peaks.some(p=>p===null)?null:Math.ceil(Math.max(...peaks as number[])*1.2));
  const frozen=m.frozenBaselines.cl.find((g:Group)=>g.scenario===group.scenario&&g.mode===group.mode);
  assert.equal(frozen.latencyMs,group.latencyBudgetMs);
  assert.equal(frozen.rssBytes,(group as Group&{rssBudgetBytes:number|null}).rssBudgetBytes);
 }
});

test('WUL-840 bis derives function budgets from all required C-L groups, separately from provisional I-2',()=>{
 const m=read(directory+'measurements.json');
 const scenarios={patient_insight:['load-100-30-10','fragile-realistic'],smart_import:['smart-import-load'],document_synthesis:['pdf-text-10p-10MiB','pdf-scan-10p-10MiB']};
 for(const fid of functions){
  const names=scenarios[fid as keyof typeof scenarios];
  const groups=m.aggregates.filter((g:Group)=>names.includes(g.scenario));
  assert.equal(groups.length,names.length*2);
  const valid=groups.every((g:Group)=>g.n===30&&g.errors===0);
  const budget=m.frozenBaselines.functions[fid];
  assert.deepEqual(budget.scenarios,names);
  assert.equal(budget.latencyMs,valid?Math.ceil(Math.max(...groups.map((g:Group)=>g.p95Ms))*1.2):null);
  const rss=groups.map((g:{rssBudgetBytes:number|null})=>g.rssBudgetBytes);
  assert.equal(budget.rssBytes,valid&&rss.every((n:number|null)=>n!==null)?Math.max(...rss):null);
  assert.equal(budget.gpuMemoryIncluded,false);
  assert.equal(budget.scope,'worst_C-L_p95_cold_warm_across_declared_scenarios');
  const baseline=m.i2.find((r:{functionId:string;scenario:string})=>r.functionId===fid&&r.scenario==='complete');
  assert.ok(baseline);
  const provisional=m.frozenBaselines.i2[fid];
  assert.equal(provisional.latencyMs,baseline.outcome==='available'?Math.ceil(baseline.elapsedMs*1.2):null);
  assert.equal(provisional.rssBytes,baseline.outcome==='available'&&baseline.memory.peakRssBytes!==null?Math.ceil(baseline.memory.peakRssBytes*1.2):null);
 }
});

test('WUL-840 bis retains actual I-2 receipts and distinguishes publication denial from physical stop',()=>{
 const m=read(directory+'measurements.json');
 assert.equal(m.i2.length,12);
 assert.deepEqual(m.i2.map((r:{functionId:string;scenario:string})=>r.functionId+'/'+r.scenario).sort(),functions.flatMap(fid=>['complete','error','cancel','revoke'].map(s=>fid+'/'+s)).sort());
 for(const fid of functions){
  const row=m.i2.find((r:{functionId:string;scenario:string})=>r.functionId===fid&&r.scenario==='complete');
  assert.equal(row.outcome,'available');
  assert.equal(row.writesPerformed,0);
  assert.equal(row.apply,fid==='document_synthesis'?'none':'denied');
  assert.equal(row.receipt.capability,fid);
  const binding=row.receipt.providerBindingReceipt??row.receipt.providerReceipt??row.receipt;
  assert.equal(binding.provider,'ollama');
  assert.equal(binding.model,m.modelIdentity.name);
  assert.equal(binding.egress,'none');
  if(fid==='document_synthesis'){
   assert.equal(row.receipt.reviewOnly,true);
   assert.equal(row.receipt.applyPolicy,'none');
   assert.match(row.receipt.outputSha256,/^[a-f0-9]{64}$/);
   assert.equal(row.receipt.sourceSetDigestSha256.length,32);
   assert.equal(row.receipt.claimCitationsDigestSha256.length,32);
   assert.ok(row.citationCount>0);
  }
  const invalid=m.i2.find((r:{functionId:string;scenario:string})=>r.functionId===fid&&r.scenario==='error');
  assert.equal(invalid.outcome,'error');assert.equal(invalid.code,'input_invalid');
 }
 const proof=read(directory+'i2-interventions.json');
 assert.equal(proof.sourceRevision,m.sourceRevision);
 assert.equal(proof.observations.length,6);
 for(const row of proof.observations){
  assert.equal(row.physicalStopProved,false);
  if(row.scenario==='revoke'){
   assert.equal(row.applicationLockReceipt.state,'server_invalidation_confirmed');
   assert.deepEqual(row.publicationHttpOutcomes,[{httpStatus:401,code:'session_stale'}]);
   assert.equal(row.continuedReplyObserved,true);
   assert.ok(row.physicallyObserved.some((r:{event:string;httpStatus:number;afterInterventionMs:number})=>r.event==='end'&&r.httpStatus===200&&r.afterInterventionMs>0));
  }
 }
});

test('WUL-840 bis preserves fixed baselines when comparing independent verification samples',()=>{
 const m=read(directory+'measurements.json');
 assert.equal(m.verification.length,3);
 for(const row of m.verification){
  const budget=m.frozenBaselines.functions[row.functionId];
  assert.equal(row.withinLatencyBudget,budget.latencyMs===null?null:row.outcome==='available'&&row.elapsedMs<=budget.latencyMs);
  assert.equal(row.withinRssBudget,budget.rssBytes===null||row.memory.peakRssBytes===null?null:row.outcome==='available'&&row.memory.peakRssBytes<=budget.rssBytes);
 }
 assert.ok(Date.parse(m.frozenBaselines.frozenAt)<Math.min(...m.verification.map((r:{beganAt:string})=>Date.parse(r.beganAt))));
 assert.equal(m.clVerification.filter((r:Sample)=>r.phase==='measured').length,10);
 for(const row of m.clVerification.filter((r:Sample)=>r.phase==='measured')){
  const budget=m.frozenBaselines.cl.find((g:Group)=>g.scenario===row.scenario&&g.mode===row.mode);
  assert.equal(row.withinLatencyBudget,budget.latencyMs===null?null:row.outcome==='available'&&row.elapsedMs<=budget.latencyMs);
  assert.equal(row.withinRssBudget,budget.rssBytes===null||row.memory.peakRssBytes===null?null:row.outcome==='available'&&row.memory.peakRssBytes<=budget.rssBytes);
  assert.ok(Date.parse(m.frozenBaselines.frozenAt)<Date.parse(row.beganAt));
 }
 assert.equal(m.historicalRejections.specificRuleRecoverable,false);
 assert.equal(m.historicalRejections.measuredCount,24);
 assert.equal(m.historicalRejections.warmupCount,1);
 const historical=read(directory+'historical-rejections.json');
 assert.equal(historical.sha256,m.historicalRejections.sourceSha256);
 assert.equal(historical.rows.filter((r:{phase:string})=>r.phase==='measured').length,24);
 assert.equal(historical.rows.filter((r:{phase:string})=>r.phase==='warmup').length,1);
 for(const row of historical.rows){assert.equal(row.proposal,null);assert.equal(row.specificRule,'not_recoverable_without_raw_reply');assert.equal(row.attempts,2);}
 assert.equal(m.limits.includes('component_redactor_is_not_complete_broker'),true);
 assert.equal(m.limits.includes('RSS_excludes_GPU'),true);
});

test('WUL-840 bis measures the redactor component separately from a complete broker',()=>{
 const m=read(directory+'measurements.json'),component=read(directory+'component.json');
 assert.equal(component.scope,'gliner_and_redaction_session_component_only');
 assert.equal(component.hostSourceRevision,m.sourceRevision);
 assert.equal(component.characters,10000);
 assert.ok(component.identity);
 assert.equal(component.daemonModelResidentBefore,false);
 assert.equal(component.samples.filter((r:{phase:string})=>r.phase==='warmup').length,1);
 for(const mode of ['cold','warm']){
  const rows=component.samples.filter((r:Sample)=>r.mode===mode&&r.phase==='measured');
  const times=rows.map((r:Sample)=>r.elapsedMs).sort((a:number,b:number)=>a-b);
  const errors=rows.filter((r:{outcome:string})=>r.outcome!=='ok').length;
  assert.equal(rows.length,30);
  assert.equal(component.aggregates[mode].n,30);
  assert.equal(component.aggregates[mode].errors,errors);
  assert.equal(component.aggregates[mode].p50Ms,times[14]);
  assert.equal(component.aggregates[mode].p95Ms,times[28]);
  assert.equal(component.aggregates[mode].maxMs,times[29]);
  assert.equal(component.aggregates[mode].latencyBudgetMs,errors?null:Math.ceil(times[28]*1.2));
 }
 const values=component.memory.rssSamplesBytes as number[];
 assert.ok(values.length>0&&values.every(n=>Number.isSafeInteger(n)&&n>0));
 assert.equal(component.memory.peakRssBytes,Math.max(...values));
 assert.equal(component.memory.budgetBytes,Math.ceil(Math.max(...values)*1.2));
 assert.equal(component.memory.gpuMemoryMeasured,false);
});

test('WUL-840 bis binds the rejection diagnosis to every recorded Patient Insight outcome',()=>{
 const m=read(directory+'measurements.json'),proof=read(directory+'rejections.json');
 assert.equal(proof.sourceRevision,m.sourceRevision);
 assert.equal(proof.classificationAgreesWithEveryRecordedOutcome,true);
 assert.equal(proof.operations.length,122);
 const counts:{[code:string]:number}={};
 for(const operation of proof.operations){
  const [scenario,mode,run]=operation.case.split('/');
  const sample=m.cl.find((r:Sample)=>r.scenario===scenario&&r.mode===mode&&r.run===Number(run));
  assert.ok(sample,operation.case);
  assert.equal(sample.phase,operation.phase);
  assert.equal(sample.outcome,operation.status==='available'?'available':'error');
  assert.equal(sample.code,operation.code);
  assert.equal(sample.generationAttemptsReported,operation.reportedAttempts);
  assert.equal(operation.responses.length,operation.reportedAttempts);
  const last=operation.responses.at(-1);
  for(const response of operation.responses){assert.match(response.contentSha256,/^[a-f0-9]{64}$/);assert.ok(response.sourceCount>0);}
  if(operation.status==='available')assert.equal(last.findings.length,0);
  else{
   assert.ok(last.findings.length>0);
   assert.equal(operation.code,last.findings.every((f:{rule:string})=>f.rule.startsWith('fidelity_'))?'proposal_unfaithful':'proposal_invalid');
   if(operation.phase==='measured')counts[operation.code]=(counts[operation.code]??0)+1;
  }
 }
 assert.deepEqual(counts,{proposal_invalid:33,proposal_unfaithful:3});
});
