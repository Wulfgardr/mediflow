/* @Codex */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

const ROOT = process.cwd();
const LOADER = path.join(ROOT, 'scripts', 'register-strip-types-loader.mjs');
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-supervisor-cross-process-')));
const dataDir = path.join(temporary, 'data');
const webDirectory = path.join(temporary, 'standalone');
const webTarget = path.join(webDirectory, 'server.js');
const harnessPath = path.join(temporary, 'supervisor-harness.mjs');
fs.mkdirSync(dataDir); fs.mkdirSync(webDirectory);

const PATIENT = 'patient.synthetic.supervisor.cross-process';
const AMBULATORY = 'ambulatory.synthetic.supervisor.cross-process';
const REQUEST = `pswr_${'1'.repeat(32)}`;
const USER = `user.${'2'.repeat(64)}`;
const PARENT = `parent.${'3'.repeat(64)}`;

const database = new Database(path.join(dataDir, 'medical.db'));
for (const migration of fs.readdirSync(path.join(ROOT, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
  database.exec(fs.readFileSync(path.join(ROOT, 'drizzle', migration), 'utf8')
    .replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
database.prepare(`INSERT INTO ambulatories (id, name, type, is_default)
  VALUES (?, ?, 'test', 1)`).run(AMBULATORY, 'Synthetic Cross Process');
database.prepare(`INSERT INTO patients
  (id, first_name, last_name, tax_code, is_archived, version)
  VALUES (?, 'Synthetic', 'CrossProcess', 'SYNTHETIC-CODE', 0, 7)`).run(PATIENT);
database.prepare(`INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id)
  VALUES (?, ?)`).run(PATIENT, AMBULATORY);
database.close();

fs.writeFileSync(webTarget, `
'use strict';
const http = require('node:http');
const schemaVersion = 'mediflow.portable-supervisor.web-ipc.v1';
const requestRef = ${JSON.stringify(REQUEST)};
const capture = {
  schemaVersion: 'mediflow.portable-supervisor.web-capture.v1',
  userRef: ${JSON.stringify(USER)}, parentRef: ${JSON.stringify(PARENT)},
  patientId: ${JSON.stringify(PATIENT)}, ambulatoryId: ${JSON.stringify(AMBULATORY)},
  selectionEpoch: 4, expectedPatientVersion: 7, expiresAt: Date.now() + 10_000,
};
const send = (value) => {
  const { method, ...rest } = value;
  process.send(JSON.stringify({ schemaVersion, method, requestRef, ...rest }));
};
let challenge = null, activationResponse = null, revokeResponse = null;
const server = http.createServer((request, response) => {
  if (request.url === '/activate' && !activationResponse) {
    activationResponse = response; send({ method: 'prepare' }); return;
  }
  if (request.url === '/revoke' && !revokeResponse) {
    revokeResponse = response; send({ method: 'revoke_all', reason: 'explicit' }); return;
  }
  response.statusCode = 409; response.end();
});
process.on('message', (raw) => {
  const frame = JSON.parse(raw);
  if (frame.outcome === 'prepared') {
    challenge = frame.challenge;
    send({ method: 'activate', challenge, capture });
  } else if (frame.outcome === 'activated') {
    process.stdout.write('WEB_ACTIVATED\\n');
    activationResponse.statusCode = 200; activationResponse.end('activated'); activationResponse = null;
    send({ method: 'activate', challenge, capture });
  } else if (frame.outcome === 'denied' && frame.denialCode === 'already_bound') {
    process.stdout.write('WEB_REPLAY_DENIED\\n');
  } else if (frame.outcome === 'revoked') {
    revokeResponse.statusCode = 204;
    revokeResponse.once('finish', () => process.stdout.write('WEB_ROUTE_RETURNED_204\\n'));
    revokeResponse.end(); revokeResponse = null;
  } else if (frame.outcome === 'denied') {
    process.stdout.write('WEB_DENIED_' + frame.denialCode + '\\n');
    const response = revokeResponse || activationResponse;
    if (response) { response.statusCode = 409; response.end(); }
    revokeResponse = null; activationResponse = null;
  }
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write('WEB_READY_' + server.address().port + '\\n');
});
`, 'utf8');

fs.writeFileSync(harnessPath, `
import { createHash, randomBytes } from 'node:crypto';
const root = ${JSON.stringify(ROOT)};
const url = (relative) => new URL(relative, 'file://' + root + '/').href;
const [{ createPortableSupervisorContextMirrorV1 },
  { createProductionMcpAgentLauncherWithPreSpawnedChildV1 },
  { createPortableSupervisorAipAuditPortV1 },
  { createPortableSupervisorProductionChildProcessesV1 },
  { createPortableSupervisorPatientVersionProductionV1 },
  { createPortableSupervisorProductionRuntimeV1 },
  { createPortableSupervisorSemanticAuditPortV1 },
  { createCheckupStatusTransitionSupervisorPortV1 }] = await Promise.all([
  import(url('packages/aip/src/portable-supervisor-context-mirror.ts')),
  import(url('lib/security/authenticated-headless-agent-launcher-production.ts')),
  import(url('lib/security/portable-supervisor-aip-audit-port.ts')),
  import(url('lib/security/portable-supervisor-child-processes.ts')),
  import(url('lib/security/portable-supervisor-patient-version-production.ts')),
  import(url('lib/security/portable-supervisor-production.ts')),
  import(url('lib/security/portable-supervisor-semantic-audit-port.ts')),
  import(url('lib/security/checkup-status-transition-supervisor-port.ts')),
]);
const now = () => Date.now();
let runtime = null, expectedTermination = false;
const mirror = createPortableSupervisorContextMirrorV1({
  now,
  hashRef: (value) => 'sha256:' + createHash('sha256').update(value).digest('hex'),
  readPatientVersion: createPortableSupervisorPatientVersionProductionV1(),
  schedule: (delay, callback) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
  onTerminal: (reason) => {
    if (!expectedTermination) runtime?.terminate(reason === 'expired' ? 'expiry' : 'explicit');
  },
});
const context = Object.freeze({
  activate: mirror.activate, readHostContext: mirror.readHostContext,
  revoke: () => {
    expectedTermination = true;
    try { return mirror.revoke(); } finally { expectedTermination = false; }
  },
});
const writeAudit = createPortableSupervisorAipAuditPortV1({ now, readHostContext: context.readHostContext });
const commitTerminalAudit = createPortableSupervisorSemanticAuditPortV1({
  now, readHostContext: context.readHostContext,
});
const children = createPortableSupervisorProductionChildProcessesV1({
  dataDir: ${JSON.stringify(dataDir)},
  webDirectory: ${JSON.stringify(webDirectory)}, webTargetPath: ${JSON.stringify(webTarget)},
});
const checkup = createCheckupStatusTransitionSupervisorPortV1({
  randomBytes, sendWeb: children.sendWeb,
  schedule: (delay, callback) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
  onTerminal: () => runtime?.terminate('explicit'),
});
runtime = createPortableSupervisorProductionRuntimeV1({
  now, nextChallenge: () => 'pswc_' + randomBytes(32).toString('hex'),
  schedule: (delay, callback) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
  mirror: context, children, checkup,
  launchMcp: () => createProductionMcpAgentLauncherWithPreSpawnedChildV1({
    readHostContext: context.readHostContext, writeAudit, commitTerminalAudit,
    previewCheckupStatus: checkup.preview,
  }, children.mcpPort).launch(),
});
const onSignal = () => runtime.terminate('restart');
process.once('SIGTERM', onSignal);
try { await runtime.closed; } finally { process.off('SIGTERM', onSignal); }
`, 'utf8');

const META = Object.freeze({
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'mediflow-supervisor-test', version: '1.0.0' },
});

function withTimeout(promise, label, detail = () => '') {
  return Promise.race([promise, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${label}${detail()}`)), 8_000); timer.unref();
  })]);
}

test('entrypoint rejects a symlinked data directory before importing the database runtime', async (context) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-supervisor-symlink-')));
  const target = path.join(root, 'target'); const link = path.join(root, 'data-link');
  fs.mkdirSync(target);
  try { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch { fs.rmSync(root, { recursive: true, force: true }); context.skip('symlink creation is unavailable'); return; }
  context.after(() => { fs.rmSync(root, { recursive: true, force: true }); });
  const child = spawn(process.execPath, ['--experimental-strip-types', '--import', LOADER,
    path.join(ROOT, 'scripts', 'mediflow-headless-supervisor.mjs')], {
    cwd: ROOT, env: { MEDIFLOW_DATA_DIR: link }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exit = await withTimeout(new Promise((resolve) => child.once('exit', resolve)), 'symlink rejection');
  assert.equal(exit, 1); assert.equal(stdout, '');
  assert.equal(stderr, 'MediFlow production Supervisor failed closed.\n');
  assert.equal(fs.existsSync(path.join(target, 'medical.db')), false);
});

test('proves prebind denial, activation, replay denial, revocation and clean stdout cross-process',
  { timeout: 12_000 }, async (context) => {
    const child = spawn(process.execPath,
      ['--experimental-strip-types', '--import', LOADER, harnessPath], {
        cwd: ROOT, env: { MEDIFLOW_DATA_DIR: dataDir }, stdio: ['pipe', 'pipe', 'pipe'],
      });
    const childExit = new Promise((resolve) => child.once('exit', resolve));
    context.after(async () => {
      if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
      await Promise.race([childExit, new Promise((resolve) => {
        const timer = setTimeout(resolve, 1_000); timer.unref();
      })]);
      if (child.exitCode === null) child.kill('SIGKILL');
      fs.rmSync(temporary, { recursive: true, force: true });
    });
    let stdout = '', stderr = '', nextId = 1;
    const lines = [], pending = new Map();
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      for (;;) {
        const newline = stdout.indexOf('\n');
        if (newline < 0) break;
        const line = stdout.slice(0, newline); stdout = stdout.slice(newline + 1);
        if (!line) continue;
        lines.push(line);
        const message = JSON.parse(line);
        if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const send = (method, params = {}) => {
      const id = nextId; nextId += 1;
      const response = new Promise((resolve) => { pending.set(id, resolve); });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method,
        params: { ...params, _meta: META } })}\n`);
      return withTimeout(response, method,
        () => `; exit=${child.exitCode}; stdoutLines=${JSON.stringify(lines)}; stderr=${stderr}`);
    };
    const waitForStderr = async (marker) => {
      for (let attempt = 0; attempt < 800; attempt += 1) {
        if (stderr.includes(marker)) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error(`Missing marker: ${marker}; exit=${child.exitCode}; stderr=${stderr}`);
    };
    const requestRoute = (port, route) => withTimeout(new Promise((resolve, reject) => {
      const request = http.get({ hostname: '127.0.0.1', port, path: route }, (response) => {
        response.resume(); response.once('end', () => resolve(response.statusCode));
      });
      request.once('error', reject);
    }), `Web route ${route}`, () => `; exit=${child.exitCode}; stderr=${stderr}`);

    await waitForStderr('WEB_READY_');
    const port = Number(/WEB_READY_(\d+)/u.exec(stderr)?.[1]);
    assert.equal(Number.isInteger(port) && port > 0, true);
    await send('server/discover');
    const before = await send('tools/call', {
      name: 'mediflow.system.headless_status.v1', arguments: {},
    });
    assert.equal(before.result.isError, true);
    assert.equal(before.result.content[0].text, 'MediFlow operation denied: host_unbound.');

    assert.equal(await requestRoute(port, '/activate'), 200);
    await waitForStderr('WEB_ACTIVATED');
    const after = await send('tools/call', {
      name: 'mediflow.system.capabilities.v1', arguments: {},
    });
    assert.equal(after.result.structuredContent.operations.length, 4);
    await waitForStderr('WEB_REPLAY_DENIED');
    assert.equal(await requestRoute(port, '/revoke'), 204);
    await waitForStderr('WEB_ROUTE_RETURNED_204');
    const exit = await withTimeout(childExit, 'Supervisor exit');
    assert.equal(exit, 0);
    assert.equal(pending.size, 0);
    assert.equal(stdout, '');
    assert.equal(lines.length >= 3, true);
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
    assert.doesNotMatch(lines.join('\n'), /WEB_|patient\.synthetic|ambulatory\.synthetic/iu);
    assert.match(stderr, /WEB_ACTIVATED/u); assert.match(stderr, /WEB_REPLAY_DENIED/u);
    assert.match(stderr, /WEB_ROUTE_RETURNED_204/u);
  });
