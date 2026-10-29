import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
const root = process.env.MEDIFLOW_LIFECYCLE_ROOT || process.cwd();
const pause = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(fn, ms = 15000) { const end = Date.now()+ms; while (!await fn()) { assert.ok(Date.now()<end, 'lifecycle deadline'); await pause(100); } }
const table = () => execFileSync('ps', ['-axo','pid=,ppid=,command='], {encoding:'utf8'}).trim().split('\n').map(line => { const [,pid,ppid,command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); return {pid:+pid,ppid:+ppid,command}; });
test('real standalone: repeated starts reuse one Web and owner loss leaves zero processes', {skip: process.platform==='win32' || !process.env.MEDIFLOW_LIFECYCLE_REAL, timeout:120000}, async t => {
 const data=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mf-lifecycle-'))), owned=new Set(), children=[];
 t.after(async()=>{ for(const c of children) if(alive(c.pid)) c.kill('SIGTERM'); await pause(1000); for(const pid of owned) if(alive(pid)) process.kill(pid,'SIGKILL'); await until(()=>[...owned].every(pid=>!alive(pid))); fs.rmSync(data,{recursive:true,force:true}); });
 for(const ending of ['disconnect','SIGKILL']) {
  const port=await new Promise(resolve=>{const s=net.createServer(); s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  let output='';
  const launch=(ipc)=>{const c=spawn(process.execPath,[path.join(root,'scripts/mediflow.mjs'),'--riusa','--scelta','web','--senza-browser'],{cwd:root,env:{...process.env,MEDIFLOW_DATA_DIR:data,PORT:String(port)},stdio:['ignore','pipe','pipe',...(ipc?['ipc']:[])]});children.push(c);owned.add(c.pid);c.stdout.on('data',b=>output+=b);c.stderr.on('data',b=>output+=b);return c;};
  const owner=launch(true); await until(()=>output.includes('Pronto:'),30000).catch(e=>{throw new Error(e.message+' '+output);});
  const web=table().filter(p=>p.ppid===owner.pid&&p.command.includes('next-server')); assert.equal(web.length,1);web.forEach(p=>owned.add(p.pid));
  for(let i=0;i<3;i++){const duplicate=launch(false); await until(()=>duplicate.exitCode!==null);assert.equal(duplicate.exitCode,0,output);assert.equal(table().filter(p=>p.ppid===owner.pid&&p.command.includes('next-server')).length,1);}
  t.diagnostic(JSON.stringify({ending,starts:4,nextServers:1,pids:web.map(p=>p.pid)}));
  if(ending==='disconnect') owner.disconnect(); else owner.kill(ending);
  await until(()=>!alive(owner.pid)&&web.every(p=>!alive(p.pid)),12000);
  assert.equal(table().filter(p=>owned.has(p.pid)).length,0);
  t.diagnostic(JSON.stringify({ending,nextServers:0,ownedProcesses:0}));
 }
});
