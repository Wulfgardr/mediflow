import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';
import { verifyCorpus, preflight, verifyCompiledBundle, childContract, callChild, Slots, ORDER, environment, frame, unframe, evaluate, runAB, SCHEMA, WORKER_SHA256 } from './run-ab.mjs';
import { digest, decodePng, encodePng, checkGlyphs, crc32 } from './png-oracle.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const worker=fs.realpathSync(process.env.FONT_AB_TEST_WORKER);
assert.equal(digest(fs.readFileSync(worker)),WORKER_SHA256);
const preload=fs.readFileSync(path.join(root,'probe/pdf-phase-preload.mjs'));
const oracle=id=>JSON.parse(fs.readFileSync(path.join(root,'oracles',id+'.json')));
const reference=id=>{const o=oracle(id);return decodePng(fs.readFileSync(path.join(root,'oracles',id+'.png')),o.width,o.height);};
const rendered=(id,png=fs.readFileSync(path.join(root,'oracles',id+'.png')))=>{const o=oracle(id);return frame({schemaVersion:SCHEMA,status:'rendered',pages:[{page:1,byteLength:png.length,width:o.width,height:o.height,durationMs:1}],bodyByteLength:png.length},png);};
const raw=(stdout,stderr=Buffer.alloc(0))=>({status:0,signal:null,error:undefined,stdout,stderr});
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mediflow-font-ab-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function chunk(type,data){const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out;}
function withIDAT(png,change){const start=33,size=png.readUInt32BE(start);assert.equal(png.toString('ascii',start+4,start+8),'IDAT');return Buffer.concat([png.subarray(0,start),chunk('IDAT',change(png.subarray(start+8,start+8+size))),png.subarray(start+12+size)]);}

test('frozen eight-page corpus, embedded font counts, all text references visibly nonempty',()=>{
  const corpus=verifyCorpus(root);assert.equal(corpus.fixtures.length,8);
  assert.equal(corpus.assets.filter(a=>a.path.startsWith('fonts/')).reduce((n,a)=>n+a.bytes,0),145144);
  for(const f of corpus.fixtures){const pdf=fs.readFileSync(path.join(root,'fixtures',f.id+'.pdf')).toString('latin1');assert.equal((pdf.match(/\/Type \/Page\b/g)||[]).length,1);assert.equal((pdf.match(/\/FontFile2\b/g)||[]).length,f.fontPrograms);const o=oracle(f.id);assert.equal(o.glyphs.length,f.glyphs);assert.equal(checkGlyphs(reference(f.id),o).pass,true);if(f.id!=='F0')assert.ok(o.glyphs.every(g=>g.inkPixels>=8));}
});
test('blank versus blank cannot certify a text fixture; only exact F0 blank is exempt',()=>{
  for(let i=1;i<8;i++){const o=oracle('F'+i),rgba=Buffer.alloc(o.width*o.height*4,255);assert.equal(evaluate(raw(rendered(o.id,encodePng(o.width,o.height,rgba))),o).pass,false);}
  const o=oracle('F2'),empty=structuredClone(o);empty.glyphs[0].maskBase64=Buffer.alloc(Math.ceil(56*56/8)).toString('base64');empty.glyphs[0].inkPixels=0;empty.glyphs[0].bbox=null;assert.throws(()=>checkGlyphs(reference('F2'),empty),/Empty/);
  empty.glyphs=[];assert.throws(()=>checkGlyphs(reference('F2'),empty),/empty oracle/);
  const blank=reference('F0');blank.rgba[0]=0;blank.sha256=digest(blank.rgba);assert.equal(checkGlyphs(blank,oracle('F0')).pass,false);
});
test('individual swapped, clipped and shifted real glyphs are rejected',()=>{
  for(const id of ['F2','F4','F6']){const original=reference(id),o=oracle(id),g=o.glyphs[0],h=o.glyphs[1];
    const swapped={...original,rgba:Buffer.from(original.rgba)};
    for(let y=0;y<g.roi.height;y++)for(let x=0;x<g.roi.width;x++){const a=((g.roi.y+y)*o.width+g.roi.x+x)*4,b=((h.roi.y+y)*o.width+h.roi.x+x)*4;original.rgba.copy(swapped.rgba,a,b,b+4);original.rgba.copy(swapped.rgba,b,a,a+4);}
    assert.equal(checkGlyphs(swapped,o).pass,false,id+' swapped');
    const clipped={...original,rgba:Buffer.from(original.rgba)};
    for(let y=0;y<g.roi.height;y++)for(let x=0;x<g.roi.width/2;x++){const at=((g.roi.y+y)*o.width+g.roi.x+x)*4;clipped.rgba.fill(255,at,at+4);}
    assert.equal(checkGlyphs(clipped,o).pass,false,id+' clipped');
    const shifted={...original,rgba:Buffer.from(original.rgba)};
    for(let y=0;y<g.roi.height;y++)for(let x=0;x<g.roi.width;x++){const at=((g.roi.y+y)*o.width+g.roi.x+x)*4;if(x>=5)original.rgba.copy(shifted.rgba,at,at-20,at-16);else shifted.rgba.fill(255,at,at+4);}
    assert.equal(checkGlyphs(shifted,o).pass,false,id+' shifted');
  }
});
test('strict PNG bounds, CRC, truncated/trailing output, decompression excess, invalid filter',()=>{
  const png=fs.readFileSync(path.join(root,'oracles/F6.png')),o=oracle('F6');assert.equal(decodePng(png,o.width,o.height).sha256,o.referenceRGBASHA256);
  const bad=Buffer.from(png);bad[40]^=1;assert.throws(()=>decodePng(bad,o.width,o.height),/CRC/);
  assert.throws(()=>decodePng(png.subarray(0,-1),o.width,o.height),/truncated|bound/);
  assert.throws(()=>decodePng(Buffer.concat([png,Buffer.from([0])]),o.width,o.height),/trailing/);
  assert.throws(()=>decodePng(png,511,o.height),/dimensions/);
  const simple=encodePng(2,2,Buffer.alloc(16,255));
  assert.throws(()=>decodePng(withIDAT(simple,d=>deflateSync(Buffer.concat([inflateSync(d),Buffer.alloc(1)]))),2,2),/larger|bound|length/i);
  assert.throws(()=>decodePng(withIDAT(simple,d=>{const rows=inflateSync(d);rows[0]=5;return deflateSync(rows);}),2,2),/filter/);
  assert.throws(()=>decodePng(Buffer.concat([simple.subarray(0,33),chunk('XXXX',Buffer.alloc(0)),simple.subarray(33)]),2,2),/critical/);
});
test('PNG decoder implements all five row filters independently',()=>{
  const width=3,height=5,bpp=4,rgba=Buffer.from(Array.from({length:width*height*bpp},(_,i)=>(i*31+19)%256)),rows=Buffer.alloc(height*(width*bpp+1));
  const paeth=(a,b,c)=>{const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;};
  for(let y=0;y<height;y++){rows[y*(width*bpp+1)]=y;for(let x=0;x<width*bpp;x++){const at=y*width*bpp+x,a=x>=bpp?rgba[at-bpp]:0,b=y?rgba[at-width*bpp]:0,c=y&&x>=bpp?rgba[at-width*bpp-bpp]:0;rows[y*(width*bpp+1)+1+x]=(rgba[at]-[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][y])&255;}}
  const png=encodePng(width,height,rgba);assert.deepEqual(decodePng(withIDAT(png,()=>deflateSync(rows)),width,height).rgba,rgba);
});
test('framed worker output rejects truncation, length mismatch, extra header keys, wrong pages',()=>{
  const bytes=rendered('F6'),o=oracle('F6');assert.equal(evaluate(raw(bytes),o).pass,true);
  assert.equal(evaluate(raw(bytes.subarray(0,-1)),o).pass,false);
  const {header,body}=unframe(bytes);header.pages[0].page=2;assert.equal(evaluate(raw(frame(header,body)),o).pass,false);header.pages[0].page=1;header.extra=1;assert.equal(evaluate(raw(frame(header,body)),o).pass,false);
  header.bodyByteLength++;assert.throws(()=>unframe(frame(header,body)),/length/);
});
test('exact A/B environment set before imports; original permissions/resources unchanged',()=>{
  const input=Buffer.from('input'),a=childContract(worker,input,'A',true,preload),b=childContract(worker,input,'B',true,preload);
  assert.deepEqual(a.options.env,{NODE_ENV:'production',NAPI_RS_ENFORCE_VERSION_CHECK:'1'});assert.deepEqual(b.options.env,{...a.options.env,DISABLE_SYSTEM_FONTS_LOAD:'1'});assert.deepEqual(a.args,b.args);assert.deepEqual({...a.options,env:null},{...b.options,env:null});
  assert.equal(a.args.at(-1),worker);assert.ok(a.args.at(-2).startsWith('--import=data:text/javascript;base64,'));
  assert.equal(a.options.timeout,30000);assert.equal(a.options.maxBuffer,4194304);assert.ok(a.args.includes('--max-old-space-size=256'));assert.equal(a.args.filter(s=>s.startsWith('--allow-fs-')).length,1);assert.ok(a.args.includes('--allow-addons'));
  const mat=childContract(worker,input,'B',false,preload);assert.deepEqual(mat.options.env,environment('A'));assert.ok(!mat.args.some(s=>s==='--allow-addons'||s.startsWith('--import')));
  assert.throws(()=>environment('0'),/Unknown/);
});
test('contract drift rejected before spawn; raw child failure object and buffers remain identical',()=>{
  const input=Buffer.from('input'),contract=()=>childContract(worker,input,'B',true,preload);let calls=0;
  for(const alter of [c=>c.options.env.NODE_OPTIONS='--expose-gc',c=>c.options.timeout=30001,c=>c.options.maxBuffer=8388608,c=>c.options.stdio='pipe',c=>c.options.killSignal='SIGKILL',c=>c.args.push('--allow-fs-write=*'),c=>c.options.input=Buffer.from(input),c=>c.executable='/other/node']){const c=contract();alter(c);assert.throws(()=>callChild(c,worker,input,'B',true,preload,()=>calls++),/drift/);}
  assert.equal(calls,0);const error=Object.assign(Error('timeout'),{code:'ETIMEDOUT'}),result={status:null,signal:'SIGTERM',error,stdout:Buffer.from('partial'),stderr:Buffer.from('raw')};assert.equal(callChild(contract(),worker,input,'B',true,preload,()=>result),result);assert.equal(result.error,error);
});
test('hard budget rejects reordered/duplicated seventeenth slot and materialization retry',()=>{
  const s=new Slots();assert.throws(()=>s.reserve(ORDER[1]),/order/);for(const p of ORDER)s.reserve(p);assert.throws(()=>s.reserve(ORDER[0]),/budget/);for(let i=0;i<8;i++)s.reserveMaterialize('F'+i);assert.throws(()=>s.reserveMaterialize('F0'),/retry/);
});
test('asset/hash, license, probe and symlink tampering fail before any child',t=>{
  const tmp=temporary(t);for(const relative of ['fixtures/F6.pdf','licenses/cjk-OFL.txt','fonts/cjk.ttf','probe/pdf-phase-preload.mjs','corpus.json']){const copy=path.join(tmp,relative.replaceAll('/','-'));fs.cpSync(root,copy,{recursive:true});fs.appendFileSync(path.join(copy,relative),'tamper');assert.throws(()=>verifyCorpus(copy),/mismatch/);}
  const copy=path.join(tmp,'symlink');fs.cpSync(root,copy,{recursive:true});const target=path.join(copy,'fixtures/F0.pdf');fs.unlinkSync(target);fs.symlinkSync(path.join(root,'fixtures/F0.pdf'),target);assert.throws(()=>verifyCorpus(copy),/Symlink/);
});
function fakeRun(t,{failRender=false,failMaterialize=false,timingFault=false,drift=false}={}){
  const tmp=temporary(t),fakeWorker=path.join(tmp,'anydoc-pdf-page-worker.mjs');fs.copyFileSync(worker,fakeWorker);
  const ids=new Map(Array.from({length:8},(_,i)=>[digest(fs.readFileSync(path.join(root,'fixtures','F'+i+'.pdf'))),'F'+i]));const calls=[];let renders=0,clockReads=0;
  const spawn=(exec,args,options)=>{
    const size=options.input.readUInt32BE(),header=JSON.parse(options.input.toString('utf8',4,4+size)),body=options.input.subarray(4+size),id=ids.get(digest(body));assert.ok(id);calls.push({id,header,args,env:options.env});
    if(header.operation==='materialize'){if(failMaterialize&&id==='F0')return {...raw(Buffer.alloc(0)),status:1};if(drift&&id==='F0')fs.appendFileSync(fakeWorker,'drift');return raw(frame({schemaVersion:SCHEMA,status:'materialized',pages:[{page:1,byteLength:body.length}],bodyByteLength:body.length},body));}
    renders++;if(failRender&&renders===1)return {status:null,signal:'SIGTERM',error:Object.assign(Error('timeout'),{code:'ETIMEDOUT'}),stdout:Buffer.from('partial'),stderr:Buffer.from('raw-failure')};
    const phase=Buffer.from(JSON.stringify({probe:'pdf-phase-v1',phase:'process-exit',elapsedMs:1,cpuUserUs:1,cpuSystemUs:1,rssBytes:1})+'\n');return raw(rendered(id),phase);
  };
  const options={repository:tmp,worker:fakeWorker,output:path.join(tmp,'output'),mode:'unit-test-only',corpusRoot:root,spawn,now:()=>{clockReads++;if(timingFault)throw Error('clock');return clockReads;},verify:(repository,worker,mode)=>({repository,worker,mode,qualification:'synthetic fake test only'})};
  return {options,calls,get renders(){return renders;},tmp};
}
test('fake integration consumes fixed sixteen fresh calls, eight materializations, no retry; raw timeout preserved',t=>{
  const f=fakeRun(t,{failRender:true,timingFault:true}),result=runAB(f.options);assert.equal(f.renders,16);assert.equal(f.calls.length,24);assert.equal(result.renderCalls,16);assert.equal(result.materializeCalls,8);assert.equal(result.plannedSlotsAccountedFor,16);assert.equal(result.retries,0);assert.equal(result.releaseQualified,false);assert.equal(result.originalSmokePassed,false);
  const calls=f.calls.filter(c=>c.header.operation==='render');for(let i=0;i<16;i++){assert.equal(calls[i].id,ORDER[i].fixture);assert.deepEqual(calls[i].env,environment(ORDER[i].arm));}
  const receipt=JSON.parse(fs.readFileSync(path.join(f.options.output,'slot-01/receipt.json')));assert.equal(receipt.transport.errorCode,'ETIMEDOUT');assert.equal(receipt.transport.signal,'SIGTERM');assert.equal(receipt.transport.elapsedMs,null);assert.equal(receipt.evaluation.pass,false);assert.equal(fs.readFileSync(path.join(f.options.output,'slot-01/stderr.bin')).toString(),'raw-failure');
  const second=JSON.parse(fs.readFileSync(path.join(f.options.output,'slot-02/receipt.json')));assert.equal(second.transport.status,0);assert.equal(second.evaluation.pass,true);assert.equal(second.timingFailed,true);assert.ok(second.rawOracleWouldRejectStderr);
  assert.throws(()=>runAB(f.options),/exist/);assert.equal(f.renders,16);assert.ok(fs.statSync(path.join(f.options.output,'budget.json')).size<256*1024);
});
test('failed materialization remains two not-rendered failures, fourteen render calls, no retry',t=>{
  const f=fakeRun(t,{failMaterialize:true}),result=runAB(f.options);assert.equal(f.renders,14);assert.equal(result.renderCalls,14);assert.equal(result.materializeCalls,8);assert.equal(result.records.filter(r=>r.state==='not-rendered').length,2);assert.equal(result.state,'completed');assert.equal(result.plannedSlotsAccountedFor,16);
});
test('worker drift after materialization stops before any render and leaves slots reserved',t=>{
  const f=fakeRun(t,{drift:true});assert.throws(()=>runAB(f.options),/Worker drift/);assert.equal(f.renders,0);assert.equal(f.calls.length,1);assert.equal(JSON.parse(fs.readFileSync(path.join(f.options.output,'budget.json'))).renderCalls,0);
});
test('preflight rejects unsupported mode/platform and source mismatch without children',()=>{
  assert.throws(()=>preflight('.',worker,'unexpected'),/mode/);assert.throws(()=>preflight('.',worker,'observe-windows'),/platform/);assert.throws(()=>preflight('.',worker,'local-validation'),/ENOENT|checker/);
});

function assertStopped(f,error,expectedRenders,expectedMaterializations) {
  assert.equal(error.code,'EVIDENCE_PERSISTENCE_FAILED');assert.equal(f.renders,expectedRenders);assert.equal(f.calls.length,expectedRenders+expectedMaterializations);
  assert.equal(error.budget.renderCalls,expectedRenders);assert.equal(error.budget.materializeCalls,expectedMaterializations);assert.equal(error.budget.state,'persistence-failed');assert.equal(error.budget.releaseQualified,false);
  for(let slot=expectedRenders?2:1;slot<=16;slot++)assert.equal(JSON.parse(fs.readFileSync(path.join(f.options.output,'slot-'+String(slot).padStart(2,'0')+'/receipt.json'))).state,'reserved');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.options.output,'persistence-failure.json'))).budget.state,'persistence-failed');
}
for(const sink of ['stdout','stderr'])test('render '+sink+' persistence failure preserves timeout/raw identity, attempts both sinks and halts',t=>{
  const f=fakeRun(t,{failRender:true}),original=f.options.spawn;let returned;
  f.options.spawn=(...args)=>{const result=original(...args);if(f.renders===1){returned=result;fs.writeFileSync(path.join(f.options.output,'slot-01',sink+'.bin'),'preexisting collision');}return result;};
  let failure;try{runAB(f.options);}catch(error){failure=error;}
  assertStopped(f,failure,1,1);assert.equal(failure.cause.code,'EEXIST');assert.equal(failure.rawResult,returned);assert.equal(failure.childError,returned.error);assert.equal(returned.error.code,'ETIMEDOUT');assert.equal(returned.signal,'SIGTERM');assert.equal(failure.record.transport.errorCode,'ETIMEDOUT');assert.equal(failure.record.transport.signal,'SIGTERM');assert.equal(failure.record.evaluation.reason,'transport_failure');
  const other=sink==='stdout'?'stderr':'stdout';assert.equal(failure.record.rawEvidence[sink].saved,false);assert.equal(failure.record.rawEvidence[other].saved,true);assert.deepEqual(fs.readFileSync(path.join(f.options.output,'slot-01',other+'.bin')),returned[other]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.options.output,'slot-01/receipt.json'))).persistenceFailure.evidenceLoss,true);
});
for(const sink of ['stdout','stderr'])test('materialization '+sink+' persistence failure halts before any renderer and preserves available evidence',t=>{
  const f=fakeRun(t),original=f.options.spawn;let returned;
  f.options.spawn=(...args)=>{original(...args);returned={status:null,signal:'SIGTERM',error:Object.assign(Error('materialization timeout'),{code:'ETIMEDOUT'}),stdout:Buffer.from('partial materialization'),stderr:Buffer.from('materialization raw error')};fs.writeFileSync(path.join(f.options.output,'F0-materialize.'+sink+'.bin'),'collision');return returned;};
  let failure;try{runAB(f.options);}catch(error){failure=error;}
  assertStopped(f,failure,0,1);assert.equal(failure.rawResult,returned);assert.equal(failure.childError,returned.error);assert.equal(failure.record.transport.errorCode,'ETIMEDOUT');assert.equal(failure.record.transport.signal,'SIGTERM');const other=sink==='stdout'?'stderr':'stdout';assert.deepEqual(fs.readFileSync(path.join(f.options.output,'F0-materialize.'+other+'.bin')),returned[other]);assert.equal(failure.record.rawEvidence[sink].saved,false);
});
function receiptWriter(file,value,first=false){const pending=first?file:file+'.pending';fs.writeFileSync(pending,JSON.stringify(value,null,2)+'\n',{flag:'wx'});if(!first)fs.renameSync(pending,file);}
for(const sink of ['receipt','budget'])test('post-render '+sink+' persistence failure stops remaining calls while retaining raw timeout and fallback receipt',t=>{
  const f=fakeRun(t,{failRender:true}),original=f.options.spawn;let returned;
  f.options.spawn=(...args)=>{const result=original(...args);if(f.renders===1)returned=result;return result;};
  f.options.writeReceipt=(file,value,first)=>{if(sink==='receipt'?file.endsWith('slot-01/receipt.json')&&value.state==='render-returned':file.endsWith('budget.json')&&value.renderCalls===1)throw Object.assign(Error('synthetic JSON sink error'),{code:'EIO'});receiptWriter(file,value,first);};
  let failure;try{runAB(f.options);}catch(error){failure=error;}
  assertStopped(f,failure,1,1);assert.equal(failure.childError,returned.error);assert.equal(failure.record.transport.errorCode,'ETIMEDOUT');assert.equal(failure.cause.code,'EIO');assert.deepEqual(fs.readFileSync(path.join(f.options.output,'slot-01/stderr.bin')),returned.stderr);assert.deepEqual(fs.readFileSync(path.join(f.options.output,'slot-01/stdout.bin')),returned.stdout);
});
test('prepared receipt failure stops before any child and does not increment actual calls',t=>{
  const f=fakeRun(t);let budgetWrites=0;
  f.options.writeReceipt=(file,value,first)=>{if(file.endsWith('budget.json')&&++budgetWrites===2)throw Object.assign(Error('prepared sink failed'),{code:'EIO'});receiptWriter(file,value,first);};
  let failure;try{runAB(f.options);}catch(error){failure=error;}
  assertStopped(f,failure,0,0);assert.equal(failure.rawResult,null);assert.equal(failure.childError,undefined);
});
const windowsRuntime={node:'24.21.0',modules:'137',platform:'win32',arch:'x64'};
function compiledFixture(t) {
  const tmp=temporary(t),repo=path.join(tmp,'candidate'),compiled=path.join(repo,'.next/standalone'),w=path.join(compiled,'scripts/anydoc-pdf-page-worker.mjs');
  const put=(relative,value)=>{const full=path.join(repo,relative);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(value)+'\n');};
  put('.next/standalone/scripts/anydoc-pdf-page-worker.mjs',fs.readFileSync(worker));put('.next/BUILD_ID','frozenSyntheticBuild\n');put('.next/standalone/.next/BUILD_ID','frozenSyntheticBuild\n');put('.next/standalone/node_modules/better-sqlite3/package.json',{version:'12.6.2'});
  const manifest={schemaVersion:1,node:{major:24,version:'24.21.0',moduleVersion:'137'},platform:'win32',arch:'x64',betterSqlite3Version:'12.6.2'};put('.next/standalone/mediflow-runtime-contract.json',manifest);
  const seal={schemaVersion:1,candidateHead:'eb701348f3a01ccf5051fe3d8a51de1082ef751d',candidateTree:'1deddabbdf1dd2282ea8f63a05c89fd69e6483bc',candidateParents:['a238b47fccce09db9a0a7b3977355266962216ca','df90702a69c8877557d666be81d039d6f88cde7a'],standaloneRelativePath:'.next/standalone',buildId:'frozenSyntheticBuild',runtimeManifestSHA256:digest(fs.readFileSync(path.join(compiled,'mediflow-runtime-contract.json'))),workerSHA256:WORKER_SHA256};put('.next/font-ab-build-identity.json',seal);
  return {tmp,repo,compiled,worker:w,put,manifest,seal};
}
test('Windows binding rejects a matching foreign bundle and symlinked compiled output before any child',t=>{
  const f=compiledFixture(t);assert.equal(verifyCompiledBundle(f.repo,f.worker,windowsRuntime).buildId,'frozenSyntheticBuild');
  const foreign=path.join(f.tmp,'foreign');fs.cpSync(f.compiled,foreign,{recursive:true});const wrong=path.join(foreign,'scripts/anydoc-pdf-page-worker.mjs');assert.equal(digest(fs.readFileSync(wrong)),WORKER_SHA256);assert.throws(()=>verifyCompiledBundle(f.repo,wrong,windowsRuntime),/not the candidate compiled output/);
  let calls=0;const output=path.join(f.tmp,'must-not-be-created');
  assert.throws(()=>runAB({repository:f.repo,worker:wrong,output,mode:'synthetic-bundle-binding-only',corpusRoot:root,spawn:()=>calls++,verify:(repository,worker)=>verifyCompiledBundle(repository,worker,windowsRuntime)}),/not the candidate compiled output/);
  assert.equal(calls,0);assert.equal(fs.existsSync(output),false);
  fs.renameSync(f.compiled,f.compiled+'-original');fs.symlinkSync(foreign,f.compiled);assert.throws(()=>verifyCompiledBundle(f.repo,wrong,windowsRuntime),/Symlink/);
});
test('compiled manifest and build seal reject stale candidate, parents, BUILD_ID, digest, ABI and platform',t=>{
  const mutations=[f=>f.put('.next/standalone/.next/BUILD_ID','stale'),f=>{f.seal.candidateHead='0'.repeat(40);f.put('.next/font-ab-build-identity.json',f.seal);},f=>{f.seal.candidateTree='0'.repeat(40);f.put('.next/font-ab-build-identity.json',f.seal);},f=>{f.seal.candidateParents.reverse();f.put('.next/font-ab-build-identity.json',f.seal);},f=>{f.seal.buildId='stale';f.put('.next/font-ab-build-identity.json',f.seal);},f=>{f.seal.standaloneRelativePath='foreign';f.put('.next/font-ab-build-identity.json',f.seal);},f=>{f.seal.runtimeManifestSHA256='0'.repeat(64);f.put('.next/font-ab-build-identity.json',f.seal);},f=>{f.manifest.node.moduleVersion='138';f.put('.next/standalone/mediflow-runtime-contract.json',f.manifest);},f=>{f.manifest.node.version='24.20.0';f.put('.next/standalone/mediflow-runtime-contract.json',f.manifest);},f=>{f.manifest.arch='arm64';f.put('.next/standalone/mediflow-runtime-contract.json',f.manifest);},f=>{f.manifest.platform='darwin';f.put('.next/standalone/mediflow-runtime-contract.json',f.manifest);},f=>f.put('.next/standalone/node_modules/better-sqlite3/package.json',{version:'0.0.0'})];
  for(const mutate of mutations){const f=compiledFixture(t);mutate(f);assert.throws(()=>verifyCompiledBundle(f.repo,f.worker,windowsRuntime),/mismatch/);}
});
test('missing build seal or symlinked seal fails closed; no implicit activation or receipt creation',t=>{
  const f=compiledFixture(t),seal=path.join(f.repo,'.next/font-ab-build-identity.json'),copy=path.join(f.tmp,'seal.json');fs.copyFileSync(seal,copy);fs.unlinkSync(seal);assert.throws(()=>verifyCompiledBundle(f.repo,f.worker,windowsRuntime),/ENOENT/);assert.equal(fs.existsSync(seal),false);fs.symlinkSync(copy,seal);assert.throws(()=>verifyCompiledBundle(f.repo,f.worker,windowsRuntime),/Symlink/);
});
function disappearAfterFirstRender(f) {
  const original=f.options.spawn;let returned;
  f.options.spawn=(...args)=>{const result=original(...args);if(f.renders===1){returned=result;fs.unlinkSync(f.options.worker);}return result;};
  return ()=>returned;
}
function assertVerificationStopped(f,failure,returned) {
  assert.equal(failure.code,'POST_RENDER_VERIFICATION_FAILED');assert.equal(failure.cause.code,'ENOENT');
  assert.equal(failure.rawResult,returned);assert.equal(failure.childError,returned.error);
  assert.equal(f.renders,1);assert.equal(f.calls.length,2);assert.equal(failure.budget.renderCalls,1);assert.equal(failure.budget.materializeCalls,1);assert.equal(failure.budget.state,'verification-failed');
  assert.equal(failure.record.transport.errorCode,'ETIMEDOUT');assert.equal(failure.record.transport.signal,'SIGTERM');assert.equal(failure.record.childError.code,'ETIMEDOUT');assert.equal(failure.record.evaluation.reason,'transport_failure');assert.equal(failure.record.verificationFailure.error.code,'ENOENT');assert.equal(failure.record.persistenceFailure,undefined);
  assert.equal(failure.record.rawEvidence.stdout.saved,true);assert.equal(failure.record.rawEvidence.stderr.saved,true);
  for(const stream of ['stdout','stderr'])assert.deepEqual(fs.readFileSync(path.join(f.options.output,'slot-01',stream+'.bin')),returned[stream]);
  for(let slot=2;slot<=16;slot++)assert.equal(JSON.parse(fs.readFileSync(path.join(f.options.output,'slot-'+String(slot).padStart(2,'0')+'/receipt.json'))).state,'reserved');
}
test('exact post-render worker read fault saves timeout buffers/transport before ENOENT and halts',t=>{
  const f=fakeRun(t,{failRender:true}),returned=disappearAfterFirstRender(f);let failure;
  try{runAB(f.options);}catch(error){failure=error;}
  assertVerificationStopped(f,failure,returned());
  const slot=JSON.parse(fs.readFileSync(path.join(f.options.output,'slot-01/receipt.json'))),budget=JSON.parse(fs.readFileSync(path.join(f.options.output,'budget.json'))),fallback=JSON.parse(fs.readFileSync(path.join(f.options.output,'verification-failure.json')));
  assert.equal(slot.state,'verification-failed');assert.equal(slot.transport.errorCode,'ETIMEDOUT');assert.equal(slot.verificationFailure.error.code,'ENOENT');assert.equal(budget.renderCalls,1);assert.equal(budget.state,'verification-failed');assert.equal(fallback.record.childError.code,'ETIMEDOUT');assert.equal(fallback.budget.releaseQualified,false);
});
test('differential normal versus post-render read failure preserves identical first child evidence',t=>{
  const normal=fakeRun(t,{failRender:true}),completed=runAB(normal.options);assert.equal(completed.renderCalls,16);
  const normalSlot=JSON.parse(fs.readFileSync(path.join(normal.options.output,'slot-01/receipt.json')));
  const fault=fakeRun(t,{failRender:true}),returned=disappearAfterFirstRender(fault);let failure;
  try{runAB(fault.options);}catch(error){failure=error;}
  assertVerificationStopped(fault,failure,returned());
  assert.deepEqual(failure.record.transport,normalSlot.transport);assert.deepEqual(failure.record.childError,normalSlot.childError);assert.equal(failure.record.evaluation.reason,normalSlot.evaluation.reason);
  for(const stream of ['stdout','stderr'])assert.deepEqual(fs.readFileSync(path.join(fault.options.output,'slot-01',stream+'.bin')),fs.readFileSync(path.join(normal.options.output,'slot-01',stream+'.bin')));
  assert.equal(normalSlot.verificationFailure,undefined);assert.equal(failure.record.verificationFailure.error.code,'ENOENT');
});
test('post-check reporting failure retains pre-check transport journal, raw bytes and actual count',t=>{
  const f=fakeRun(t,{failRender:true}),returned=disappearAfterFirstRender(f);
  f.options.writeReceipt=(file,value,first)=>{if(value.state==='verification-failed'||value.budget?.state==='verification-failed')throw Object.assign(Error('verification reporting sink failed'),{code:'EIO'});receiptWriter(file,value,first);};
  let failure;try{runAB(f.options);}catch(error){failure=error;}
  assertVerificationStopped(f,failure,returned());assert.equal(failure.reportingFailures.length,3);assert.ok(failure.reportingFailures.every(r=>r.error.code==='EIO'));
  const slot=JSON.parse(fs.readFileSync(path.join(f.options.output,'slot-01/receipt.json'))),budget=JSON.parse(fs.readFileSync(path.join(f.options.output,'budget.json')));
  assert.equal(slot.state,'render-returned');assert.equal(slot.transport.errorCode,'ETIMEDOUT');assert.equal(slot.rawEvidence.stderr.saved,true);assert.equal(budget.renderCalls,1);assert.notEqual(budget.state,'completed');assert.equal(fs.existsSync(path.join(f.options.output,'verification-failure.json')),false);
});
