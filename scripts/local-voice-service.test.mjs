import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { localVoiceClient, localVoiceEndpoint, localVoiceRequest, signLocalVoiceRequest } from '../lib/local-voice/client.mjs';
import { installLocalVoiceBinary } from './install-local-voice-binary.mjs';
import {
  LOCAL_VOICE_SANDBOX_PROFILE,
  localVoiceBinary,
  localVoiceLaunch,
  readRegularBinaryBytes,
  sha256Buffer,
  startLocalVoiceService,
  verifyLocalVoiceBinary,
} from './local-voice-service.mjs';
import { MODEL_FILES, TURNS, listenThroughService, synthesizeVisit, wordErrorRate } from './prove-ascolto-visita.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = localVoiceBinary(root);
const binarySha256 = existsSync(binary) ? sha256Buffer(readFileSync(binary)) : null;
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

function impostor(mode) {
  const received = [];
  const server = net.createServer(socket => {
    socket.on('data', chunk => {
      received.push(chunk);
      if (!socket.answered && Buffer.concat(received).includes('\r\n\r\n')) {
        socket.answered = true;
        if (mode === 'continue') socket.write('HTTP/1.1 100 Continue\r\n\r\n');
        else socket.end('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}');
      }
    });
    socket.on('error', () => {});
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${/** @type {net.AddressInfo} */ (server.address()).port}`,
    received: () => Buffer.concat(received).toString('latin1'),
    close: () => new Promise(done => { server.closeAllConnections?.(); server.close(() => done(undefined)); }),
  })));
}

test('a process squatting on the service port never receives subject, vocabulary or audio', async () => {
  for (const mode of ['answer', 'continue']) {
    const squatter = await impostor(mode);
    const client = localVoiceClient({ url: squatter.url, secret: 'c'.repeat(64) });
    try {
      await assert.rejects(client.create({ mode: 'visit', subject: 'paziente-segreto-7', vocabulary: ['Farmacosegreto'] }), { code: 'identity' });
      await assert.rejects(client.audio('0'.repeat(32), new Uint8Array(Buffer.from('AUDIOSEGRETO'))), { code: 'identity' });
      await assert.rejects(client.command('0'.repeat(32), 'stop'), { code: 'identity' });
      const seen = squatter.received();
      assert.ok(seen.includes('POST /v1/sessions'), mode);
      for (const secret of ['paziente-segreto-7', 'Farmacosegreto', 'AUDIOSEGRETO', '"command"']) assert.ok(!seen.includes(secret), `${mode}: ${secret}`);
    } finally {
      await squatter.close();
    }
  }
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
  const service = await startLocalVoiceService({ binary, expectedSha256: binarySha256, models });
  const port = Number(new URL(service.url).port);
  try {
    assert.deepEqual(sockets(service.pid), [`127.0.0.1:${port} (LISTEN)`]);
    const external = externalAddress();
    if (external) {
      const reached = await new Promise(resolve => {
        const socket = net.connect({ host: external, port, timeout: 2000 });
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
        socket.once('error', () => resolve(false));
      });
      assert.equal(reached, false);
    }
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
  const service = await startLocalVoiceService({ binary, expectedSha256: binarySha256, models: installedModels });
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

test('the Web runtime takes the voice endpoint only from a valid launcher frame and clears it otherwise', async () => {
  const { EventEmitter } = await import('node:events');
  const { LOCAL_VOICE_ENDPOINT_FRAME, installLocalVoiceEndpoint } = await import('./local-voice-web-endpoint.mjs');
  const channel = new EventEmitter(), env = {};
  installLocalVoiceEndpoint(/** @type {any} */ (channel), env);
  const secret = 'b'.repeat(64);
  channel.emit('message', { type: LOCAL_VOICE_ENDPOINT_FRAME, url: 'http://127.0.0.1:4100', secret });
  assert.deepEqual(env, { MEDIFLOW_LOCAL_VOICE_URL: 'http://127.0.0.1:4100', MEDIFLOW_LOCAL_VOICE_SECRET: secret });
  channel.emit('message', { type: 'other', url: 'http://127.0.0.1:4200', secret });
  assert.equal(env.MEDIFLOW_LOCAL_VOICE_URL, 'http://127.0.0.1:4100');
  channel.emit('message', { type: LOCAL_VOICE_ENDPOINT_FRAME, url: 'http://192.168.1.2:4100', secret });
  assert.deepEqual(env, {});
  channel.emit('message', { type: LOCAL_VOICE_ENDPOINT_FRAME, url: 'http://127.0.0.1:4300', secret });
  channel.emit('message', { type: LOCAL_VOICE_ENDPOINT_FRAME, url: null, secret: null });
  assert.deepEqual(env, {});
});

test('the launcher supervisor publishes null when the service falls and a new endpoint after each restart', async () => {
  const published = [];
  let count = 0;
  const exits = [];
  const start = async () => {
    count++;
    let exit;
    const exited = new Promise(resolve => { exit = resolve; });
    exits.push(exit);
    return { url: `http://127.0.0.1:${4100 + count}`, secret: 'c'.repeat(64), pid: count, exited, stop: async () => exit(0) };
  };
  const { superviseLocalVoiceService } = await import('./local-voice-service.mjs');
  const supervisor = superviseLocalVoiceService({ binary: '/x', expectedSha256: 'c'.repeat(64), publish: endpoint => published.push(endpoint?.url ?? null), restarts: 1, start });
  assert.equal((await supervisor.ensure()).url, 'http://127.0.0.1:4101');
  exits[0](137);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(published, [null, 'http://127.0.0.1:4102']);
  exits[1](137);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(published, [null, 'http://127.0.0.1:4102', null]);
  assert.equal(supervisor.current(), null);
  await supervisor.stop();
  assert.equal(count, 2);
});

test('verifyLocalVoiceBinary accepts only a regular file matching the pinned manifest SHA-256', () => {
  const work = mkdtempSync(path.join(os.tmpdir(), 'voce-verify-'));
  try {
    mkdirSync(path.join(work, 'scripts'), { recursive: true });
    mkdirSync(path.join(work, 'native/local-voice/target/release'), { recursive: true });
    const binPath = path.join(work, 'native/local-voice/target/release/mediflow-voice');
    const payload = Buffer.from('#!/bin/sh\necho ok\n');
    writeFileSync(binPath, payload, { mode: 0o755 });
    const digest = sha256Buffer(payload);
    writeFileSync(path.join(work, 'scripts/local-voice-binary.json'), JSON.stringify({
      schemaVersion: 1,
      version: '0.9.1',
      binary: 'mediflow-voice',
      relativePath: 'native/local-voice/target/release/mediflow-voice',
      platforms: { 'darwin-arm64': { sha256: digest, bytes: payload.length } },
    }));

    const ok = verifyLocalVoiceBinary(binPath, { root: work, platform: 'darwin', arch: 'arm64', version: '0.9.1' });
    assert.equal(ok.ok, true);
    assert.equal(ok.sha256, digest);

    const wrongVersion = verifyLocalVoiceBinary(binPath, { root: work, platform: 'darwin', arch: 'arm64', version: '0.9.2' });
    assert.deepEqual(wrongVersion, { ok: false, reason: 'version-mismatch' });

    const unpinnedArch = verifyLocalVoiceBinary(binPath, { root: work, platform: 'darwin', arch: 'x64', version: '0.9.1' });
    assert.equal(unpinnedArch.ok, false);
    assert.equal(unpinnedArch.reason, 'unpinned');

    const linkPath = path.join(work, 'link-voice');
    symlinkSync(binPath, linkPath);
    assert.deepEqual(verifyLocalVoiceBinary(linkPath, { root: work, platform: 'darwin', arch: 'arm64', version: '0.9.1' }), { ok: false, reason: 'invalid' });

    const altered = Buffer.from(payload);
    altered[altered.length - 1] ^= 0x01;
    writeFileSync(binPath, altered, { mode: 0o755 });
    const mismatch = verifyLocalVoiceBinary(binPath, { root: work, platform: 'darwin', arch: 'arm64', version: '0.9.1' });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.reason, 'mismatch');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('startLocalVoiceService requires expectedSha256 and refuses mismatched binaries', async () => {
  const work = mkdtempSync(path.join(os.tmpdir(), 'voce-start-guard-'));
  try {
    const binPath = path.join(work, 'mediflow-voice');
    writeFileSync(binPath, '#!/bin/sh\necho bad\n', { mode: 0o755 });
    await assert.rejects(startLocalVoiceService({ binary: binPath }), { message: 'local-voice-sha256-required' });
    await assert.rejects(startLocalVoiceService({ binary: binPath, expectedSha256: '0'.repeat(64) }), { message: 'local-voice-binary-mismatch' });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('installLocalVoiceBinary downloads, verifies SHA-256 and rejects altered payloads from a local HTTP server', async () => {
  const work = mkdtempSync(path.join(os.tmpdir(), 'voce-install-'));
  const goodBytes = Buffer.from('#!/bin/sh\nexit 0\n');
  const badBytes = Buffer.from(goodBytes);
  badBytes[badBytes.length - 1] ^= 0x01;
  const goodDigest = sha256Buffer(goodBytes);
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    if (req.url === '/good') { res.writeHead(200, { 'content-length': String(goodBytes.length) }); res.end(goodBytes); return; }
    if (req.url === '/bad') { res.writeHead(200, { 'content-length': String(badBytes.length) }); res.end(badBytes); return; }
    res.writeHead(404); res.end('missing');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = /** @type {net.AddressInfo} */ (server.address());
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    mkdirSync(path.join(work, 'scripts'), { recursive: true });
    writeFileSync(path.join(work, 'package.json'), JSON.stringify({ version: '0.9.1' }));
    writeFileSync(path.join(work, 'scripts/local-voice-binary.json'), JSON.stringify({
      schemaVersion: 1,
      version: '0.9.1',
      binary: 'mediflow-voice',
      relativePath: 'native/local-voice/target/release/mediflow-voice',
      platforms: { 'darwin-arm64': { asset: 'mediflow-voice-0.9.1-darwin-arm64', sha256: goodDigest, bytes: goodBytes.length } },
    }));
    const target = path.join(work, 'native/local-voice/target/release/mediflow-voice');

    await assert.rejects(
      installLocalVoiceBinary({ root: work, url: `${baseUrl}/bad`, platform: 'darwin', arch: 'arm64' }),
      /Impronta SHA-256 non corrispondente/u,
    );
    assert.equal(existsSync(target), false);

    await assert.rejects(
      installLocalVoiceBinary({ root: work, url: `${baseUrl}/missing`, platform: 'darwin', arch: 'arm64' }),
      /HTTP 404/u,
    );
    assert.equal(existsSync(target), false);

    const installed = await installLocalVoiceBinary({ root: work, url: `${baseUrl}/good`, platform: 'darwin', arch: 'arm64' });
    assert.equal(installed.status, 'installed');
    assert.equal(installed.sha256, goodDigest);
    assert.equal(existsSync(target), true);
    const read = readRegularBinaryBytes(target);
    assert.equal(read.ok, true);
    assert.equal(sha256Buffer(read.bytes), goodDigest);

    const beforeReuse = hits;
    const reused = await installLocalVoiceBinary({ root: work, url: `${baseUrl}/good`, platform: 'darwin', arch: 'arm64' });
    assert.equal(reused.status, 'already-installed');
    assert.equal(hits, beforeReuse);
  } finally {
    await new Promise(resolve => server.close(() => resolve(undefined)));
    rmSync(work, { recursive: true, force: true });
  }
});
