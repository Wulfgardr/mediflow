#!/usr/bin/env node
/* @Codex */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const buildScript = path.join(repoRoot, 'scripts/build-installability-v0-macos.sh');
const launcherSource = path.join(repoRoot, 'scripts/installability-v0-macos-launcher.sh');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-installability-v0-test-'));
  const contents = path.join(root, 'MediFlow.app', 'Contents');
  const dataDir = path.join(root, 'data');
  const logDir = path.join(root, 'logs');
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(contents, 'Resources', 'Node', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(contents, 'Resources', 'WebRuntime'), { recursive: true });
  fs.copyFileSync(launcherSource, path.join(contents, 'MacOS', 'MediFlow'));
  fs.chmodSync(path.join(contents, 'MacOS', 'MediFlow'), 0o755);
  fs.symlinkSync(process.execPath, path.join(contents, 'Resources', 'Node', 'bin', 'node'));
  fs.writeFileSync(path.join(contents, 'Resources', 'WebRuntime', 'mediflow-installability-v0-identity.json'), JSON.stringify({
    schemaVersion: 1,
    bundleIdentifier: 'org.wulfgardr.mediflow.installability-v0',
    revision: 'test-revision',
    sourceFingerprint: 'test-branch@test-revision:clean',
  }));
  fs.writeFileSync(path.join(contents, 'Resources', 'WebRuntime', 'server.js'), `
const http = require('node:http');
const payload = JSON.stringify({
  revision: process.env.MEDIFLOW_APP_REVISION,
  sourceFingerprint: process.env.MEDIFLOW_APP_SOURCE_FINGERPRINT,
  fingerprint: process.env.MEDIFLOW_APP_FINGERPRINT,
});
http.createServer((request, response) => {
  if (request.url === '/api/system/revision') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(payload);
    return;
  }
  response.writeHead(200);
  response.end('MEDIFLOW');
}).listen(Number(process.env.PORT), process.env.HOSTNAME);
`);
  return { root, contents, dataDir, logDir };
}

function runLauncher(scenario, port) {
  return spawnSync(path.join(scenario.contents, 'MacOS', 'MediFlow'), [], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MEDIFLOW_DATA_DIR: scenario.dataDir,
      MEDIFLOW_INSTALL_LOG_DIR: scenario.logDir,
      MEDIFLOW_INSTALL_PORT: String(port),
      MEDIFLOW_INSTALL_SKIP_OPEN: '1',
    },
    timeout: 10_000,
  });
}

async function startForeignServer(port, revisionStatus = 200) {
  const script = `
const http = require('node:http');
http.createServer((request, response) => {
  if (request.url === '/api/system/revision') {
    response.writeHead(${revisionStatus});
    response.end(${revisionStatus === 200 ? `'\{"revision":"foreign","sourceFingerprint":"foreign","fingerprint":"foreign"\}'` : `''`});
    return;
  }
  response.writeHead(200);
  response.end('FOREIGN SERVICE');
}).listen(${port}, '127.0.0.1', () => console.log('READY'));
`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`foreign server exited: ${code}`)));
    child.stdout.once('data', resolve);
  });
  return child;
}

test('build guard rejects traversal outside dedicated temporary roots', { skip: process.platform !== 'darwin' }, () => {
  const result = spawnSync(buildScript, [], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MEDIFLOW_INSTALL_OUTPUT_DIR: '/tmp/x/../../../Applications',
      MEDIFLOW_INSTALL_VALIDATE_OUTPUT_ONLY: '1',
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /output non sicuro/);
});

test('launcher discards a stale dead PID and starts the bundled server', async (t) => {
  const scenario = fixture();
  t.after(() => fs.rmSync(scenario.root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(scenario.dataDir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(scenario.dataDir, 'runtime', 'installability-v0.pid'), '99999999\n');
  const port = await freePort();

  const result = runLauncher(scenario, port);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /server MediFlow pronto/);

  const pid = Number(fs.readFileSync(path.join(scenario.dataDir, 'runtime', 'installability-v0.pid'), 'utf8'));
  process.kill(pid, 'SIGTERM');
});

test('launcher rejects a live foreign service referenced by the PID file', async (t) => {
  const scenario = fixture();
  const port = await freePort();
  const foreign = await startForeignServer(port);
  t.after(() => {
    foreign.kill('SIGTERM');
    fs.rmSync(scenario.root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(scenario.dataDir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(scenario.dataDir, 'runtime', 'installability-v0.pid'), `${foreign.pid}\n`);

  const result = runLauncher(scenario, port);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /identita MediFlow non valida/);
});

test('launcher rejects an invalid revision endpoint HTTP status', async (t) => {
  const scenario = fixture();
  const port = await freePort();
  const foreign = await startForeignServer(port, 204);
  t.after(() => {
    foreign.kill('SIGTERM');
    fs.rmSync(scenario.root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(scenario.dataDir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(scenario.dataDir, 'runtime', 'installability-v0.pid'), `${foreign.pid}\n`);

  const result = runLauncher(scenario, port);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /identita MediFlow non valida/);
});
