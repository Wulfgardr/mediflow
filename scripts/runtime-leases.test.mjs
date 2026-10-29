import crypto from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createRuntimeLeases, acquireRuntimeLease, recordChildOwner, verifyChildOwner, runtimeProcessIdentity } from './runtime-leases.mjs';
import { initializeWindowsSystemCommand } from './windows-system-command.mjs';
import { containWindowsWeb } from './windows-runtime-job.mjs';
initializeWindowsSystemCommand();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { const end = Date.now()+20000; while (!check()) { assert.ok(Date.now()<end, 'ownership deadline'); await pause(50); } }
function temporary(t) { const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mf-owner-')));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory; }

test('last acknowledged client lease owns idle; manual reuse survives plugin loss', async t => {
 const directory=temporary(t);let idle=0;
 const owner=await createRuntimeLeases({directory,identity:runtimeProcessIdentity,initialPlugin:true,onIdle:()=>idle++});t.after(()=>owner.close());
 const a=new EventEmitter(), b=new EventEmitter();
 await acquireRuntimeLease(owner.receipt,runtimeProcessIdentity,'plugin',a);
 const releaseB=await acquireRuntimeLease(owner.receipt,runtimeProcessIdentity,'plugin',b);
 owner.releaseInitial();a.emit('disconnect');await pause(100);assert.equal(idle,0);assert.equal(owner.active,1);
 await acquireRuntimeLease(owner.receipt,runtimeProcessIdentity,'manual',new EventEmitter());releaseB();await pause(100);assert.equal(idle,0);
 owner.releaseManual();await until(()=>idle===1);assert.equal(owner.active,0);
 await assert.rejects(acquireRuntimeLease(owner.receipt,runtimeProcessIdentity,'plugin',new EventEmitter()));
});
test('nonce and process start are both checked before admitting a lease or allowing a signal', async t => {
 const directory=temporary(t);const owner=await createRuntimeLeases({directory,identity:runtimeProcessIdentity,initialPlugin:true,onIdle:()=>{}});t.after(()=>owner.close());
 await assert.rejects(acquireRuntimeLease({...owner.receipt,owner:{...owner.receipt.owner,nonce:'0'.repeat(36)}},runtimeProcessIdentity));
 await assert.rejects(acquireRuntimeLease({...owner.receipt,owner:{...owner.receipt.owner,start:'other-generation'}},runtimeProcessIdentity));
 const record=recordChildOwner(directory,{pid:process.pid},runtimeProcessIdentity);verifyChildOwner(record);
 fs.writeFileSync(record.file,JSON.stringify({...record.token,nonce:'forged'}));assert.throws(()=>verifyChildOwner(record));
 fs.writeFileSync(record.file,JSON.stringify(record.token));assert.throws(()=>verifyChildOwner({...record,identity:()=> 'recycled-pid'}));
});
test('Windows Web exit drains its Job descendants and frees the process-bound lock', {skip:process.platform!=='win32',timeout:60000},async t=>{
 const directory=temporary(t);let idle=0;
 const owner=await createRuntimeLeases({directory,identity:runtimeProcessIdentity,initialPlugin:true,onIdle:()=>idle++});
 const child=spawn(process.execPath,['--input-type=module','-e',`
 import {spawn} from 'node:child_process';
 process.once('message',()=>{const grandchild=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.send({pid:grandchild.pid},()=>process.exit(0));});`],{stdio:['ignore','ignore','pipe','ipc']});
 const record=recordChildOwner(directory,child,runtimeProcessIdentity);
 const job=await containWindowsWeb(child,record);
 const descendant=new Promise(resolve=>child.once('message',resolve));child.send('start');const {pid}=await descendant;
 await job.closed;await owner.close();
 assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');
 const replacement=await createRuntimeLeases({directory,identity:runtimeProcessIdentity,initialPlugin:true,onIdle:()=>{}});await replacement.close();
 assert.equal(idle,0);t.diagnostic(JSON.stringify({web:child.pid,descendant:pid,jobActive:0,lockReacquired:true}));
});

test('SIGKILL of the first client preserves the second lease; last death closes idle once', async t => {
 const directory=temporary(t);let idle=0;
 const owner=await createRuntimeLeases({directory,identity:runtimeProcessIdentity,initialPlugin:true,onIdle:()=>idle++});t.after(()=>owner.close());
 const clients=[];
 t.after(async()=>{for(const child of clients)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await Promise.all(clients.map(child=>child.exitCode!==null||child.signalCode!==null?null:new Promise(r=>child.once('exit',r))));});
 const source=`
 import {acquireRuntimeLease,runtimeProcessIdentity} from ${JSON.stringify(new URL('./runtime-leases.mjs',import.meta.url).href)};
 import {initializeWindowsSystemCommand} from ${JSON.stringify(new URL('./windows-system-command.mjs',import.meta.url).href)};
 initializeWindowsSystemCommand();await acquireRuntimeLease(JSON.parse(process.argv[1]),runtimeProcessIdentity);process.send('acquired');`;
 for(let i=0;i<2;i++){
  const child=spawn(process.execPath,['--input-type=module','-e',source,JSON.stringify(owner.receipt)],{stdio:['ignore','ignore','inherit','ipc']});clients.push(child);
  await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error(`Client exited ${code}`)));});
 }
 owner.releaseInitial();clients[0].kill('SIGKILL');await until(()=>owner.active===1);assert.equal(idle,0);
 clients[1].kill('SIGKILL');await until(()=>idle===1);assert.equal(owner.active,0);
});


test('disconnect before the lease acknowledgement cannot leave a client registered',async t=>{
 const directory=temporary(t);let idle=0;
 const owner=await createRuntimeLeases({directory,identity:runtimeProcessIdentity,initialPlugin:true,onIdle:()=>idle++});t.after(()=>owner.close());
 const channel=Object.assign(new EventEmitter(),{connected:false});
 await assert.rejects(acquireRuntimeLease(owner.receipt,runtimeProcessIdentity,'plugin',channel),/disconnesso/u);
 owner.releaseInitial();await until(()=>idle===1);assert.equal(owner.active,0);
 await owner.close();await owner.close();
});


test('explicit stop consumes pending idle and each failed retry has one producer', async t => {
 const directory=temporary(t);let idle=0;
 const owner=await createRuntimeLeases({directory,identity:runtimeProcessIdentity,initialPlugin:false,onIdle:()=>idle++});t.after(()=>owner.close());
 owner.releaseManual();
 assert.equal(owner.requestStop(),true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(idle,0,'A queued idle callback must not retry the explicit stop');
 assert.equal(owner.requestStop(),true);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(idle,0);
 await assert.rejects(acquireRuntimeLease(owner.receipt,runtimeProcessIdentity));
});

test('recovery authenticates the owner and endpoint without acquiring or dropping a lease', async t => {
 const {verifyRuntimeReceipt}=await import('./runtime-leases.mjs');
 const directory=temporary(t);let idle=0;
 const binding={choiceUrl:'http://127.0.0.1:12345/private/',dataDir:directory,checkoutPath:directory};
 const owner=await createRuntimeLeases({directory,identity:runtimeProcessIdentity,initialPlugin:false,onIdle:()=>idle++,binding});t.after(()=>owner.close());
 const receipt={pid:owner.receipt.owner.pid,lease:owner.receipt,...binding};
 await verifyRuntimeReceipt(receipt,runtimeProcessIdentity);
 assert.equal(owner.active,1);assert.equal(idle,0);
 for(const forged of [
  {...receipt,lease:{...owner.receipt,owner:{...owner.receipt.owner,nonce:crypto.randomUUID()}}},
  {...receipt,choiceUrl:'http://127.0.0.1:54321/other/'},
  {...receipt,pid:process.pid+1},
  {...receipt,dataDir:directory+'/other'},
 ]) await assert.rejects(verifyRuntimeReceipt(forged,runtimeProcessIdentity));
 assert.equal(owner.active,1);assert.equal(idle,0);
});
