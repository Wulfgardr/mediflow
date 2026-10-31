import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const [binary, out] = process.argv.slice(2);
if (!binary || !out) throw new Error('Usage: node scripts/probe-patient-document-key-erasure.mjs <example-binary> <new-evidence-directory>');
fs.mkdirSync(out, { recursive: false });
const root = path.resolve(import.meta.dirname, '..');
const vector = JSON.parse(fs.readFileSync(path.join(root, 'native/contracts/crypto-golden-vectors.v3.json')));
const ports = JSON.parse(fs.readFileSync(path.join(root, 'experiments/gpui-patient-pilot/transport/tests/fixtures/host-ports.json')));
for (const mib of [5, 10]) for (const mode of ['403', 'cancel']) {
  const received = path.join(out, `received-${mib}-${mode}`);
  let posts = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let result;
    if (req.url === '/api/auth/check') result = { status: 'ok', isSetup: true, archiveGeneration: 'synthetic-generation', unlock: { credential: 'passphrase', kdfVersion: 3, salt: vector.salt } };
    else if (req.url === '/api/auth/native/login') result = { success: true, id: 'synthetic-user', username: 'synthetic', role: 'admin', archiveGeneration: 'synthetic-generation', salt: vector.salt, encryptedMasterKey: vector.wrappedMasterKey };
    else if (req.url === '/api/v1/network/capabilities') result = { protocolVersion: '1.13.0', operatingMode: 'network-home-base', capabilities: [], hostPorts: ports };
    else if (req.url === '/api/v1/network/ambulatories') result = [{ id: 'scope-a', name: 'Synthetic', version: 1 }];
    else if (req.url === '/api/v1/network/identity') result = { scope: { effectiveAmbulatoryId: 'scope-a', requestBinding: 'expected-ambulatory-id-v1' }, operator: { userId: 'synthetic-user', authChannel: 'native' } };
    else if (req.url === '/api/auth/native/patient-document') {
      posts++;
      const raw = Buffer.concat(chunks), body = JSON.parse(raw);
      assert.equal(Buffer.from(body.source.original, 'base64').length, mib * 1024 * 1024);
      assert.equal(body.source.fileKey.length, 32);
      console.log(JSON.stringify({ mib, mode, requestBytes: raw.length }));
      if (mode === 'cancel') { fs.writeFileSync(received, 'received', { flag: 'wx' }); return; }
      res.writeHead(403, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end('{"status":"denied"}'); return;
    } else { res.writeHead(503); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `mediflow_session=${'a'.repeat(64)}`, Connection: 'close' });
    res.end(JSON.stringify(result));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const child = spawn(binary, [`http://127.0.0.1:${server.address().port}`, vector.passphrase, String(mib), mode, received], { stdio: 'inherit', timeout: 60_000 });
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, null); assert.equal(code, 0); assert.equal(posts, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
