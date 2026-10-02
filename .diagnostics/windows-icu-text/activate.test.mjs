import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {checkContext,parseCommit,record,collect,prepare} from './activate.mjs';
const context={GITHUB_REPOSITORY:'Wulfgardr/mediflow',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/diagnostic/windows-icu-text-20261002',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123'};
const event={created:true,forced:false,deleted:false,before:'0'.repeat(40),after:context.GITHUB_SHA,ref:context.GITHUB_REF};
function fixture(t){const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'mediflow-icu-activation-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const input=path.join(root,'receipts'),output=path.join(root,'upload');fs.mkdirSync(input);fs.writeFileSync(path.join(input,'prepare.json'),JSON.stringify({releaseQualified:false,runId:'123'}));return {root,input,output};}
test('accepts exactly creation push attempt1 and rejects update/force/rerun/context drift',()=>{
 assert.deepEqual(checkContext(context,event),{diagnosticSHA:context.GITHUB_SHA,runId:'123'});
 for(const [env,body] of [[{...context,GITHUB_RUN_ATTEMPT:'2'},event],[{...context,GITHUB_REPOSITORY:'Synthetic/fork'},event],[{...context,GITHUB_EVENT_NAME:'workflow_dispatch'},event],[context,{...event,created:false}],[context,{...event,forced:true}],[context,{...event,deleted:true}],[context,{...event,before:'b'.repeat(40)}],[context,{...event,after:'b'.repeat(40)}],[{...context,GITHUB_REF:'refs/heads/main'},event]])assert.throws(()=>checkContext(env,body),/creation push/);
});
test('raw commit headers preserve ordered parents even in shallow-view/CRLF form',()=>{
 const tree='a'.repeat(40),parent='b'.repeat(40);assert.deepEqual(parseCommit(`tree ${tree}\r\nparent ${parent}\r\nauthor Synthetic\r\n\r\nmessage`),{tree,parents:[parent]});
 assert.deepEqual(parseCommit(`tree ${tree}\nparent ${parent}\nparent ${tree}\n\nmessage`).parents,[parent,tree]);
});
test('phase records preserve native-sized exit, reject invalid phase and duplicate write',t=>{
 const f=fixture(t);record(f.input,'observation',3221225501);assert.equal(JSON.parse(fs.readFileSync(path.join(f.input,'observation-exit.json'))).exitCode,3221225501);
 assert.throws(()=>record(f.input,'observation',0),/exist/);assert.throws(()=>record(f.input,'unknown',0),/invalid/);assert.throws(()=>record(f.input,'compile',NaN),/invalid/);
});
test('partial failure collection retains both raw streams byte-exact with nonqualification',t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.input,'observation'));const stdout=Buffer.from([0,1,2]),stderr=Buffer.from('Synthetic native assertion');
 fs.writeFileSync(path.join(f.input,'observation/stdout.bin'),stdout);fs.writeFileSync(path.join(f.input,'observation/stderr.bin'),stderr);
 const result=collect(f.input,f.output);assert.equal(result.evidenceLoss,false);assert.equal(result.releaseQualified,false);assert.ok(fs.readFileSync(path.join(f.output,'observation/stdout.bin')).equals(stdout));assert.ok(fs.readFileSync(path.join(f.output,'observation/stderr.bin')).equals(stderr));
});
test('missing raw partner records evidence loss while preserving the stream available',t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.input,'observation'));fs.writeFileSync(path.join(f.input,'observation/stdout.bin'),Buffer.from([1]));
 const result=collect(f.input,f.output);assert.equal(result.evidenceLoss,true);assert.equal(fs.readFileSync(path.join(f.output,'observation/stdout.bin')).length,1);
});
test('unexpected file and symlink are denied while permitted raw survives',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.input,'unexpected-secret.txt'),'SYNTHETIC');fs.symlinkSync(path.join(f.input,'prepare.json'),path.join(f.input,'compile-exit.json'));
 const result=collect(f.input,f.output);assert.equal(result.evidenceLoss,true);assert.equal(fs.existsSync(path.join(f.output,'unexpected-secret.txt')),false);assert.equal(fs.existsSync(path.join(f.output,'compile-exit.json')),false);assert.equal(fs.existsSync(path.join(f.output,'prepare.json')),true);
});
test('oversized JSON is not truncated into evidence',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.input,'compile-exit.json'),Buffer.alloc(262145));const result=collect(f.input,f.output);assert.equal(result.evidenceLoss,true);assert.equal(fs.existsSync(path.join(f.output,'compile-exit.json')),false);
});
test('missing and symlinked receipt roots retain explicit failure receipts',t=>{
 const f=fixture(t),link=path.join(f.root,'linked');fs.symlinkSync(f.input,link);assert.equal(collect(link,f.output).evidenceLoss,true);assert.equal(collect(path.join(f.root,'absent'),path.join(f.root,'second')).evidenceLoss,true);
});
test('probe evidence-loss flag is preserved even when both raw files exist',t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.input,'observation'));for(const name of ['stdout.bin','stderr.bin'])fs.writeFileSync(path.join(f.input,'observation',name),Buffer.alloc(0));fs.writeFileSync(path.join(f.input,'observation/receipt.json'),JSON.stringify({evidenceLoss:true}));assert.equal(collect(f.input,f.output).evidenceLoss,true);
});
test('non-Windows producer rejects prepare before invoking any build/native/probe',()=>{
 if(process.platform!=='win32')assert.throws(()=>prepare('unused','unused'),/Exact Windows runtime required/);
});
