/* @Codex */
// Synthetic codec experiment only. No application dispatcher or database imports.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { platform, arch, release } from 'node:os';
import { decodePortableSupervisorWebIpcFrameV1, encodePortableSupervisorWebIpcFrameV1 } from '../../packages/aip/src/portable-supervisor-web-ipc-contract.ts';

const HERE = fileURLToPath(import.meta.url);
const MAX = 4096;
const frame = (bytes) => { const h = Buffer.alloc(4); h.writeUInt32LE(bytes.length); return Buffer.concat([h, bytes]); };
function oracle(bytes) {
  // Preserve a leading BOM so the original string decoder can reject it.
  try { const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); decodePortableSupervisorWebIpcFrameV1(text); return { ok: true, canonical: text }; }
  catch (e) { return { ok: false, error: e.code === 'frame_too_large' ? e.code : 'frame_invalid' }; }
}
function nodeWorker() {
  let pending = Buffer.alloc(0), expected = null, stopped = false;
  const send = (r) => process.stdout.write(frame(Buffer.from(JSON.stringify(r))));
  process.stdin.on('data', (chunk) => {
    if (stopped) return;
    // The test parent sends one bounded request at a time. Reject oversized chunks as well.
    if (pending.length + chunk.length > MAX + 4) { stopped = true; send({ok:false,error:'frame_too_large'}); process.stdin.destroy(); return; }
    pending = Buffer.concat([pending, chunk]);
    if (expected === null && pending.length >= 4) {
      expected = pending.readUInt32LE(); pending = pending.subarray(4);
      if (expected > MAX) { stopped = true; send({ok:false,error:'frame_too_large'}); process.stdin.destroy(); return; }
    }
    if (expected !== null && pending.length === expected) { send(oracle(pending)); pending = Buffer.alloc(0); expected = null; }
  });
  process.stdin.on('end', () => { if (!stopped && (pending.length || expected !== null)) send({ok:false,error:'frame_invalid'}); });
}
const nodeCommand = [process.execPath, ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', HERE, '--node-worker']];

function client(command) {
  const child = spawn(command[0], command[1], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
  let buffer = Buffer.alloc(0), pending = null, errorText = '', closed = false;
  const done = new Promise((resolveDone) => child.once('close', (code, signal) => { closed = true; if (pending) { clearTimeout(pending.timer); pending.reject(new Error(`child closed ${code}/${signal}`)); pending = null; } resolveDone({code,signal}); }));
  child.on('error', (e) => { if (pending) { clearTimeout(pending.timer); pending.reject(e); pending = null; } });
  child.stdin.on('error', () => {});
  child.stderr.on('data', (b) => { errorText += b.toString(); if (errorText.length > 8192) child.kill(); });
  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 16384 || (buffer.length >= 4 && buffer.readUInt32LE() > 8192)) { child.kill(); return; }
    if (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE()) {
      const size = buffer.readUInt32LE(); const body = buffer.subarray(4,4+size); buffer = buffer.subarray(4+size);
      if (!pending) { child.kill(); return; }
      const p = pending; pending = null; clearTimeout(p.timer);
      try { p.resolve(JSON.parse(body.toString('utf8'))); } catch (e) { p.reject(e); }
    }
  });
  return {
    async request(bytes) {
      assert.equal(pending, null, 'one outstanding request'); assert.equal(closed, false);
      return new Promise((resolveReply,reject) => {
        pending = {resolve:resolveReply,reject,timer:setTimeout(() => {pending=null;child.kill();reject(new Error('bounded child timeout'));},2000)};
        child.stdin.write(frame(bytes));
      });
    },
    async close() {
      child.stdin.end(); const timer=setTimeout(()=>child.kill('SIGKILL'),2000);
      const result=await done; clearTimeout(timer); assert.equal(result.code,0,`child closure ${JSON.stringify(result)} ${errorText}`); assert.equal(buffer.length,0); return result;
    },
  };
}
function vectors() {
  const schemaVersion='mediflow.portable-supervisor.web-ipc.v1'; const requestRef=`pswr_${'1'.repeat(32)}`; const challenge=`pswc_${'2'.repeat(64)}`;
  const capture={schemaVersion:'mediflow.portable-supervisor.web-capture.v1',userRef:`user.${'3'.repeat(64)}`,parentRef:`parent.${'4'.repeat(64)}`,patientId:'patient.synthetic.01',ambulatoryId:'ambulatory.synthetic.01',selectionEpoch:7,expectedPatientVersion:3,expiresAt:10000};
  const positive=[{schemaVersion,method:'prepare',requestRef},{schemaVersion,method:'activate',requestRef,challenge,capture},{schemaVersion,method:'revoke_all',requestRef,reason:'application_lock'},{schemaVersion,method:'ack',requestRef,outcome:'prepared',challenge,expiresAt:5000},{schemaVersion,method:'ack',requestRef,outcome:'activated',expiresAt:10000},{schemaVersion,method:'ack',requestRef,outcome:'revoked'},{schemaVersion,method:'ack',requestRef,outcome:'denied',denialCode:'challenge_invalid'}];
  for(const reason of ['logout','application_lock','reselection','expiry','web_disconnect','mcp_disconnect','restart','explicit'])positive.push({...positive[2],reason});
  for(const denialCode of ['protocol_invalid','frame_too_large','replayed','challenge_invalid','challenge_expired','context_invalid','context_stale','already_bound','host_unavailable','activation_failed','revoke_failed','timeout'])positive.push({...positive[6],denialCode});
  for(const n of [0,1,9007199254740991])positive.push({...positive[1],capture:{...capture,selectionEpoch:n,expectedPatientVersion:Math.max(1,n),expiresAt:Math.max(1,n)}});
  positive.push({...positive[1],capture:{...capture,patientId:'a'.repeat(128),ambulatoryId:'Z.0_:-'}});
  const out=positive.map((value,i)=>({name:`positive-${i}`,bytes:Buffer.from(encodePortableSupervisorWebIpcFrameV1(value)),positive:true}));
  const first=out[0].bytes.toString(); const activation=out[1].bytes.toString();
  const negative=['', 'null','[]','true','{}',' '+first,first+'\n',first+' ',first.replace('"method":"prepare",','"method":"prepare","method":"prepare",'),JSON.stringify({method:'prepare',schemaVersion,requestRef}),first.replace('"method"','"extra"'),first.replace('prepare','dispatch'),first.replace('pswr_','PSWR_'),activation.replace('"selectionEpoch":7','"selectionEpoch":-0'),activation.replace('"selectionEpoch":7','"selectionEpoch":7.0'),activation.replace('"selectionEpoch":7','"selectionEpoch":7e0'),activation.replace('"selectionEpoch":7','"selectionEpoch":9007199254740992'),activation.replace('"expectedPatientVersion":3','"expectedPatientVersion":0'),activation.replace('patient.synthetic.01','é'),activation.replace('patient.synthetic.01','a'.repeat(129)),first.replace('prepare','prepa\\u0072e'),'x'.repeat(4096), '[[[[[[[', first.slice(0,-1), first+'{}'];
  negative.forEach((s,i)=>out.push({name:`negative-${i}`,bytes:Buffer.from(s),positive:false}));
  out.push({name:'negative-leading-bom',bytes:Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),out[0].bytes]),positive:false});
  let seed=706; const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let i=0;i<256;i++) { const b=Buffer.from(out[i%positive.length].bytes); b[next()%b.length]=32+(next()%95);out.push({name:`mutation-${i}`,bytes:b}); }
  return out;
}
function summary(values) {
  const sorted=[...values].sort((a,b)=>a-b); const mean=values.reduce((a,b)=>a+b,0)/values.length;
  return {n:values.length,p50Ms:sorted[Math.ceil(sorted.length*.5)-1],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],minMs:sorted[0],maxMs:sorted.at(-1),meanMs:mean,sdMs:Math.sqrt(values.reduce((s,x)=>s+(x-mean)**2,0)/values.length)};
}
function single(command, input) {
  const r=spawnSync(command[0],command[1],{input,timeout:2500,maxBuffer:16384,env:{PATH:process.env.PATH}});
  assert.ifError(r.error);assert.equal(r.status,0,String(r.stderr));assert.ok(r.stdout.length>=4);const length=r.stdout.readUInt32LE();assert.equal(r.stdout.length,length+4);return JSON.parse(r.stdout.subarray(4).toString());
}
async function main() {
  assert.ok(process.argv[2], 'usage: compare.mjs <rust-binary> <output.json>');
  const rustCommand=[resolve(process.argv[2]),[]]; const cases=vectors();
  const rust=client(rustCommand);let accepted=0,rejected=0;
  try {
    for(const v of cases) {const expected=oracle(v.bytes); if(v.positive!==undefined)assert.equal(expected.ok,v.positive,v.name);const actual=await rust.request(v.bytes);assert.deepEqual(actual,expected,v.name); if(expected.ok)accepted++;else rejected++;}
  } finally {await rust.close();}
  // Separate binary framing checks: malformed UTF-8 has no equivalent JS string input.
  assert.deepEqual(single(rustCommand,frame(Buffer.from([0xff]))),{ok:false,error:'frame_invalid'});
  assert.deepEqual(single(rustCommand,Buffer.from([1,0])),{ok:false,error:'frame_invalid'});
  assert.deepEqual(single(rustCommand,Buffer.from([3,0,0,0,123])),{ok:false,error:'frame_invalid'});
  const oversized=Buffer.alloc(4);oversized.writeUInt32LE(4097);
  assert.deepEqual(single(rustCommand,oversized),{ok:false,error:'frame_too_large'});
  const workload=cases.slice(0,7).map(x=>x.bytes); const inProcess=[];let checksum=0;
  for(let i=0;i<7000;i++){const t=performance.now();const r=oracle(workload[i%7]);const elapsed=performance.now()-t;assert.ok(r.ok);checksum+=r.canonical.length;if(i>=1400)inProcess.push(elapsed);}
  const warm={node:[],rust:[]};const clients={node:client(nodeCommand),rust:client(rustCommand)};
  try {
    for(let i=0;i<1200;i++) for(const kind of (i%2?['rust','node']:['node','rust'])) {const b=workload[i%7];const t=performance.now();const reply=await clients[kind].request(b);const elapsed=performance.now()-t;assert.deepEqual(reply,oracle(b));if(i>=200)warm[kind].push(elapsed);}
  } finally {await clients.node.close();await clients.rust.close();}
  const cold={node:[],rust:[]};
  for(let i=0;i<12;i++)for(const kind of (i%2?['rust','node']:['node','rust'])){const t=performance.now();assert.deepEqual(single(kind==='node'?nodeCommand:rustCommand,frame(workload[0])),oracle(workload[0]));cold[kind].push(performance.now()-t);}
  const hash=(p)=>createHash('sha256').update(readFileSync(p)).digest('hex');
  const report={schema:'mediflow.rust-codec-experiment.v1',at:new Date().toISOString(),platform:platform(),arch:arch(),osRelease:release(),node:process.version,syntheticOnly:true,source:{path:'packages/aip/src/portable-supervisor-web-ipc-contract.ts',sha256:hash(new URL('../../packages/aip/src/portable-supervisor-web-ipc-contract.ts',import.meta.url))},rustBinary:{sha256:hash(rustCommand[0]),bytes:statSync(rustCommand[0]).size},equivalence:{cases:cases.length,accepted,rejected,binaryFramingNegatives:4,seed:706},workloadBytes:workload.map(b=>b.length),timings:{typescriptInProcess:summary(inProcess),nodeWarmPipe:summary(warm.node),rustWarmPipe:summary(warm.rust),nodeColdSpawnOneFrameExit:summary(cold.node),rustColdSpawnOneFrameExit:summary(cold.rust)},checksum,limits:['wire decoder parity only; not JS object encoder traps or authorization','macOS development binaries, no installed app or Windows/Linux qualification','cold Node includes TS module transform; Rust optimized release; not application startup','RSS/CPU/FFI not measured','no workload C02 acceptance or product performance claim'],childClosures:'direct children exited code0; no child descendants created by these codecs'};
  writeFileSync(resolve(process.argv[3]??'codec-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
if(process.argv[2]==='--node-worker')nodeWorker();else await main();
