import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { localVoiceClient, localVoiceEndpoint, localVoiceRequest, signLocalVoiceRequest } from '../lib/local-voice/client.mjs';
import { LOCAL_VOICE_SANDBOX_PROFILE, localVoiceBinary, localVoiceLaunch, startLocalVoiceService } from './local-voice-service.mjs';
import { MODEL_FILES, TURNS, listenThroughService, synthesizeVisit, wordErrorRate } from './prove-ascolto-visita.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = localVoiceBinary(root);
const installedModels = path.join(os.homedir(), 'Library/Application Support/MediFlow GPUI/modelli-voce');
const noBinary = process.platform !== 'darwin' ? 'richiede macOS' : existsSync(binary) ? false : `manca ${binary}: cargo build --release -p mediflow-voice`;
const noModel = noBinary || (MODEL_FILES.every(name => existsSync(path.join(installedModels, name))) ? false : 'modello vocale non installato');

function rawRequest(port, { method = 'GET', path: target = '/v1/status', headers = {}, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host, port, method, path: target, headers, agent: false }, response => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode, proof: response.headers['x-mediflow-voice-proof'] }));
    });
    request.on('error', reject);
    request.end();
  });
}

function sockets(pid) {
  const result = spawnSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-i'], { encoding: 'utf8' });
  return result.stdout.split('\n').slice(1).filter(Boolean).map(line => line.trim().split(/\s+/u).slice(-2).join(' '));
}

function externalAddress() {
  return Object.values(os.networkInterfaces()).flat().find(entry => entry && entry.family === 'IPv4' && !entry.internal)?.address;
}

test('endpoint configuration accepts only a loopback URL and a 64 hex secret', () => {
  const secret = 'a'.repeat(64);
  assert.deepEqual(localVoiceEndpoint('http://127.0.0.1:4100', secret), { url: 'http://127.0.0.1:4100', secret });
  for (const url of ['http://localhost:4100', 'http://192.168.1.2:4100', 'https://127.0.0.1:4100', 'http://127.0.0.1:4100/x']) {
    assert.equal(localVoiceEndpoint(url, secret), null, url);
  }
  assert.equal(localVoiceEndpoint('http://127.0.0.1:4100', 'A'.repeat(64)), null);
  assert.equal(localVoiceEndpoint('http://127.0.0.1:4100', 'a'.repeat(63)), null);
  assert.deepEqual(localVoiceLaunch('/x/mediflow-voice', 'darwin'), { command: '/usr/bin/sandbox-exec', args: ['-p', LOCAL_VOICE_SANDBOX_PROFILE, '/x/mediflow-voice'] });
});

test('the sandbox profile of the service refuses outgoing connections, even to the loopback', { skip: process.platform !== 'darwin' && 'richiede macOS' }, async () => {
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = /** @type {net.AddressInfo} */ (server.address());
  const probe = `require('node:net').connect(${port}, '127.0.0.1').on('connect', () => { console.log('connected'); process.exit(0); }).on('error', e => { console.log(e.code); process.exit(0); });`;
  try {
    const open = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
    assert.equal(open.stdout.trim(), 'connected');
    const confined = spawnSync('/usr/bin/sandbox-exec', ['-p', LOCAL_VOICE_SANDBOX_PROFILE, process.execPath, '-e', probe], { encoding: 'utf8' });
    assert.equal(confined.stdout.trim(), 'EPERM', confined.stderr);
  } finally {
    server.close();
  }
});

test('the service listens only on the loopback, opens no connection and answers only signed local calls', { skip: noBinary }, async () => {
  const models = mkdtempSync(path.join(os.tmpdir(), 'voce-vuota-'));
  const service = await startLocalVoiceService({ binary, models });
  const port = Number(new URL(service.url).port);
  try {
    assert.deepEqual(sockets(service.pid), [`127.0.0.1:${port} (LISTEN)`]);
    const external = externalAddress();
    if (external) await assert.rejects(rawRequest(port, { host: external }), { code: 'ECONNREFUSED' });
    const client = localVoiceClient(service);
    const status = await client.status();
    assert.equal(status.service, 'mediflow-voice');
    assert.equal(status.model, 'missing');
    assert.deepEqual(status.audio, { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, maxRequestBytes: 1048576 });
    await assert.rejects(client.create({ mode: 'visit', subject: 'paziente-sintetico' }), { code: 'model-missing', status: 503 });
    const unsigned = await rawRequest(port);
    assert.deepEqual(unsigned, { status: 401, proof: undefined });
    const signed = () => ({ 'x-mediflow-voice-auth': signLocalVoiceRequest(service.secret, 'GET', '/v1/status').header });
    assert.equal((await rawRequest(port, { headers: { ...signed(), origin: 'https://example.invalid' } })).status, 403);
    assert.equal((await rawRequest(port, { headers: { ...signed(), 'sec-fetch-mode': 'cors' } })).status, 403);
    assert.equal((await rawRequest(port, { headers: { ...signed(), host: `rebound.example:${port}` } })).status, 403);
    const replay = signed();
    assert.equal((await rawRequest(port, { headers: replay })).status, 200);
    assert.equal((await rawRequest(port, { headers: replay })).status, 401);
    const impostor = { url: service.url, secret: 'b'.repeat(64) };
    await assert.rejects(localVoiceRequest(impostor, 'GET', '/v1/status'), { code: 'identity' });
    for (const entry of sockets(service.pid)) {
      assert.match(entry, new RegExp(`^127\\.0\\.0\\.1:${port}( \\(LISTEN\\)|->127\\.0\\.0\\.1:\\d+ .*)$`, 'u'), entry);
    }
  } finally {
    await service.stop();
    rmSync(models, { recursive: true, force: true });
  }
  assert.equal(await service.exited, 0);
});

test('synthetic visit audio streamed to the service comes back as text attributed to doctor and patient', { skip: noModel, timeout: 15 * 60_000 }, async () => {
  const work = mkdtempSync(path.join(os.tmpdir(), 'voce-visita-'));
  const turns = TURNS.slice(0, 12);
  const service = await startLocalVoiceService({ binary, models: installedModels });
  try {
    const { audio } = synthesizeVisit(turns, work);
    const { snapshot } = await listenThroughService(service, audio, { subject: 'paziente-sintetico-42', vocabulary: ['Metformina', 'Ramipril'] });
    assert.equal(snapshot.state, 'review', JSON.stringify({ state: snapshot.state, fault: snapshot.fault }));
    assert.equal(snapshot.subject, 'paziente-sintetico-42');
    const speakers = new Set(snapshot.review.lines.map(line => line.speaker));
    assert.deepEqual([...speakers].sort(), ['doctor', 'patient']);
    assert.match(snapshot.review.text, /^(Medico|Paziente): /u);
    assert.ok(wordErrorRate(turns.map(([, text]) => text).join(' '), snapshot.review.lines.map(line => line.text).join(' ')) < 0.3);
    for (const entry of sockets(service.pid)) assert.match(entry, /^127\.0\.0\.1:\d+( \(LISTEN\)|->127\.0\.0\.1:\d+ .*)$/u, entry);
  } finally {
    await service.stop();
    rmSync(work, { recursive: true, force: true });
  }
});
