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
const server = http.createServer((request, response) => {
  if (request.url === '/api/system/revision') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(payload);
    return;
  }
  response.writeHead(200);
  response.end('MEDIFLOW');
});
setTimeout(() => {
  server.listen(Number(process.env.PORT), process.env.HOSTNAME);
}, Number(process.env.MEDIFLOW_TEST_SERVER_START_DELAY_MS || 0));
`);
  return { root, contents, dataDir, logDir };
}

function launcherEnv(scenario, port, overrides = {}) {
  return {
    ...process.env,
    MEDIFLOW_DATA_DIR: scenario.dataDir,
    MEDIFLOW_INSTALL_LOG_DIR: scenario.logDir,
    MEDIFLOW_INSTALL_PORT: String(port),
    MEDIFLOW_INSTALL_SKIP_OPEN: '1',
    ...overrides,
  };
}

function runLauncher(scenario, port, overrides = {}) {
  return spawnSync(path.join(scenario.contents, 'MacOS', 'MediFlow'), [], {
    encoding: 'utf8',
    env: launcherEnv(scenario, port, overrides),
    timeout: 10_000,
  });
}

function runLauncherAsync(scenario, port, overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(scenario.contents, 'MacOS', 'MediFlow'), [], {
      env: launcherEnv(scenario, port, overrides),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function stopScenarioServer(scenario) {
  const pidFile = path.join(scenario.dataDir, 'runtime', 'installability-v0.pid');
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    if (Number.isSafeInteger(pid) && pid > 0) process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
  }
}

async function startForeignServer(port, options = {}) {
  const {
    revisionStatus = 200,
    revisionPayload = {
      revision: 'foreign',
      sourceFingerprint: 'foreign',
      fingerprint: 'foreign',
    },
  } = options;
  const revisionBody = revisionStatus === 200 ? JSON.stringify(revisionPayload) : '';
  const script = `
const http = require('node:http');
http.createServer((request, response) => {
  if (request.url === '/api/system/revision') {
    response.writeHead(${revisionStatus});
    response.end(${JSON.stringify(revisionBody)});
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
  t.after(() => {
    stopScenarioServer(scenario);
    fs.rmSync(scenario.root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(scenario.dataDir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(scenario.dataDir, 'runtime', 'installability-v0.pid'), '99999999\n');
  const port = await freePort();

  const result = runLauncher(scenario, port);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /server MediFlow pronto/);

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
  assert.match(`${result.stdout}${result.stderr}`, /provenienza o identita MediFlow non valida/);
});

test('launcher rejects a foreign process that copies the static bundle identity', async (t) => {
  const scenario = fixture();
  const port = await freePort();
  const foreign = await startForeignServer(port, {
    revisionPayload: {
      revision: 'test-revision',
      sourceFingerprint: 'test-branch@test-revision:clean',
      fingerprint: 'test-branch@test-revision:clean',
    },
  });
  t.after(() => {
    foreign.kill('SIGTERM');
    fs.rmSync(scenario.root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(scenario.dataDir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(scenario.dataDir, 'runtime', 'installability-v0.pid'), `${foreign.pid}\n`);

  const result = runLauncher(scenario, port);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /provenienza o identita MediFlow non valida/);
});

test('launcher rejects an invalid revision endpoint HTTP status', async (t) => {
  const scenario = fixture();
  const port = await freePort();
  const foreign = await startForeignServer(port, { revisionStatus: 204 });
  t.after(() => {
    foreign.kill('SIGTERM');
    fs.rmSync(scenario.root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(scenario.dataDir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(scenario.dataDir, 'runtime', 'installability-v0.pid'), `${foreign.pid}\n`);

  const result = runLauncher(scenario, port);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /provenienza o identita MediFlow non valida/);
});

test('concurrent launchers serialize startup and preserve one healthy server', { timeout: 20_000 }, async (t) => {
  const scenario = fixture();
  const port = await freePort();
  t.after(() => {
    stopScenarioServer(scenario);
    fs.rmSync(scenario.root, { recursive: true, force: true });
  });

  const overrides = { MEDIFLOW_TEST_SERVER_START_DELAY_MS: '250' };
  const [first, second] = await Promise.all([
    runLauncherAsync(scenario, port, overrides),
    runLauncherAsync(scenario, port, overrides),
  ]);

  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.equal(first.signal, null);
  assert.equal(second.signal, null);

  const pidFile = path.join(scenario.dataDir, 'runtime', 'installability-v0.pid');
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  process.kill(pid, 0);

  const revisionResponse = await fetch(`http://127.0.0.1:${port}/api/system/revision`);
  assert.equal(revisionResponse.status, 200);
  assert.deepEqual(await revisionResponse.json(), {
    revision: 'test-revision',
    sourceFingerprint: 'test-branch@test-revision:clean',
    fingerprint: 'test-branch@test-revision:clean',
  });
});
