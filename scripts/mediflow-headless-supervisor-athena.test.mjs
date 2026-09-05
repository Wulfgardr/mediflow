/* @Codex */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createPortableSupervisorProductionChildProcessesV1 as createChildren } from
  '../lib/security/portable-supervisor-child-processes.ts';
import { createCheckupStatusTransitionSupervisorPortV1 as createCheckup } from
  '../lib/security/checkup-status-transition-supervisor-port.ts';

// Execute the real production root and child builder. Replace only DB/authority ports
// (deny if used), data-directory selection and the child I/O seam. No runtime is copied.
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-athena-composition-')));
const dataDir = path.join(temporary, 'data');
const webDirectory = path.join(temporary, 'standalone');
const runnerDirectory = path.join(temporary, 'Application Support', 'runner');
for (const dir of [dataDir, webDirectory, runnerDirectory]) fs.mkdirSync(dir, { recursive: true });
const runner = path.join(runnerDirectory, 'mlx_lm.generate');
fs.writeFileSync(runner, '#!/bin/sh\nexit 0\n', { mode: 0o700 }); // Never invoked.
const webTargetPath = path.join(webDirectory, 'server.js');
fs.writeFileSync(webTargetPath, '// Synthetic Web process contract.\n');
fs.writeFileSync(path.join(webDirectory, 'package.json'), '{"type":"module"}\n');
const mcpFixtureDirectory = fs.mkdtempSync(path.join(root, 'scripts', '.athena-process-contract-'));
const mcpTargetPath = path.join(mcpFixtureDirectory, 'mcp.mjs');
const KEY = 'MEDIFLOW_ATHENA_MLX_GENERATE_BIN';
const MCP_ENV = { MEDIFLOW_AIP_OPERATION_RPC: 'late_bound_authenticated_inherited_child_ipc_v1' };
const BASE_WEB_ENV = { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3000', MEDIFLOW_DATA_DIR: dataDir };
const seam = Symbol.for('mediflow.synthetic.mf085.supervisor-athena');
let current = null;

class SyntheticChild extends EventEmitter {
  connected = true; exitCode = null; signalCode = null; killed = false;
  disconnect() { if (this.connected) { this.connected = false; this.emit('disconnect'); } }
  kill() { this.killed = true; return true; }
  send(_frame, callback) { callback?.(null); return true; }
}

globalThis[seam] = {
  getDataDir: () => dataDir,
  createChildren: (options) => {
    assert.ok(current);
    current.options.push(options);
    current.beforeChildren?.();
    return createChildren({
      ...options, webDirectory, webTargetPath,
      ...(current.real ? { mcpTargetPath } : {}),
      spawnChild: (command, args, spawnOptions) => {
        current.calls.push({ command, args, options: spawnOptions });
        if (current.failSpawn === current.calls.length) throw new Error('synthetic spawn failure');
        const child = current.real ? spawn(command, args, spawnOptions) : new SyntheticChild();
        current.children.push(child);
        return child;
      },
    });
  },
  createCheckup: (sources) => {
    if (current.throwCheckup) throw new Error('synthetic post-spawn composition failure');
    return createCheckup(sources);
  },
};
const stubs = new Map();
function stub(relative, source) {
  const url = new URL(relative, import.meta.url).href;
  stubs.set(url, `data:text/javascript,${encodeURIComponent(source)}`);
  stubs.set(url.replace(/\.ts$/u, ''), stubs.get(url));
}
const seamExpression = 'globalThis[Symbol.for("mediflow.synthetic.mf085.supervisor-athena")]';
for (const [relative, name, method] of [
  ['../lib/data-dir.ts', 'getDataDir', 'getDataDir'],
  ['../lib/security/portable-supervisor-child-processes.ts', 'createPortableSupervisorProductionChildProcessesV1', 'createChildren'],
  ['../lib/security/checkup-status-transition-supervisor-port.ts', 'createCheckupStatusTransitionSupervisorPortV1', 'createCheckup'],
]) stub(relative, `export const ${name} = (...args) => ${seamExpression}.${method}(...args);`);
for (const [relative, name] of [
  ['portable-supervisor-patient-version-production.ts', 'createPortableSupervisorPatientVersionProductionV1'],
  ['portable-supervisor-aip-audit-port.ts', 'createPortableSupervisorAipAuditPortV1'],
  ['portable-supervisor-semantic-audit-port.ts', 'createPortableSupervisorSemanticAuditPortV1'],
]) stub(`../lib/security/${relative}`, `export const ${name} = () => () => { throw new Error('synthetic DB port must not be used'); };`);
stub('../lib/security/authenticated-headless-agent-launcher-production.ts',
  "export const createProductionMcpAgentLauncherWithPreSpawnedChildV1 = () => { throw new Error('no authority in process-contract tests'); };");
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const url = stubs.get(new URL(specifier, context.parentURL).href);
      if (url) return { url, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { createPortableSupervisorProductionV1: createProduction } =
  await import('../lib/security/portable-supervisor-production.ts');
after(() => {
  hooks.deregister(); delete globalThis[seam];
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.rmSync(mcpFixtureDirectory, { recursive: true, force: true });
});

async function fixture(value, body, overrides = {}) {
  const environment = { [KEY]: value, PATH: '/synthetic/not-inherited', HOME: '/synthetic/not-inherited',
    NODE_OPTIONS: '--trace-warnings', MEDIFLOW_ATHENA_MODEL_DIR: '/synthetic/not-inherited',
    MEDIFLOW_ATHENA_MLX_PYTHON: 'synthetic-not-inherited', MEDIFLOW_UVX_BIN: '/synthetic/not-inherited',
    MEDIFLOW_ATHENA_MLX_LM_PACKAGE: 'synthetic-not-inherited', MEDIFLOW_UNEXPECTED: 'synthetic-sentinel' };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  for (const [key, entry] of Object.entries(environment)) {
    if (entry === undefined) delete process.env[key]; else process.env[key] = entry;
  }
  current = { options: [], calls: [], children: [], runtime: null, ...overrides };
  try { await body(current); }
  finally {
    const children = current.children;
    const exited = current.real ? children.map((child) => {
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
      return new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2_000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }) : [];
    current.runtime?.terminate();
    for (const child of children) { if (child.connected) child.disconnect(); if (!child.killed) child.kill(); }
    await Promise.all(exited);
    current = null;
    for (const [key, entry] of Object.entries(previous)) {
      if (entry === undefined) delete process.env[key]; else process.env[key] = entry;
    }
  }
}
function assertEnvironments(ctx, value) {
  assert.equal(ctx.options.length, 1);
  assert.equal(ctx.options[0].athenaMlxGenerateBin, value);
  assert.equal(ctx.calls.length, 2);
  assert.deepEqual(ctx.calls[0].options.env, MCP_ENV);
  assert.deepEqual(ctx.calls[1].options.env,
    { ...BASE_WEB_ENV, ...(value === undefined ? {} : { [KEY]: value }) });
  for (const call of ctx.calls) assert.equal(call.options.shell, false);
  assert.deepEqual(ctx.calls[1].args, [webTargetPath]);
}

test('production root passes only the approved parent runner through typed options to Web, never MCP', () =>
  fixture(runner, (ctx) => {
    ctx.runtime = createProduction(); assertEnvironments(ctx, runner);
    ctx.runtime.terminate();
    assert.ok(ctx.children.every((child) => child.killed && !child.connected));
  }));
test('absent parent runner preserves optional startup and both exact minimal child environments', () =>
  fixture(undefined, (ctx) => { ctx.runtime = createProduction(); assertEnvironments(ctx, undefined); }));
test('production captures the approved value instead of rereading mutable parent env at spawn', () =>
  fixture(runner, (ctx) => { ctx.runtime = createProduction(); assertEnvironments(ctx, runner); },
    { beforeChildren: () => { process.env[KEY] = './mlx_lm.generate'; } }));

for (const [label, value] of [
  ['empty', ''], ['blank', ' \t '], ['relative', './mlx_lm.generate'],
  ['arguments', `${runner} --help`], ['quoted', `"${runner}"`], ['padding', ` ${runner} `],
  ['missing', path.join(temporary, 'missing', 'mlx_lm.generate')],
  ['wrong basename', process.execPath],
]) test(`invalid explicit ${label} runner is denied by production before constructing or spawning children`, () =>
  fixture(value, (ctx) => {
    assert.throws(createProduction, { message: 'ATHENA MLX direct runner configuration rejected.' });
    assert.equal(ctx.options.length, 0); assert.equal(ctx.calls.length, 0);
  }));

test('child construction independently rejects invalid typed configuration without spawning', () => {
  let spawns = 0;
  for (const athenaMlxGenerateBin of ['', './mlx_lm.generate', `${runner} --help`]) {
    assert.throws(() => createChildren({ dataDir, webDirectory, webTargetPath, athenaMlxGenerateBin,
      spawnChild: () => { spawns += 1; return new SyntheticChild(); } }), /direct runner/u);
  }
  assert.equal(spawns, 0);
});
test('runner removed after root validation is rechecked by the child builder before the first spawn', () =>
  fixture(runner, (ctx) => {
    try {
      assert.throws(createProduction, /direct runner/u);
      assert.equal(ctx.options.length, 1); assert.equal(ctx.calls.length, 0);
    } finally { fs.writeFileSync(runner, '#!/bin/sh\nexit 0\n', { mode: 0o700 }); }
  }, { beforeChildren: () => { fs.unlinkSync(runner); } }));
for (const failSpawn of [1, 2]) test(`production spawn ${failSpawn} failure cleans up every previously created child`, () =>
  fixture(runner, (ctx) => {
    assert.throws(createProduction, { message: failSpawn === 1 ? 'mcp_spawn_failed' : 'web_spawn_failed' });
    assert.equal(ctx.calls.length, failSpawn); assert.equal(ctx.children.length, failSpawn - 1);
    assert.ok(ctx.children.every((child) => child.killed && !child.connected));
  }, { failSpawn }));
test('post-spawn production composition failure also cleans up both children', () =>
  fixture(runner, (ctx) => {
    assert.throws(createProduction, /synthetic post-spawn/u);
    assert.equal(ctx.children.length, 2);
    assert.ok(ctx.children.every((child) => child.killed && !child.connected));
  }, { throwCheckup: true }));
for (const failedChild of [0, 1]) test(`asynchronous child ${failedChild} spawn error terminates the production pair`, () =>
  fixture(runner, async (ctx) => {
    ctx.runtime = createProduction(); ctx.children[failedChild].emit('error', new Error('synthetic async spawn failure'));
    await ctx.runtime.closed;
    assert.ok(ctx.children.every((child) => child.killed && !child.connected));
    assert.equal(ctx.runtime.terminate(), false);
  }));

// @Codex Test-only observation boundary: never add platform keys to spawnOptions.env.
const CF_ENCODING_KEY = '__CF_USER_TEXT_ENCODING';
function measureEmptyEnvironmentKeys() {
  // Independent of the Supervisor, its loader and its spawn seam. Absolute Node,
  // no inherited execArgv/env, no shell. spawnSync reaps this bounded control child.
  const control = spawnSync(process.execPath, ['--input-type=module', '--eval',
    "import fs from 'node:fs'; fs.writeSync(1, JSON.stringify(Object.keys(process.env).sort()));"], {
    env: {}, shell: false, encoding: 'utf8', timeout: 5_000, maxBuffer: 4_096,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.ifError(control.error);
  assert.equal(control.signal, null, 'empty-env control must exit without a signal');
  assert.equal(control.status, 0, 'empty-env control must complete successfully');
  return JSON.parse(control.stdout);
}
function assertObservedKeys(keys, expectedEnvironment, controlKeys, platform = process.platform) {
  // Do not subtract unknown keys or trust the whole control as an allowlist.
  // Darwin alone may add this one key, and only if the empty-env control proved it.
  const platformKeys = platform === 'darwin' && controlKeys.includes(CF_ENCODING_KEY)
    ? [CF_ENCODING_KEY] : [];
  assert.deepEqual(controlKeys, platformKeys, 'empty-env control contains unapproved keys');
  assert.deepEqual(keys, [...Object.keys(expectedEnvironment), ...platformKeys].sort());
}

test('observed child keys stay exact when the empty-env control adds nothing', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    assertObservedKeys(Object.keys(MCP_ENV).sort(), MCP_ENV, [], platform);
    assert.throws(() => assertObservedKeys([...Object.keys(MCP_ENV), CF_ENCODING_KEY].sort(),
      MCP_ENV, [], platform), { code: 'ERR_ASSERTION' });
  }
});
test('only measured Darwin CF encoding is admitted at the observed child boundary', () => {
  const measured = [CF_ENCODING_KEY];
  const keys = [...Object.keys(MCP_ENV), ...measured].sort();
  assertObservedKeys(keys, MCP_ENV, measured, 'darwin');
  for (const platform of ['linux', 'win32']) {
    assert.throws(() => assertObservedKeys(keys, MCP_ENV, measured, platform), { code: 'ERR_ASSERTION' });
  }
});
test('unexpected control or child keys never become allowed, even alongside measured Darwin CF encoding', () => {
  for (const key of ['PATH', 'HOME', 'NODE_OPTIONS', KEY, 'MEDIFLOW_ATHENA_MODEL_DIR',
    'MEDIFLOW_ATHENA_MLX_PYTHON', 'MEDIFLOW_UVX_BIN', 'MEDIFLOW_ATHENA_MLX_LM_PACKAGE',
    'MEDIFLOW_UNEXPECTED', '__CF_UNEXPECTED']) {
    for (const controlKeys of [[], [CF_ENCODING_KEY]]) {
      for (const environment of [MCP_ENV, BASE_WEB_ENV]) {
        const expectedKeys = [...Object.keys(environment), ...controlKeys].sort();
        assertObservedKeys(expectedKeys, environment, controlKeys, 'darwin');
        assert.throws(() => assertObservedKeys([...expectedKeys, key].sort(), environment,
          controlKeys, 'darwin'), { code: 'ERR_ASSERTION' });
        assert.throws(() => assertObservedKeys(expectedKeys, environment,
          [...controlKeys, key].sort(), 'darwin'), { code: 'ERR_ASSERTION' });
      }
    }
  }
});
test('observed child assertions still reject missing required keys', () => {
  for (const environment of [MCP_ENV, BASE_WEB_ENV, { ...BASE_WEB_ENV, [KEY]: runner }]) {
    const expectedKeys = [...Object.keys(environment), CF_ENCODING_KEY].sort();
    for (const missing of expectedKeys) {
      assert.throws(() => assertObservedKeys(expectedKeys.filter((key) => key !== missing),
        environment, [CF_ENCODING_KEY], 'darwin'), { code: 'ERR_ASSERTION' });
    }
  }
});
test('platform observation allowance never relaxes either exact spawnOptions.env assertion', () =>
  fixture(runner, (ctx) => {
    ctx.runtime = createProduction(); assertEnvironments(ctx, runner);
    for (const call of ctx.calls) {
      call.options.env[CF_ENCODING_KEY] = 'synthetic-not-allowed-at-spawn';
      try { assert.throws(() => assertEnvironments(ctx, runner), { code: 'ERR_ASSERTION' }); }
      finally { delete call.options.env[CF_ENCODING_KEY]; }
    }
    assertEnvironments(ctx, runner);
  }));

for (const [label, value] of [['approved', runner], ['absent', undefined]]) {
  test(`real synthetic children receive ${label} production allowlists and exit on cleanup`, (t) =>
  fixture(value, async (ctx) => {
    const controlKeys = measureEmptyEnvironmentKeys();
    assertObservedKeys(controlKeys, {}, controlKeys);
    t.diagnostic(`independent empty-env control: ${JSON.stringify({ platform: process.platform, keys: controlKeys })}`);
    const reports = ['mcp', 'web'].map((role) => path.join(temporary, `${label}-${role}-report.json`));
    const script = (report) => `import fs from 'node:fs';
      fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({ pid: process.pid,
        keys: Object.keys(process.env).sort(), runner: process.env.${KEY} ?? null }));
      process.on('message', () => {}); process.on('disconnect', () => process.exit(0));`;
    fs.writeFileSync(mcpTargetPath, script(reports[0]));
    fs.writeFileSync(webTargetPath, script(reports[1]));
    ctx.runtime = createProduction(); assertEnvironments(ctx, value);
    for (let attempt = 0; attempt < 500 && !reports.every((file) => fs.existsSync(file)); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(reports.every((file) => fs.existsSync(file)), 'synthetic children must publish bounded startup reports');
    const [mcp, web] = reports.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
    assert.notEqual(mcp.pid, web.pid); assert.notEqual(web.pid, process.pid); assert.notEqual(mcp.pid, process.pid);
    assertObservedKeys(mcp.keys, MCP_ENV, controlKeys); assert.equal(mcp.runner, null);
    assertObservedKeys(web.keys, { ...BASE_WEB_ENV, ...(value === undefined ? {} : { [KEY]: value }) }, controlKeys);
    assert.equal(web.runner, value ?? null);
    const closed = ctx.children.map((child) => once(child, 'exit'));
    let cleanupTimer;
    ctx.runtime.terminate(); await ctx.runtime.closed;
    try {
      await Promise.race([Promise.all(closed), new Promise((_, reject) => {
        cleanupTimer = setTimeout(() => reject(new Error('production child cleanup timed out')), 3_000);
      })]);
    } finally { clearTimeout(cleanupTimer); }
    assert.ok(ctx.children.every((child) => child.exitCode !== null || child.signalCode !== null));
  }, { real: true }));

}
test('real MCP child created before a Web spawn failure exits through production cleanup', () =>
  fixture(runner, async (ctx) => {
    fs.writeFileSync(mcpTargetPath, "process.on('message', () => {}); process.on('disconnect', () => process.exit(0));\n");
    assert.throws(createProduction, { message: 'web_spawn_failed' });
    assert.equal(ctx.children.length, 1); assert.equal(ctx.calls.length, 2);
    const child = ctx.children[0];
    assert.equal(child.connected, false); assert.equal(child.killed, true);
    let cleanupTimer;
    try {
      await Promise.race([once(child, 'exit'), new Promise((_, reject) => {
        cleanupTimer = setTimeout(() => reject(new Error('partial startup cleanup timed out')), 3_000);
      })]);
    } finally { clearTimeout(cleanupTimer); }
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  }, { real: true, failSpawn: 2 }));
