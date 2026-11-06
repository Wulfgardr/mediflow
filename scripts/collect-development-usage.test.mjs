import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { attribution, collectRecords, mergeHistory, codexBarFallback } from './collect-development-usage.mjs';
const git = (cwd,...args) => execFileSync('git',['-C',cwd,...args], {stdio:'ignore'});
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mf-usage-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const repo=path.join(root,'mediflow');fs.mkdirSync(repo);git(repo,'init');git(repo,'remote','add','origin','https://github.com/Wulfgardr/mediflow.git');git(repo,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','fixture');
  const logs=path.join(root,'logs');fs.mkdirSync(logs);
  return {root,repo,logs};
}
test('attribution accepts repository descendants and registered worktrees',t=>{
  const {root,repo}=fixture(t);const nested=path.join(repo,'nested');fs.mkdirSync(nested);
  const wt=path.join(root,'worktree');git(repo,'worktree','add',wt,'-b','fixture');
  const accepts=attribution(repo);git(wt,'remote','remove','origin');
  assert.equal(accepts(wt),true);assert.equal(accepts(nested),true);
});
test('attribution excludes outside paths, misleading prefixes and foreign repositories',t=>{
  const {root,repo}=fixture(t);const accepts=attribution(repo);
  for(const name of ['outside','mediflow-other']){const dir=path.join(root,name);fs.mkdirSync(dir);assert.equal(accepts(dir),false);}
  const foreign=path.join(root,'foreign');fs.mkdirSync(foreign);git(foreign,'init');git(foreign,'remote','add','origin','https://github.com/other/mediflow.git');
  assert.equal(accepts(foreign),false);assert.equal(accepts(root),false);
});
test('deleted checkout requires matching Git session provenance and a directory boundary',t=>{
  const {root,repo}=fixture(t);const accepts=attribution(repo),cwd=path.join(root,'deleted');
  const meta={cwd,git:{repository_url:'git@github.com:Wulfgardr/mediflow_private.git'}};
  assert.equal(accepts(path.join(cwd,'scripts'),meta),true);
  assert.equal(accepts(cwd),false);assert.equal(accepts(cwd+'-other',meta),false);
  assert.equal(accepts(cwd,{...meta,git:{repository_url:'https://github.com/other/mediflow.git'}}),false);
});
async function sample(t) {
  const {repo,logs}=fixture(t);
  const meta={type:'session_meta',payload:{id:'session',cwd:repo,originator:'T3 Code'}};
  const context={type:'turn_context',payload:{cwd:repo,model:'gpt-6.1-sol',effort:'high'}};
  const event=n=>({timestamp:'2026-11-01T12:00:00Z',type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{total_tokens:n,cached_input_tokens:n-10},last_token_usage:{total_tokens:50}}}});
  const rows=[meta,context,event(50),event(50),event(100)];
  for(const file of ['one.jsonl','copy.jsonl'])fs.writeFileSync(path.join(logs,file),rows.map(JSON.stringify).join('\n'));
  const response={type:'assistant',cwd:repo,timestamp:'2026-11-01T12:00:00Z',requestId:'request',message:{id:'response',model:'claude-opus-5-5',usage:{input_tokens:2,output_tokens:3,cache_read_input_tokens:4,cache_creation_input_tokens:5}}};
  fs.writeFileSync(path.join(logs,'claude.jsonl'),[response,response].map(JSON.stringify).join('\n'));
  return (await collectRecords({codex:[logs],claude:[logs]},attribution(repo))).records;
}
test('Codex cumulative events, repeated events and copied T3 sessions count once',async t=>{
  const records=await sample(t);assert.equal(records.filter(r=>r.environment==='codex').reduce((n,r)=>n+r.tokens,0),100);
  assert.equal(records.filter(r=>r.environment==='codex').reduce((n,r)=>n+r.cache,0),90);
});
test('Claude responses deduplicate by response and request; cache creation is included',async t=>{
  const records=await sample(t);assert.deepEqual(records.filter(r=>r.environment==='claude').map(r=>r.tokens),[14]);
});
test('public aggregation strips local identifiers and preserves historical rows without overlap',async t=>{
  const base=JSON.parse(fs.readFileSync(new URL('../docs/data/development-usage-2026-09-27.json',import.meta.url)));
  const records=await sample(t);records.push({...records[0],date:'2026-09-27',tokens:999});
  const result=mergeHistory(base,records,'2026-11-06');
  for(const series of ['history','effort']) assert.deepEqual(result[series].filter(r=>r.date<=base.snapshotDate).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),[...base[series]].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  assert.equal(result.environments[0].totalTokens-base.environments[0].totalTokens,100);
  assert.doesNotMatch(JSON.stringify(result),/\/Users\/|\.jsonl|"session"|"request"|"response"|cwd|logs/);
});
test('CodexBar fallback verifies source directories and excludes overlapping raw days',()=>{
  const source={path:'/verified',daily:[{date:'2026-11-01',cacheReadTokens:4,modelBreakdowns:[{modelName:'gpt-6.1-sol',totalTokens:10}]}]};
  const report=[{projects:[{sources:[source,{...source,path:'/foreign'}]}]}];
  assert.equal(codexBarFallback(report,[],cwd=>cwd==='/verified').reduce((n,r)=>n+r.tokens,0),10);
  assert.deepEqual(codexBarFallback(report,[{environment:'codex',date:'2026-11-01'}],()=>true),[]);
});
