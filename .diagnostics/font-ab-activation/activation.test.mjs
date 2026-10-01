import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { BRANCH,CANDIDATE,REVIEWED_PATCH,PINS_SHA256,candidateIdentity,checkContext,verifySources,prepare,recordPhase,beginCompile,seal,claimObservation,collect } from './activation.mjs';
import { verifyCompiledBundle,WORKER_SHA256 } from '../font-ab/run-ab.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),SOURCE=path.resolve(HERE,'../font-ab'),NODE=process.execPath;
const WINDOWS={node:'24.21.0',modules:'137',platform:'win32',arch:'x64'};
const worker=fs.realpathSync(process.env.FONT_AB_TEST_WORKER),sha=b=>createHash('sha256').update(b).digest('hex');
const diag='f'.repeat(40),env={GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/'+BRANCH,GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'123',GITHUB_SHA:diag};
const event={ref:env.GITHUB_REF,created:true,deleted:false,forced:false,before:'0'.repeat(40),after:diag};
const header='tree '+CANDIDATE.tree+'\n'+CANDIDATE.parents.map(p=>'parent '+p+'\n').join('')+'author Synthetic <synthetic@example.invalid> 1 +0000\n\nbody';
const fakeGit=args=>args[0]==='status'?'':args[0]==='cat-file'?header:args[1]==='HEAD^{tree}'?CANDIDATE.tree:CANDIDATE.head;
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'font-ab-activation-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function fixture(t){const root=temp(t),candidate=path.join(root,'candidate'),receipts=path.join(root,'receipts');fs.mkdirSync(candidate);const put=(relative,value)=>{const full=path.join(candidate,relative);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(value)+'\n');};
  put('.nvmrc','24\r\n');put('package.json',{engines:{node:'>=24 <25'},scripts:{prebuild:'node scripts/node-runtime-contract.mjs verify',build:'next build',postbuild:'node scripts/node-runtime-contract.mjs write-standalone-manifest && node scripts/check-standalone-runtime-bundle.mjs'}});
  const options={candidate,receipts,diagnostic:root,env:{...env},event:{...event},git:fakeGit,diagnosticGit:args=>args[0]==='status'?'':diag,selectedRuntime:WINDOWS,source:SOURCE};return {root,candidate,receipts,put,options};
}
async function compiledFixture(t){const f=fixture(t);await prepare(f.options);recordPhase(f.receipts,'install',0);beginCompile(f.options);recordPhase(f.receipts,'prebuild',0);
  f.put('.next/BUILD_ID','syntheticExactBuild\n');f.put('.next/standalone/.next/BUILD_ID','syntheticExactBuild\n');f.put('.next/standalone/scripts/anydoc-pdf-page-worker.mjs',fs.readFileSync(worker));f.put('.next/standalone/node_modules/better-sqlite3/package.json',{version:'12.6.2'});f.put('.next/standalone/mediflow-runtime-contract.json',{schemaVersion:1,node:{major:24,version:'24.21.0',moduleVersion:'137'},platform:'win32',arch:'x64',betterSqlite3Version:'12.6.2'});recordPhase(f.receipts,'compile',0);recordPhase(f.receipts,'manifest',0);f.options.check=(candidate,worker,runtime)=>verifyCompiledBundle(candidate,worker,runtime);return f;
}
test('only exact new-branch push attempt1 and matching diagnostic SHA accepted',()=>{
  assert.equal(checkContext(env,event,diag).attempt,1);
  for(const change of [e=>e.GITHUB_REF='refs/heads/main',e=>e.GITHUB_EVENT_NAME='workflow_dispatch',e=>e.GITHUB_RUN_ATTEMPT='2',e=>e.GITHUB_SHA='a'.repeat(40)]){const modified={...env};change(modified);assert.throws(()=>checkContext(modified,event,diag));}
  for(const change of [e=>e.created=false,e=>e.deleted=true,e=>e.forced=true,e=>e.before='a'.repeat(40),e=>e.after='a'.repeat(40)]){const modified={...event};change(modified);assert.throws(()=>checkContext(env,modified,diag));}
});
test('raw commit-header parser accepts CRLF/shallow form and rejects wrong/reversed/missing parents',()=>{
  assert.deepEqual(candidateIdentity('.',fakeGit),CANDIDATE);
  assert.deepEqual(candidateIdentity('.',args=>args[0]==='cat-file'?header.replaceAll('\n','\r\n'):fakeGit(args)),CANDIDATE);
  for(const bad of [header.replace(CANDIDATE.parents[0],CANDIDATE.parents[1]),header.replace('parent '+CANDIDATE.parents[0]+'\n',''),header.replace('parent '+CANDIDATE.parents[0]+'\nparent '+CANDIDATE.parents[1],'parent '+CANDIDATE.parents[1]+'\nparent '+CANDIDATE.parents[0])])assert.throws(()=>candidateIdentity('.',args=>args[0]==='cat-file'?bad:fakeGit(args)),/mismatch/);
  assert.throws(()=>candidateIdentity('.',args=>args[0]==='rev-parse'&&args[1]==='HEAD'?'0'.repeat(40):fakeGit(args)),/mismatch/);
  assert.throws(()=>candidateIdentity('.',args=>args[0]==='rev-parse'&&args[1]==='HEAD^{tree}'?'0'.repeat(40):fakeGit(args)),/mismatch/);
  assert.deepEqual(candidateIdentity('.',args=>args[0]==='cat-file'?header+'\nparent '+'a'.repeat(40):fakeGit(args)),CANDIDATE);
});
test('exact identity is readable in a real shallow Git object view when %P is empty',t=>{
  const repo=temp(t),objects=process.env.FONT_AB_TEST_GIT_OBJECTS;assert.ok(objects);execFileSync('git',['init','-q',repo]);fs.writeFileSync(path.join(repo,'.git/objects/info/alternates'),fs.realpathSync(objects)+'\n');execFileSync('git',['-C',repo,'update-ref','refs/heads/frozen',CANDIDATE.head]);execFileSync('git',['-C',repo,'symbolic-ref','HEAD','refs/heads/frozen']);fs.writeFileSync(path.join(repo,'.git/shallow'),CANDIDATE.head+'\n');
  assert.equal(execFileSync('git',['-C',repo,'show','-s','--format=%P','HEAD'],{encoding:'utf8'}).trim(),'');assert.deepEqual(candidateIdentity(repo),CANDIDATE);
});
test('39 reviewed source files and LF/corpus pins reject code/assets/CRLF tampering',t=>{
  assert.equal(verifySources().reviewedSourcePatchSHA256,REVIEWED_PATCH);assert.equal(verifySources().sourcePinsSHA256,PINS_SHA256);
  const root=temp(t);for(const file of ['run-ab.mjs','corpus.json','probe/pdf-phase-preload.mjs']){const copy=path.join(root,file.replaceAll('/','-'));fs.cpSync(SOURCE,copy,{recursive:true});fs.appendFileSync(path.join(copy,file),'\r\n');assert.throws(()=>verifySources(copy),/mismatch/);}
});
test('prepare/beginCompile require fresh output, exact lifecycle, clean source and supported runtime',async t=>{
  const f=fixture(t);await prepare(f.options);recordPhase(f.receipts,'install',0);beginCompile(f.options);assert.equal(JSON.parse(fs.readFileSync(path.join(f.receipts,'compile-claim.json'))).priorRendererCalls,0);assert.throws(()=>beginCompile(f.options),/exist/);
  const stale=fixture(t);stale.put('.next/BUILD_ID','old');await assert.rejects(prepare(stale.options),/already exists/);
  const wrong=fixture(t);wrong.put('package.json',{engines:{node:'>=24 <25'},scripts:{build:'npm run build'}});await assert.rejects(prepare(wrong.options),/lifecycle/);
  const dirty=fixture(t);await assert.rejects(prepare({...dirty.options,git:args=>args[0]==='status'?' M package.json':fakeGit(args)}),/clean/);
  const node=fixture(t);await assert.rejects(prepare({...node.options,selectedRuntime:{...WINDOWS,node:'26.0.0'}}),/Exact Windows/);
});
test('seal binds exact successful fresh compilation, manifest, worker and reviewed source',async t=>{
  const f=await compiledFixture(t),result=await seal(f.options);assert.equal(result.candidateHead,CANDIDATE.head);assert.equal(result.workerSHA256,WORKER_SHA256);assert.equal(result.runtimeManifestSHA256,sha(fs.readFileSync(path.join(f.candidate,'.next/standalone/mediflow-runtime-contract.json'))));assert.equal(JSON.parse(fs.readFileSync(path.join(f.receipts,'seal-receipt.json'))).reviewedSourcePatchSHA256,REVIEWED_PATCH);
  await assert.rejects(seal(f.options),/exist/);recordPhase(f.receipts,'seal',0);await claimObservation(f.options);await assert.rejects(claimObservation(f.options),/exist/);
});
test('failed/missing compile or manifest, mismatched IDs and source drift forbid seal',async t=>{
  for(const phase of ['compile','manifest']){const f=await compiledFixture(t);fs.unlinkSync(path.join(f.receipts,phase+'-exit.json'));recordPhase(f.receipts,phase,1);await assert.rejects(seal(f.options),/successful phase/);assert.equal(fs.existsSync(path.join(f.candidate,'.next/font-ab-build-identity.json')),false);}
  const f=await compiledFixture(t);f.put('.next/standalone/.next/BUILD_ID','wrong');await assert.rejects(seal(f.options),/IDs differ/);
  const missing=await compiledFixture(t);fs.unlinkSync(path.join(missing.receipts,'compile-claim.json'));await assert.rejects(seal(missing.options),/ENOENT/);
  const drift=await compiledFixture(t),copy=path.join(drift.root,'source-copy');fs.cpSync(SOURCE,copy,{recursive:true});fs.appendFileSync(path.join(copy,'run-ab.mjs'),'tampered');await assert.rejects(seal({...drift.options,source:copy}),/mismatch/);assert.equal(fs.existsSync(path.join(drift.candidate,'.next/font-ab-build-identity.json')),false);
});
test('claim rejects changed/missing seal or existing observation before any renderer',async t=>{
  const f=await compiledFixture(t);await seal(f.options);recordPhase(f.receipts,'seal',0);fs.appendFileSync(path.join(f.candidate,'.next/font-ab-build-identity.json'),' ');await assert.rejects(claimObservation(f.options),/seal changed/);
  const reused=await compiledFixture(t);await seal(reused.options);recordPhase(reused.receipts,'seal',0);fs.mkdirSync(path.join(reused.receipts,'observation'));await assert.rejects(claimObservation(reused.options),/already exists/);
});
test('raw, partial pending JSON and reserved slots are retained byte-identically; aggregate is bounded',t=>{
  const root=temp(t),receipts=path.join(root,'receipts'),upload=path.join(root,'upload');fs.mkdirSync(path.join(receipts,'observation/slot-01'),{recursive:true});const stdout=Buffer.from([0,1,2,255]),stderr=Buffer.from('raw ETIMEDOUT');fs.writeFileSync(path.join(receipts,'observation/slot-01/stdout.bin'),stdout);fs.writeFileSync(path.join(receipts,'observation/slot-01/stderr.bin'),stderr);fs.writeFileSync(path.join(receipts,'observation/budget.json.pending'),'{"partial":');const result=collect(receipts,upload);assert.equal(result.files.length,3);assert.deepEqual(fs.readFileSync(path.join(upload,'observation/slot-01/stdout.bin')),stdout);assert.deepEqual(fs.readFileSync(path.join(upload,'observation/slot-01/stderr.bin')),stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(upload,'retention.json'))).releaseQualified,false);assert.throws(()=>collect(receipts,path.join(root,'too-small'),4),/aggregate bound/);
});
test('collector refuses unknown files/symlinks and reports evidence loss; missing setup remains nonqualifying',t=>{
  const root=temp(t),receipts=path.join(root,'receipts');fs.mkdirSync(receipts);fs.writeFileSync(path.join(receipts,'unexpected.db'),'not authorized');assert.throws(()=>collect(receipts,path.join(root,'unknown')),/Unexpected/);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'unknown/retention.json'))).evidenceLoss,true);fs.unlinkSync(path.join(receipts,'unexpected.db'));fs.symlinkSync(worker,path.join(receipts,'activation.json'));assert.throws(()=>collect(receipts,path.join(root,'symlink')),/symlink/);collect(path.join(root,'missing'),path.join(root,'empty'));assert.equal(JSON.parse(fs.readFileSync(path.join(root,'empty/retention.json'))).sourceMissing,true);
});

test('CLI phase receipts resolve the same relative paths used by candidate working-directory steps',async t=>{
  const f=fixture(t);await prepare(f.options);execFileSync(NODE,[path.join(HERE,'activation.mjs'),'record','../receipts','install','0'],{cwd:f.candidate});assert.equal(JSON.parse(fs.readFileSync(path.join(f.receipts,'install-exit.json'))).exitCode,0);
});
