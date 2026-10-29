import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { prepareLauncherState } from './launcher-state.mjs';
import crypto from 'node:crypto';
import { recoverLocalRuntime } from './recover-local-runtime.mjs';
import { claimLauncher } from './mediflow.mjs';
import { localUiArchiveLock } from './launcher-state.mjs';
import { runtimeProcessIdentity } from './runtime-leases.mjs';

const root = process.env.MEDIFLOW_LIFECYCLE_ROOT || process.cwd();
const real = process.platform !== 'win32' && Boolean(process.env.MEDIFLOW_LIFECYCLE_REAL);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 20000) {
  const end = Date.now() + timeout;
  while (!await check()) { assert.ok(Date.now() < end, 'lifecycle deadline'); await pause(50); }
}
const table = () => execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/u);
  return { pid: Number(pid), ppid: Number(ppid), command };
});
const exited = child => child.exitCode !== null || child.signalCode !== null;
async function fixture(t, plugin = true) {
  const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-lifecycle-')));
  const env = { ...process.env, MEDIFLOW_DATA_DIR: data,
    PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) };
  const port = await new Promise(resolve => {
    const server = net.createServer(); server.listen(0, '127.0.0.1', () => {
      const port = server.address().port; server.close(() => resolve(port));
    });
  });
  env.PORT = String(port);
  const children = [], owned = new Map();
  let output = '';
  const remember = pid => { const start = runtimeProcessIdentity(pid); assert.ok(start); owned.set(pid, start); };
  const signal = (pid, value) => { if (runtimeProcessIdentity(pid) === owned.get(pid)) process.kill(pid, value); };
  const launch = (ipc, command = false) => {
    const child = spawn(command ? path.join(root, 'MediFlow.command') : process.execPath,
      [...(command ? [] : [path.join(root, 'scripts/mediflow.mjs')]), '--riusa', '--scelta', 'web', '--senza-browser'],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])] });
    children.push(child); remember(child.pid);
    child.on('message', frame => { if (frame.type === 'mediflow-local-ui-connected') child.handshake = true; });
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    return child;
  };
  t.after(async () => {
    for (const row of table()) if (children.some(child => child.pid === row.ppid) && !owned.has(row.pid)) remember(row.pid);
    for (const child of children) if (child.connected) child.disconnect();
    for (const child of children) if (!exited(child)) signal(child.pid, 'SIGTERM');
    await pause(1000);
    for (const pid of owned.keys()) signal(pid, 'SIGKILL');
    await until(() => [...owned].every(([pid, start]) => runtimeProcessIdentity(pid) !== start));
    fs.rmSync(data, { recursive: true, force: true });
  });
  const owner = launch(plugin, !plugin && process.platform === 'darwin');
  await until(() => output.includes('Pronto:'), 45000).catch(error => { throw new Error(`${error.message}: ${output}`); });
  const web = table().filter(row => row.ppid === owner.pid && row.command.includes('next-server'));
  assert.equal(web.length, 1); remember(web[0].pid);
  const { lockDirectory } = prepareLauncherState(root, { env });
  const active = path.join(lockDirectory, 'active');
  const receipt = JSON.parse(fs.readFileSync(path.join(active, fs.readdirSync(active)[0], 'instance.json')));
  const stop = async () => {
    const endpoint = new URL('stop', receipt.choiceUrl);
    const response = await fetch(endpoint, { method: 'POST', headers: { Origin: endpoint.origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 200); await response.text();
  };
  return { data, env, receipt, owner, web: web[0].pid, launch, signal, remember, stop,
    url: `http://127.0.0.1:${port}`, output: () => output };
}

test('real standalone: four plugin starts share one Web; last lease leaves zero processes', { skip: !real, timeout: 120000 }, async t => {
  const f = await fixture(t);
  for (let index = 0; index < 3; index++) {
    const client = f.launch(true); await until(() => client.handshake); client.disconnect(); await until(() => exited(client));
    assert.equal(table().filter(row => row.ppid === f.owner.pid && row.command.includes('next-server')).length, 1);
  }
  f.owner.disconnect(); await until(() => exited(f.owner) && runtimeProcessIdentity(f.web) === null);
  t.diagnostic(JSON.stringify({ starts: 4, maxWeb: 1, finalWeb: 0 }));
});

test('real standalone P1: ordinary reuse survives loss of the plugin that started Web', { skip: !real, timeout: 120000 }, async t => {
  const f = await fixture(t);
  const manual = f.launch(false, process.platform === 'darwin'); await until(() => exited(manual));
  assert.equal(manual.exitCode, 0, f.output()); assert.match(f.output(), /già attivo/u);
  f.owner.disconnect(); await pause(500);
  assert.equal((await fetch(f.url)).status, 200); assert.equal(exited(f.owner), false);
  await f.stop(); await until(() => exited(f.owner) && runtimeProcessIdentity(f.web) === null);
  t.diagnostic('P1: ordinary session HTTP 200 after plugin disconnect; explicit Stop released it.');
});

test('real standalone P1 inverse: plugin releases only its lease on an ordinary Web', { skip: !real, timeout: 120000 }, async t => {
  const f = await fixture(t, false);
  const client = f.launch(true); await until(() => client.handshake); client.disconnect(); await until(() => exited(client));
  assert.equal((await fetch(f.url)).status, 200); assert.equal(exited(f.owner), false);
  await f.stop(); await until(() => exited(f.owner));
});

test('real standalone: SIGKILL of source-runtime client preserves another active lease', { skip: !real, timeout: 120000 }, async t => {
  const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-source-leases-')));
  const env = { ...process.env, MEDIFLOW_DATA_DIR: data,
    PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) };
  const opener = path.join(data, 'opener'); fs.mkdirSync(opener);
  for (const command of ['open', 'xdg-open']) fs.writeFileSync(path.join(opener, command), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  env.PATH = opener + path.delimiter + env.PATH;
  const state = prepareLauncherState(root, { env });
  const preference = fs.existsSync(state.preferencesFile) ? fs.readFileSync(state.preferencesFile) : null;
  fs.writeFileSync(state.preferencesFile, JSON.stringify({ schemaVersion: 1, choice: 'web' }));
  const owned = new Map(), clients = [];
  const remember = pid => { const start = runtimeProcessIdentity(pid); assert.ok(start); owned.set(pid, start); };
  t.after(async () => {
    for (const child of clients) if (child.connected) child.disconnect();
    for (const [pid, start] of owned) if (runtimeProcessIdentity(pid) === start) process.kill(pid, 'SIGTERM');
    await pause(1000);
    for (const [pid, start] of owned) if (runtimeProcessIdentity(pid) === start) process.kill(pid, 'SIGKILL');
    await until(() => [...owned].every(([pid, start]) => runtimeProcessIdentity(pid) !== start));
    if (preference) fs.writeFileSync(state.preferencesFile, preference); else fs.rmSync(state.preferencesFile, { force: true });
    fs.rmSync(data, { recursive: true, force: true });
  });
  const source = spawn(process.execPath, ['scripts/source-runtime.mjs', 'local-ui'], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  remember(source.pid); clients.push(source); source.stderr.resume();
  let buffer = ''; const replies = new Map();
  source.stdout.setEncoding('utf8'); source.stdout.on('data', chunk => {
    buffer += chunk;
    for (;;) { const end = buffer.indexOf('\n'); if (end < 0) break;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const reply = JSON.parse(line); if (reply.id) replies.set(reply.id, reply); } catch { /* Protocol assertion below retains missing responses. */ }
    }
  });
  const send = frame => source.stdin.write(JSON.stringify(frame) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-lifecycle', version: '1' } } });
  await until(() => replies.has(1)); assert.ok(replies.get(1).result);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'mediflow.local_ui.navigate.v1', arguments: { intent: 'search' } } });
  await until(() => table().some(row => row.ppid === source.pid && row.command.includes('/scripts/mediflow.mjs')), 45000);
  const guardian = table().find(row => row.ppid === source.pid && row.command.includes('/scripts/mediflow.mjs'));
  remember(guardian.pid);
  for (const row of table().filter(row => row.ppid === source.pid)) remember(row.pid);
  let receipt, url;
  await until(async () => {
    try { const active = path.join(state.lockDirectory, 'active');
      receipt = JSON.parse(fs.readFileSync(path.join(active, fs.readdirSync(active)[0], 'instance.json')));
      const response = await fetch(new URL('state', receipt.choiceUrl), { signal: AbortSignal.timeout(1000) }); const runtimeState = await response.json(); url = runtimeState.url; return runtimeState.ready;
    } catch { return false; }
  }, 45000);
  for (const row of table().filter(row => row.ppid === guardian.pid)) remember(row.pid);
  const peer = spawn(process.execPath, ['scripts/mediflow.mjs', '--riusa', '--senza-browser'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  remember(peer.pid); clients.push(peer); peer.stderr.resume();
  let paired = false; peer.on('message', frame => { if (frame.type === 'mediflow-local-ui-connected') paired = true; });
  await until(() => paired);
  assert.equal(runtimeProcessIdentity(source.pid), owned.get(source.pid)); source.kill('SIGKILL'); await until(() => exited(source));
  await pause(500); assert.equal((await fetch(url)).status, 200); assert.equal(runtimeProcessIdentity(guardian.pid), owned.get(guardian.pid));
  peer.disconnect(); await until(() => exited(peer) && runtimeProcessIdentity(guardian.pid) === null);
  t.diagnostic(JSON.stringify({ sourceClient: source.pid, guardian: guardian.pid, survivingClient: peer.pid, retainedHttp: 200, finalGuardian: 0 }));
});


test('real standalone: crash recovery waits for incomplete HTTP and the previous Web to drain', {skip:!real,timeout:120000}, async t=>{
 const f=await fixture(t,false);
 const socket=net.createConnection(Number(new URL(f.url).port),'127.0.0.1');socket.on('error',()=>{});
 t.after(()=>socket.destroy());
 await new Promise(resolve=>socket.once('connect',resolve));socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n');
 await pause(100);f.signal(f.owner.pid,'SIGKILL');await until(()=>exited(f.owner));
 assert.ok(runtimeProcessIdentity(f.web),'Old Web must still be draining the incomplete HTTP request');
 const blocked=f.launch(false);await until(()=>exited(blocked));assert.equal(blocked.exitCode,1,f.output());
 assert.match(f.output(),/generazione precedente.*arresto/u);
 assert.throws(()=>claimLauncher(localUiArchiveLock(f.data),{checkoutPath:root+'-other'},{reuseLive:true}),/generazione precedente.*arresto/u);
 assert.ok(runtimeProcessIdentity(f.web));
 socket.destroy();await until(()=>runtimeProcessIdentity(f.web)===null);
 const successor=f.launch(false);
 function prepareReceipt(){const {lockDirectory}=prepareLauncherState(root,{env:f.env});const active=path.join(lockDirectory,'active');return JSON.parse(fs.readFileSync(path.join(active,fs.readdirSync(active)[0],'instance.json')));}
 await until(async()=>{try{return (await (await fetch(new URL('state',prepareReceipt().choiceUrl))).json()).ready;}catch{return false;}});
 const nextWeb=table().find(row=>row.ppid===successor.pid&&row.command.includes('next-server'));assert.ok(nextWeb);f.remember(nextWeb.pid);
 const file=path.join(f.data,'recovery.json');fs.writeFileSync(file,JSON.stringify(prepareReceipt()));
 assert.equal((await recoverLocalRuntime(file)).status,200);await until(()=>exited(successor)&&runtimeProcessIdentity(nextWeb.pid)===null);
 t.diagnostic('Crash: both locks denied while old Web drained; new HTTP server admitted only after terminal generation.');
});

test('real standalone: forged recovery receipts cannot stop a manual Web; valid receipt respects clients', {skip:!real,timeout:120000}, async t=>{
 const f=await fixture(t,false), file=path.join(f.data,'recovery.json');
 const forged=structuredClone(f.receipt);forged.pid=process.pid;forged.lease.owner={pid:process.pid,start:runtimeProcessIdentity(process.pid),nonce:crypto.randomUUID()};
 fs.writeFileSync(file,JSON.stringify(forged));await assert.rejects(recoverLocalRuntime(file));assert.equal((await fetch(f.url)).status,200);
 fs.writeFileSync(file,JSON.stringify({...f.receipt,choiceUrl:f.receipt.choiceUrl+'altered/'}));await assert.rejects(recoverLocalRuntime(file));assert.equal((await fetch(f.url)).status,200);
 const client=f.launch(true);await until(()=>client.handshake);
 fs.writeFileSync(file,JSON.stringify(f.receipt));assert.equal((await recoverLocalRuntime(file)).status,409);assert.equal((await fetch(f.url)).status,200);
 client.disconnect();await until(()=>exited(client));
 assert.equal((await recoverLocalRuntime(file)).status,200);await until(()=>exited(f.owner)&&runtimeProcessIdentity(f.web)===null);
});
