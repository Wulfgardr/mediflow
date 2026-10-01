// External synthetic diagnostic only. No observation is a release gate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { parseColdPhaseStderr } from './probe/cold-render-observer.mjs';
import { digest, decodePng, checkGlyphs } from './png-oracle.mjs';

export const CORPUS_SHA256='3457bdd13d2b1bba72a6340e9d9385b9cb5e1d1053b33d44357ce296b9b8c560';
export const WORKER_SHA256='31fce8c00c25edd20f7f4442edc9fe00d659599e436cc5166b4be4950f7f3a67';
export const CHECKER_BLOB='b942b38bec7c5a8a3d1f620ad550a1e0f35a5410';
export const SCHEMA='mediflow.anydoc_pdf_child_protocol.v1';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const PROBES={'pdf-phase-preload.mjs':'3ee154b1832b6c2ffea51ffd82efdeab06312f094a5d5e09b910965d4349cdec','pdf-phase-records.mjs':'fbdfd30256a581d2650139b7695f54688f0a948a8efa5ddf8b8345091cee4460','cold-render-observer.mjs':'89e49d2ba9b70d51971297b5cfea91fd6057e78069fcc024fa100d9bf9899954'};
export const ORDER=Object.freeze(Array.from({length:8},(_,i)=>(i%2?['A','B']:['B','A']).map((arm,j)=>Object.freeze({slot:i*2+j+1,fixture:'F'+i,arm}))).flat());
export const BUDGET=Object.freeze({fixtures:8,pagesPerFixture:1,renderSlots:16,materializeSlots:8,fontFiles:3,totalFontBytesMax:262144,fontProgramsPerPdfMax:2,pdfBytesMax:262144,widthPixelsMax:512,heightPixelsMax:256,retries:0});
function insist(ok,message){if(!ok)throw Error(message);}
function readJSON(p){return JSON.parse(fs.readFileSync(p,'utf8'));}
export function containedFile(root,relative) {
  insist(typeof relative==='string'&&!path.isAbsolute(relative)&&!relative.split(/[\\/]/).some(p=>p==='..'||p===''),'Unsafe asset path');
  const full=path.join(root,relative),real=fs.realpathSync(full);
  insist(real===full&&!fs.lstatSync(full).isSymbolicLink()&&fs.statSync(full).isFile(),'Symlink/non-file asset');
  insist(real.startsWith(root+path.sep),'Asset escaped corpus');return full;
}
export function verifyCorpus(root=HERE) {
  root=fs.realpathSync(root); const bytes=fs.readFileSync(containedFile(root,'corpus.json'));
  insist(digest(bytes)===CORPUS_SHA256,'Frozen corpus hash mismatch'); const corpus=JSON.parse(bytes);
  insist(JSON.stringify(corpus.budgets)===JSON.stringify(BUDGET)&&JSON.stringify(corpus.order)===JSON.stringify(ORDER),'Frozen budget/order mismatch');
  insist(corpus.fixtures.length===8&&corpus.fixtures.every((f,i)=>f.id==='F'+i&&f.fontPrograms<=2),'Fixture cohort mismatch');
  let fontBytes=0,fontFiles=0;
  for(const asset of corpus.assets){const p=containedFile(root,asset.path),bytes=fs.readFileSync(p);insist(bytes.length===asset.bytes&&digest(bytes)===asset.sha256,'Asset hash mismatch: '+asset.path);if(asset.path.startsWith('fonts/')){fontBytes+=bytes.length;fontFiles++;}}
  insist(fontFiles===3&&fontBytes<=262144,'Font budget exceeded');
  for(const [name,hash]of Object.entries(PROBES))insist(digest(fs.readFileSync(containedFile(root,'probe/'+name)))===hash,'Reviewed probe mismatch');
  for(const f of corpus.fixtures){const oracle=readJSON(containedFile(root,'oracles/'+f.id+'.json'));insist(oracle.id===f.id&&oracle.glyphs.length===f.glyphs,'Oracle identity mismatch');const png=fs.readFileSync(containedFile(root,'oracles/'+f.id+'.png'));insist(digest(png)===oracle.referencePngSHA256,'Oracle PNG digest');const reference=decodePng(png,oracle.width,oracle.height);insist(reference.sha256===oracle.referenceRGBASHA256&&checkGlyphs(reference,oracle).pass,'Reference is empty/incorrect');}
  return corpus;
}
export function frame(header,body=Buffer.alloc(0)) {
  const bytes=Buffer.from(JSON.stringify(header));insist(bytes.length>=1&&bytes.length<=65536,'Header bound');const n=Buffer.alloc(4);n.writeUInt32BE(bytes.length);return Buffer.concat([n,bytes,body]);
}
export function unframe(bytes) {
  insist(Buffer.isBuffer(bytes)&&bytes.length>=5&&bytes.length<=4194304,'Frame byte bound');const size=bytes.readUInt32BE();insist(size>=1&&size<=65536&&size+4<=bytes.length,'Frame header bound');
  const text=bytes.toString('utf8',4,4+size),header=JSON.parse(text);insist(JSON.stringify(header)===text&&header.schemaVersion===SCHEMA,'Frame canonical schema');const body=bytes.subarray(4+size);insist(header.bodyByteLength===body.length,'Frame body length');return {header,body};
}
export function environment(arm) {
  insist(arm==='A'||arm==='B','Unknown treatment');return arm==='A'?{NODE_ENV:'production',NAPI_RS_ENFORCE_VERSION_CHECK:'1'}:{NODE_ENV:'production',NAPI_RS_ENFORCE_VERSION_CHECK:'1',DISABLE_SYSTEM_FONTS_LOAD:'1'};
}
export function childContract(worker,input,arm,render,preload) {
  const root=path.dirname(path.dirname(worker));
  const args=['--max-old-space-size=256','--permission','--disable-warning=SecurityWarning','--allow-fs-read='+root,...(render?['--allow-addons','--import=data:text/javascript;base64,'+preload.toString('base64')]:[]),worker];
  const options={cwd:path.dirname(worker),env:environment(render?arm:'A'),input,encoding:'buffer',timeout:30000,maxBuffer:4194304,windowsHide:true};
  return {executable:process.execPath,args,options};
}
export function validateContract(contract,worker,input,arm,render,preload) {
  const expected=childContract(worker,input,arm,render,preload);
  insist(contract.executable===expected.executable&&JSON.stringify(contract.args)===JSON.stringify(expected.args),'Executable/argument drift');
  insist(JSON.stringify(Object.keys(contract.options).sort())===JSON.stringify(Object.keys(expected.options).sort()),'Spawn option keys drift');
  for(const key of Object.keys(expected.options))insist(key==='input'?contract.options[key]===input:key==='env'?JSON.stringify(contract.options[key])===JSON.stringify(expected.options[key]):contract.options[key]===expected.options[key],'Spawn option drift: '+key);
}
export class Slots {
  constructor(){this.next=0;this.materialized=new Set();}
  reserveMaterialize(id){insist(id==='F'+this.materialized.size&&!this.materialized.has(id)&&this.materialized.size<8,'Materialization order/retry');this.materialized.add(id);}
  reserve(slot){insist(this.next<16&&JSON.stringify(slot)===JSON.stringify(ORDER[this.next]),'Render order/retry/budget');this.next++;}
}
function checkerIdentity(bytes){const canonical=Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));return createHash('sha1').update('blob '+canonical.length+'\0').update(canonical).digest('hex');}
export function verifyCompiledBundle(repository,worker,runtime) {
  repository=fs.realpathSync(repository);worker=fs.realpathSync(worker);
  const expected=containedFile(repository,'.next/standalone/scripts/anydoc-pdf-page-worker.mjs');
  insist(worker===expected,'Worker is not the candidate compiled output');
  const root=path.join(repository,'.next','standalone');
  const buildId=fs.readFileSync(containedFile(repository,'.next/BUILD_ID'),'utf8').trim();
  insist(/^[A-Za-z0-9_-]{1,128}$/.test(buildId)&&fs.readFileSync(containedFile(repository,'.next/standalone/.next/BUILD_ID'),'utf8').trim()===buildId,'Compiled BUILD_ID mismatch');
  const manifestBytes=fs.readFileSync(containedFile(repository,'.next/standalone/mediflow-runtime-contract.json')),manifest=JSON.parse(manifestBytes);
  insist(keys(manifest,['schemaVersion','node','platform','arch','betterSqlite3Version'])&&manifest.schemaVersion===1&&keys(manifest.node,['major','version','moduleVersion'])&&manifest.node.major===24&&manifest.node.version===runtime.node&&manifest.node.moduleVersion===runtime.modules&&manifest.platform===runtime.platform&&manifest.arch===runtime.arch,'Compiled runtime manifest mismatch');
  insist(manifest.betterSqlite3Version===readJSON(containedFile(repository,'.next/standalone/node_modules/better-sqlite3/package.json')).version,'Compiled SQLite manifest mismatch');
  // The separately reviewed activation must seal this after the exact fresh
  // compilation and original manifest step; this harness never fabricates it.
  const sealPath=containedFile(repository,'.next/font-ab-build-identity.json'),sealBytes=fs.readFileSync(sealPath),seal=JSON.parse(sealBytes);
  const expectedSeal={schemaVersion:1,candidateHead:'eb701348f3a01ccf5051fe3d8a51de1082ef751d',candidateTree:'1deddabbdf1dd2282ea8f63a05c89fd69e6483bc',candidateParents:['a238b47fccce09db9a0a7b3977355266962216ca','df90702a69c8877557d666be81d039d6f88cde7a'],standaloneRelativePath:'.next/standalone',buildId,runtimeManifestSHA256:digest(manifestBytes),workerSHA256:WORKER_SHA256};
  insist(keys(seal,Object.keys(expectedSeal))&&Object.entries(expectedSeal).every(([key,value])=>JSON.stringify(seal[key])===JSON.stringify(value))&&digest(fs.readFileSync(worker))===seal.workerSHA256,'Compiled candidate build identity mismatch');
  return {root,worker,buildId,runtimeManifestSHA256:digest(manifestBytes),buildIdentitySHA256:digest(sealBytes)};
}
export function preflight(repository,worker,mode) {
  insist(process.versions.node==='24.21.0','Exact Node 24.21.0 required');
  insist(mode==='local-validation'||mode==='observe-windows','Explicit observation mode required');
  insist(mode==='local-validation'?process.platform==='darwin':process.platform==='win32'&&process.arch==='x64','Observation mode/platform mismatch');
  repository=fs.realpathSync(repository);worker=fs.realpathSync(worker);
  insist(path.basename(worker)==='anydoc-pdf-page-worker.mjs'&&path.basename(path.dirname(worker))==='scripts','Worker lexical path');
  insist(digest(fs.readFileSync(worker))===WORKER_SHA256,'Pinned worker hash mismatch');
  insist(checkerIdentity(fs.readFileSync(path.join(repository,'scripts/check-standalone-runtime-bundle.mjs')))===CHECKER_BLOB,'Pinned checker mismatch');
  const root=path.dirname(path.dirname(worker));let compiledIdentity=null;
  for(const [name,version]of [['pdfjs-dist','4.10.38'],['@napi-rs/canvas','0.1.100']])insist(readJSON(path.join(root,'node_modules',name,'package.json')).version===version,'Physical pinned dependency version');
  if(mode==='observe-windows') {
    const git=(args)=>execFileSync('git',['-C',repository,...args],{encoding:'utf8'}).trim();
    insist(git(['rev-parse','HEAD'])==='eb701348f3a01ccf5051fe3d8a51de1082ef751d'&&git(['rev-parse','HEAD^{tree}'])==='1deddabbdf1dd2282ea8f63a05c89fd69e6483bc','Candidate SHA/tree mismatch');
    const parents=git(['cat-file','-p','HEAD']).split(/\r?\n\r?\n/,1)[0].split(/\r?\n/).filter(s=>/^parent [0-9a-f]{40}$/.test(s)).map(s=>s.slice(7)).join(' ');
    insist(parents==='a238b47fccce09db9a0a7b3977355266962216ca df90702a69c8877557d666be81d039d6f88cde7a','Candidate ordered parents mismatch');
    compiledIdentity=verifyCompiledBundle(repository,worker,{node:process.versions.node,modules:process.versions.modules,platform:process.platform,arch:process.arch});
    const binary=path.join(root,'node_modules','@napi-rs/canvas-win32-x64-msvc','skia.win32-x64-msvc.node');
    insist(digest(fs.readFileSync(binary))==='0f76fb0648fbff832856f6ce202059fc3fa38be7ad925300e96935906ea11132','Pinned Windows native binary');
  }
  return {repository,worker,root,mode,compiledIdentity,qualification:'diagnostic only; local mode proves source/dependency validation, not exact Windows candidate build'};
}
function durable(file,value,exclusive=false){const data=JSON.stringify(value,null,2)+'\n';insist(Buffer.byteLength(data)<=256*1024,'Receipt bound');const pending=exclusive?file:file+'.pending';const fd=fs.openSync(pending,'wx',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(!exclusive)fs.renameSync(pending,file);}
export function callChild(contract,worker,input,arm,render,preload,spawn=spawnSync){validateContract(contract,worker,input,arm,render,preload);return Reflect.apply(spawn,undefined,[contract.executable,contract.args,contract.options]);}
function transport(raw,elapsed){return {elapsedMs:elapsed===null?null:Math.round(elapsed),status:raw.status??null,signal:raw.signal??null,errorCode:raw.error?.code??null,stdoutBytes:raw.stdout?.length??null,stderrBytes:raw.stderr?.length??null};}
function successful(raw){return !raw.error&&raw.status===0&&raw.signal===null&&Buffer.isBuffer(raw.stdout)&&Buffer.isBuffer(raw.stderr);}
function keys(value,expected){return value&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...expected].sort());}
function clock(now){try{const value=now();return Number.isFinite(value)?value:null;}catch{return null;}}
function compact(record){const {observation,evaluation,...rest}=record;return {...rest,phaseCount:observation?.phases.length??0,nonProbeStderr:observation?.nonProbeStderr??null,evaluation:{pass:evaluation.pass,reason:evaluation.reason,rgbaSHA256:evaluation.rgbaSHA256,failedGlyphs:evaluation.glyphs?.failedGlyphs},receipt:'slot-'+String(record.slot).padStart(2,'0')+'/receipt.json'};}
export function evaluate(raw,oracle) {
  if(!successful(raw))return {pass:false,reason:'transport_failure'};
  try{
    const {header,body}=unframe(raw.stdout);
    if(header.status!=='rendered')return {pass:false,reason:'worker_'+String(header.reason??header.status)};
    insist(keys(header,['schemaVersion','status','pages','bodyByteLength'])&&Array.isArray(header.pages)&&header.pages.length===1,'Exactly one rendered page');const page=header.pages[0];
    insist(keys(page,['page','byteLength','width','height','durationMs'])&&page.page===1&&page.width===oracle.width&&page.height===oracle.height&&page.byteLength===body.length&&Number.isFinite(page.durationMs)&&page.durationMs>=0,'Rendered page bounds/schema');
    const decoded=decodePng(body,oracle.width,oracle.height),glyphs=checkGlyphs(decoded,oracle);
    return {pass:glyphs.pass,reason:glyphs.pass?'observed_glyphs_match_independent_reference':'glyph_mismatch',rgbaSHA256:decoded.sha256,glyphs};
  }catch(error){return {pass:false,reason:'invalid_render_output',detail:error.message};}
}
export function runAB({repository,worker,output,mode,corpusRoot=HERE,spawn=spawnSync,now=()=>performance.now(),verify=preflight,writeRaw=(file,bytes)=>fs.writeFileSync(file,bytes,{flag:'wx'}),writeReceipt=durable}) {
  const corpus=verifyCorpus(corpusRoot),identity=verify(repository,worker,mode);worker=identity.worker;
  output=path.resolve(output);fs.mkdirSync(output);const preload=fs.readFileSync(path.join(corpusRoot,'probe/pdf-phase-preload.mjs'));
  const slots=new Slots(),budget={schemaVersion:1,mode,qualification:'always nonqualifying; raw probe stderr retained',plannedRenderSlots:16,renderCalls:0,materializeCalls:0,retries:0,manualDispatches:0,state:'prepared',corpusSHA256:CORPUS_SHA256,identity,records:[]};
  let activeRecord=null,activeRaw=null;
  const errorInfo=error=>({name:error.name,message:error.message,code:error.code??null});
  function stopPersistence(cause,file) {
    const failure=new Error('Evidence persistence failed; no further child calls',{cause});
    failure.code='EVIDENCE_PERSISTENCE_FAILED';failure.rawResult=activeRaw;failure.childError=activeRaw?.error;failure.record=activeRecord;failure.budget=budget;
    budget.state='persistence-failed';budget.originalSmokePassed=false;budget.releaseQualified=false;budget.plannedSlotsAccountedFor=slots.next;
    budget.persistenceFailure={file:path.relative(output,file),error:errorInfo(cause),evidenceLoss:true};
    if(activeRecord){activeRecord.state='persistence-failed';activeRecord.persistenceFailure=budget.persistenceFailure;}
    // Failure reporting is best effort only. A broken sink never resumes the loop.
    const reporting=[];
    if(activeRecord)reporting.push([activeRecord.slot?path.join(output,'slot-'+String(activeRecord.slot).padStart(2,'0'),'receipt.json'):path.join(output,activeRecord.fixture+'-materialize.receipt.json'),activeRecord]);
    reporting.push([path.join(output,'budget.json'),budget]);
    for(const [target,value]of reporting){try{writeReceipt(target,value);}catch(error){(failure.reportingFailures??=[]).push({file:path.relative(output,target),error:errorInfo(error)});}}
    try{writeReceipt(path.join(output,'persistence-failure.json'),{budget,record:activeRecord,reportingFailures:failure.reportingFailures??[]},true);}catch(error){(failure.reportingFailures??=[]).push({file:'persistence-failure.json',error:errorInfo(error)});}
    throw failure;
  }
  function persist(file,value,exclusive=false){try{writeReceipt(file,value,exclusive);}catch(error){stopPersistence(error,file);}}
  function stopVerification(cause) {
    const failure=new Error('Post-render verification failed; no further child calls',{cause});
    failure.code='POST_RENDER_VERIFICATION_FAILED';failure.rawResult=activeRaw;failure.childError=activeRaw?.error;failure.record=activeRecord;failure.budget=budget;
    budget.state='verification-failed';budget.originalSmokePassed=false;budget.releaseQualified=false;budget.plannedSlotsAccountedFor=slots.next;
    budget.verificationFailure={check:'post-render',error:errorInfo(cause)};
    activeRecord.state='verification-failed';activeRecord.verificationFailure=budget.verificationFailure;
    // Raw buffers and transport were already saved. Reporting failure is
    // separate from the child result and never permits another child call.
    for(const [file,value]of [[path.join(output,'slot-'+String(activeRecord.slot).padStart(2,'0'),'receipt.json'),activeRecord],[path.join(output,'budget.json'),budget]]){
      try{writeReceipt(file,value);}catch(error){(failure.reportingFailures??=[]).push({file:path.relative(output,file),error:errorInfo(error)});}
    }
    try{writeReceipt(path.join(output,'verification-failure.json'),{budget,record:activeRecord,reportingFailures:failure.reportingFailures??[]},true);}catch(error){(failure.reportingFailures??=[]).push({file:'verification-failure.json',error:errorInfo(error)});}
    throw failure;
  }
  function persistRawPair(stdoutFile,stderrFile,raw) {
    const evidence={};let firstFailure;
    // Attempt both sinks independently so stdout loss does not suppress stderr.
    for(const [name,file]of [['stdout',stdoutFile],['stderr',stderrFile]]){
      try{writeRaw(file,raw[name]??Buffer.alloc(0));evidence[name]={saved:true,file:path.relative(output,file)};}
      catch(error){evidence[name]={saved:false,file:path.relative(output,file),error:errorInfo(error)};firstFailure??={error,file};}
    }
    activeRecord.rawEvidence=evidence;
    if(firstFailure)stopPersistence(firstFailure.error,firstFailure.file);
  }
  persist(path.join(output,'budget.json'),budget,true);
  for(const planned of ORDER){const dir=path.join(output,'slot-'+String(planned.slot).padStart(2,'0'));fs.mkdirSync(dir);persist(path.join(dir,'receipt.json'),{...planned,state:'reserved',qualification:'nonqualifying'},true);}
  const materialized=new Map();
  for(const planned of ORDER) {
    activeRecord=null;activeRaw=null;
    insist(digest(fs.readFileSync(worker))===WORKER_SHA256,'Worker drift; remaining slots stay reserved');
    const fixture=corpus.fixtures.find(f=>f.id===planned.fixture),oracle=readJSON(path.join(corpusRoot,'oracles',fixture.id+'.json'));
    if(!materialized.has(fixture.id)){
      slots.reserveMaterialize(fixture.id);const source=fs.readFileSync(path.join(corpusRoot,'fixtures',fixture.id+'.pdf'));
      const input=frame({schemaVersion:SCHEMA,operation:'materialize',pageCount:1,sourceByteLength:source.length},source),contract=childContract(worker,input,'A',false,preload);
      activeRecord={fixture:fixture.id,state:'materialize-prepared',sourceSHA256:digest(source)};
      persist(path.join(output,'budget.json'),budget);
      let raw,materialization;
      budget.materializeCalls++;
      try{raw=callChild(contract,worker,input,'A',false,preload,spawn);}catch(error){materialization={failure:'materialization_failed',detail:error.message};activeRecord.childException=errorInfo(error);}
      if(raw){
        activeRaw=raw;activeRecord.transport=transport(raw,null);activeRecord.childError=raw.error?errorInfo(raw.error):null;activeRecord.state='materialize-returned';
        try{insist(successful(raw)&&raw.stderr.length===0,'Materialization transport');const decoded=unframe(raw.stdout);insist(keys(decoded.header,['schemaVersion','status','pages','bodyByteLength'])&&decoded.header.status==='materialized'&&decoded.header.pages?.length===1&&keys(decoded.header.pages[0],['page','byteLength'])&&decoded.header.pages[0].page===1&&decoded.header.pages[0].byteLength===decoded.body.length&&decoded.body.length>0&&decoded.body.length<=262144,'Materialization frame');materialization={bytes:decoded.body,sourceSHA256:digest(source),materializedSHA256:digest(decoded.body)};}catch(error){materialization={failure:'materialization_failed',detail:error.message};}
        persistRawPair(path.join(output,fixture.id+'-materialize.stdout.bin'),path.join(output,fixture.id+'-materialize.stderr.bin'),raw);
      }
      Object.assign(activeRecord,{state:materialization.failure?'failed':'materialized',failure:materialization.failure??null,detail:materialization.detail??null,materializedSHA256:materialization.materializedSHA256??null});
      persist(path.join(output,fixture.id+'-materialize.receipt.json'),activeRecord,true);
      materialized.set(fixture.id,materialization);activeRecord=null;activeRaw=null;
    }
    slots.reserve(planned);const materialization=materialized.get(fixture.id),dir=path.join(output,'slot-'+String(planned.slot).padStart(2,'0'));
    const record={...planned,state:'prepared',expectation:fixture.expectation,qualification:'diagnostic only; never release qualifying',workerSHA256Before:digest(fs.readFileSync(worker)),environment:environment(planned.arm),callsBeforeRender:1,sourceSHA256:materialization.sourceSHA256,materializedSHA256:materialization.materializedSHA256};activeRecord=record;
    if(materialization.failure){Object.assign(record,{state:'not-rendered',evaluation:{pass:false,reason:materialization.failure},materializationDetail:materialization.detail});}
    else{
      const input=frame({schemaVersion:SCHEMA,operation:'render',pages:[{page:1,byteLength:materialization.bytes.length}],bodyByteLength:materialization.bytes.length},materialization.bytes);
      const contract=childContract(worker,input,planned.arm,true,preload);
      insist(record.workerSHA256Before===WORKER_SHA256,'Worker drift before render');
      record.contract={timeoutMs:30000,oldSpaceMiB:256,maxBuffer:4194304,permissions:'unchanged read package-root and render-only addons',environmentTreatmentOnly:planned.arm==='B',inputSHA256:digest(input)};
      record.state='render-prepared';persist(path.join(dir,'receipt.json'),record);persist(path.join(output,'budget.json'),budget);
      const started=clock(now);let raw;
      budget.renderCalls++;
      try{raw=callChild(contract,worker,input,planned.arm,true,preload,spawn);}catch(error){Object.assign(record,{state:'spawn-threw',evaluation:{pass:false,reason:'spawn_failure'},childException:errorInfo(error)});}
      if(raw){
        activeRaw=raw;const ended=clock(now),elapsed=started!==null&&ended!==null?ended-started:null;
        record.transport=transport(raw,elapsed);record.childError=raw.error?errorInfo(raw.error):null;record.timingFailed=elapsed===null;record.state='render-returned';
        record.evaluation={pass:false,reason:successful(raw)?'postchecks_pending':'transport_failure'};record.rawOracleWouldRejectStderr=raw.stderr?.length>0;
        // Persist completed child evidence before any volatile post-check.
        persistRawPair(path.join(dir,'stdout.bin'),path.join(dir,'stderr.bin'),raw);
        persist(path.join(dir,'receipt.json'),record);persist(path.join(output,'budget.json'),budget);
        try{
          record.observation=parseColdPhaseStderr(raw.stderr);record.lastPhase=record.observation.phases.at(-1)?.phase??null;
          record.evaluation=evaluate(raw,oracle);record.workerSHA256After=digest(fs.readFileSync(worker));
          insist(record.workerSHA256After===WORKER_SHA256,'Post-render worker identity mismatch');
          const system=record.observation.phases.find(p=>p.phase==='system-fonts-enter');const exit=record.observation.phases.find(p=>p.phase==='system-fonts-exit');record.explicitSystemFontLoadObserved=!!system;record.systemFontIntervalMs=system&&exit?exit.elapsedMs-system.elapsedMs:null;
        }catch(error){stopVerification(error);}
      }
    }
    persist(path.join(dir,'receipt.json'),record);budget.records.push(compact(record));persist(path.join(output,'budget.json'),budget);
  }
  budget.state='completed';budget.plannedSlotsAccountedFor=slots.next;budget.originalSmokePassed=false;budget.releaseQualified=false;
  budget.comparisons=corpus.fixtures.map(f=>{const pair=budget.records.filter(r=>r.fixture===f.id),a=pair.find(r=>r.arm==='A'),b=pair.find(r=>r.arm==='B');return {fixture:f.id,expectation:f.expectation,aGlyphsMatch:a.evaluation.pass,bGlyphsMatch:b.evaluation.pass,decodedRGBAEqual:!!a.evaluation.rgbaSHA256&&a.evaluation.rgbaSHA256===b.evaluation.rgbaSHA256,missingFontSource:f.expectation==='observational-missing-font',bothBlankCanPass:false};});
  persist(path.join(output,'budget.json'),budget);return budget;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{const [mode,repository,worker,output,...extra]=process.argv.slice(2);insist(mode&&repository&&worker&&output&&!extra.length,'Usage: run-ab.mjs local-validation|observe-windows REPOSITORY WORKER NEW_OUTPUT');const result=runAB({mode,repository,worker,output});console.log(JSON.stringify({mode,result:'diagnostic only',renderCalls:result.renderCalls,materializeCalls:result.materializeCalls,comparisons:result.comparisons,releaseQualified:false},null,2));}
  catch(error){console.error(JSON.stringify({diagnosticOnly:true,failure:error.message,code:error.code??null,transport:error.record?.transport??null,childError:error.record?.childError??null,rawEvidence:error.record?.rawEvidence??null,persistenceFailure:error.budget?.persistenceFailure??null,verificationFailure:error.budget?.verificationFailure??null,reportingFailures:error.reportingFailures??[]}));}
  process.exitCode=1;
}
