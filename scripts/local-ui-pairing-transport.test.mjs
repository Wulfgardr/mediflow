import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { bridgeExistingLocalUi, readPairingRequests, frames, writeFrame } from './local-ui-pairing-transport.mjs';

test('rendezvous contains no secret and only the code transferred through the local UI admits the return peer', async t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-ui-test-')));
  fs.chmodSync(directory, 0o700); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const channel = new EventEmitter(), sent = [];
  Object.assign(channel, { connected: true, send(frame, done) { sent.push(frame); done?.(); },
    disconnect() { this.connected = false; this.emit('disconnect'); } });
  const expected = { dataDir: '/synthetic/archive', sourceFingerprint: 'synthetic-source' };
  let codeUrl;
  const close = await bridgeExistingLocalUi(directory, expected, channel, url => { codeUrl = url; }); t.after(close);
  const files = fs.readdirSync(directory); assert.equal(files.length, 1);
  const bytes = fs.readFileSync(path.join(directory, files[0]), 'utf8');
  const [request] = readPairingRequests(directory);
  assert.deepEqual(Object.keys(request).sort(), ['dataDir', 'expiresAt', 'host', 'nonce', 'returnPath', 'sourceFingerprint']);
  const first = {type:'mediflow-local-ui-navigate',requestId:crypto.randomUUID(),intent:'history',expiresAt:Date.now()+7000,...expected};
  const revoked = {...first,requestId:crypto.randomUUID()};
  channel.emit('message', first);
  assert.deepEqual(sent.at(-1), { type: 'mediflow-local-ui-result', requestId: first.requestId, status: 'waiting' });
  channel.emit('message', revoked);
  channel.emit('message', {type:'mediflow-local-ui-cancel',requestId:revoked.requestId});
  const html = await (await fetch(codeUrl)).text();
  const code = html.match(/<code[^>]*>([a-f0-9]{24})<\/code>/u)?.[1]; assert.ok(code);
  assert.ok(!bytes.includes(code)); assert.ok(!JSON.stringify(sent).includes(code));
  const foreign = net.createConnection(request.returnPath); await once(foreign, 'connect');
  writeFrame(foreign, { type: 'paired', ...expected, nonce: request.nonce, token: 'a'.repeat(24), status: 'accepted' });
  await once(foreign, 'close');
  assert.equal(channel.connected, true);
  const wrongHost = net.createConnection(request.returnPath); await once(wrongHost, 'connect');
  writeFrame(wrongHost, { type: 'paired', ...expected, nonce: request.nonce, host: 'another-host', token: code, status: 'accepted' });
  const rejected = await Promise.race([once(wrongHost, 'close').then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 300))]);
  wrongHost.destroy(); assert.equal(rejected, true, 'the UI code must retain the requesting host binding');
  const peer = net.createConnection(request.returnPath); await once(peer, 'connect');
  const received = []; frames(peer, frame => received.push(frame));
  writeFrame(peer, { type: 'paired', ...expected, nonce: request.nonce, host: request.host, token: code, status: 'accepted' });
  await new Promise(resolve => setTimeout(resolve, 20));
  channel.emit('message', first);channel.emit('message', revoked);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(received, [], 'A waiting request was replayed after pairing');
  assert.equal(sent.at(-1).status,'denied');
  const next={...first,requestId:crypto.randomUUID(),expiresAt:Date.now()+7000};
  channel.emit('message',next);await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(received,[next]);
  writeFrame(peer,{type:'mediflow-local-ui-result',requestId:next.requestId,status:'accepted'});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(sent.at(-1).status,'accepted');
  channel.emit('message',next);await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(received,[next]);assert.equal(sent.at(-1).status,'denied');
  assert.ok(!JSON.stringify(sent).includes(code));
  peer.destroy(); await once(channel, 'disconnect');
  assert.equal(channel.connected, false);
  assert.equal(fs.readdirSync(directory).length, 0);
});

test('bridge admission validates frames and retains waiting IDs at capacity', async t => {
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mf-ui-capacity-~')));fs.chmodSync(directory,0o700);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const channel=new EventEmitter(),sent=[];
  Object.assign(channel,{connected:true,send(frame,done){sent.push(frame);done?.();},disconnect(){this.connected=false;this.emit('disconnect');}});
  const expected={dataDir:'/synthetic/archive',sourceFingerprint:'synthetic-source'};
  const close=await bridgeExistingLocalUi(directory,expected,channel,()=>{});t.after(close);
  const request=()=>({type:'mediflow-local-ui-navigate',requestId:crypto.randomUUID(),intent:'search',expiresAt:Date.now()+7000,...expected});
  const count=sent.length;
  for(const requestId of [null,{},'not-a-uuid','-'.repeat(36)]) channel.emit('message',{...request(),requestId});
  assert.equal(sent.length,count,'Malformed IDs were reflected');
  for(const frame of [{...request(),patientId:'SYNTHETIC_SENTINEL'},{...request(),intent:'write'},
    {...request(),dataDir:'/other'},{...request(),sourceFingerprint:'other'},{...request(),expiresAt:Date.now()-1},
    {...request(),expiresAt:Date.now()+9000},{...request(),expiresAt:1.5}]) {
    channel.emit('message',frame);assert.deepEqual(sent.at(-1),{type:'mediflow-local-ui-result',requestId:frame.requestId,status:'denied'});
  }
  const first=request();channel.emit('message',first);assert.equal(sent.at(-1).status,'waiting');
  for(let i=1;i<256;i++){channel.emit('message',request());assert.equal(sent.at(-1).status,'waiting');}
  channel.emit('message',request());assert.equal(sent.at(-1).status,'denied');
  channel.emit('message',first);assert.equal(sent.at(-1).status,'denied');
  channel.emit('message',{type:'mediflow-local-ui-cancel',requestId:first.requestId});
  channel.emit('message',first);assert.equal(sent.at(-1).status,'denied');
  assert.ok(sent.every(frame=>Object.keys(frame).sort().join(',')==='dataDir,sourceFingerprint,type'||Object.keys(frame).sort().join(',')==='requestId,status,type'));
});
