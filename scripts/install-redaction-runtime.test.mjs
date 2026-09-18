/* @Codex — synthetic installer regressions. NO authentic model, Mac qualification or egress grant. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { parseArguments, productionContract } from './install-redaction-runtime.mjs';
import { install, verify } from './redaction-install/engine.mjs';
import { loadManifest, lockText } from './redaction-install/manifest.mjs';
import { strictJson, absolute, InstallError } from './redaction-install/guards.mjs';
import { safeEnvironment, sandboxArguments, createProcessAdapter, createMacAdapter, pipArguments } from './redaction-install/process.mjs';
import { fixture, TEST_PYTHON, TEST_PIP_WHEEL, digest } from './redaction-install/test-support.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const integration = (name, fn) => test(`SYNTHETIC: ${name}`, { skip: !TEST_PYTHON || !TEST_PIP_WHEEL, timeout: 120_000 }, fn);
function noDescriptor(f) { assert.equal(fs.existsSync(path.join(f.options.root, 'runtime.json')), false); }
function noSlot(f) { noDescriptor(f); if (fs.existsSync(f.options.root)) assert.deepEqual(fs.readdirSync(f.options.root), []); }
function unchangedInputs(f) {
  assert.deepEqual(digest(f.options.worker), f.manifest.worker);
  for (const wheel of f.manifest.wheels) assert.deepEqual(digest(path.join(f.options.wheelhouse, wheel.file)), { bytes: wheel.bytes, sha256: wheel.sha256 });
}
async function denied(f, code) {
  await assert.rejects(install(f.options, f.contract, f.adapter), error => !code || error.code === code);
  noSlot(f);
}
function wrap(f, method, action) {
  const original = f.adapter[method];
  f.adapter = { ...f.adapter, [method]: (...args) => action(original, ...args) };
}
function cliArgs(o) {
  return ['install', '--root', o.root, '--python', o.python, '--worker', o.worker, '--model', o.model,
    '--wheelhouse', o.wheelhouse, '--manifest', o.manifest, '--manifest-sha256', o.manifestSha256,
    '--manifest-bytes', String(o.manifestBytes)];
}

test('strict JSON rejects duplicate/escaped keys and non-finite numbers', () => {
  for (const raw of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"a":1e999}', '{"x":true,}', '[1,]', '{"x":NaN}']) assert.throws(() => strictJson(raw));
  assert.equal(strictJson('{"value":"a\\\"b", "nested":[1,true,null]}').value, 'a"b');
});
test('CLI has no synthetic, download, force, pin or platform override', () => {
  assert.deepEqual(parseArguments(['--help']), { mode: 'help' });
  for (const flag of ['--force', '--download', '--test', '--platform', '--pin', '--runner', '--unsafe-no-sandbox']) assert.throws(() => parseArguments(['install', flag, 'x']));
  assert.throws(() => parseArguments(['install', '--root', '/one', '--root', '/two']));
});
test('paths are physical/absolute, never normalized into authority', () => {
  for (const value of ['relative', '/a/../b', '/a/./b', '/a//b', '/', '/a\nb', '/a\\b', '/a/']) assert.throws(() => absolute(value));
  assert.equal(absolute('/a/Application Support/MediFlow'), '/a/Application Support/MediFlow');
});
test('fixed subprocess environment does not inherit secrets, indexes, Python paths or caches', () => {
  const env = safeEnvironment('/synthetic/work');
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'HF_TOKEN', 'OPENAI_API_KEY', 'PYTHONPATH', 'VIRTUAL_ENV', 'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL']) assert.equal(env[k], undefined);
  assert.equal(env.PIP_CONFIG_FILE, '/dev/null'); assert.equal(env.PIP_NO_INDEX, '1'); assert.equal(env.HF_HUB_OFFLINE, '1');
  assert.equal(env.HOME, '/synthetic/work'); assert.equal(env.TMPDIR, '/synthetic/work');
});
test('Mac provisioning wrapper denies network and external writes; no fallback', () => {
  const args = sandboxArguments('/explicit/python', ['-I', '-B'], '/owned/a"b');
  assert.match(args[1], /\(deny network\*\)/); assert.match(args[1], /\(deny file-write\*\)/);
  assert.ok(args[1].includes('a\\"b')); assert.deepEqual(args.slice(2), ['/explicit/python', '-I', '-B']);
  if (process.platform !== 'darwin') assert.throws(() => createMacAdapter(), /macos_required/);
});
test('pip closure and installation are hash-locked, binary-only and offline', () => {
  for (const mode of ['plan', 'install']) {
    const args = pipArguments('/synthetic', mode);
    for (const required of ['--no-index', '--require-hashes', '--only-binary=:all:', '--no-cache-dir', '--no-build-isolation']) assert.ok(args.includes(required));
    assert.ok(!args.includes('--no-deps')); assert.ok(!args.some(a => /https?:/.test(a)));
  }
  assert.ok(pipArguments('/synthetic', 'plan').includes('--ignore-installed'));
});

integration('real offline pip install; final-path venv/symlink/shebang; read-only verify; no governance', async t => {
  const f = fixture(t); fs.mkdirSync(f.options.root, { mode: 0o700 });
  const outcome = await install(f.options, f.contract, f.adapter);
  f.options.receiptSha256 = outcome.receiptSha256;
  assert.equal(outcome.status, 'installed'); assert.equal(outcome.technicalSmoke, 'passed'); assert.equal(outcome.readiness, 'not_assessed');
  const descriptor = JSON.parse(fs.readFileSync(path.join(f.options.root, 'runtime.json')));
  assert.deepEqual(Object.keys(descriptor).sort(), ['modelDirectory', 'pythonExecutable', 'schema', 'workerPath']);
  assert.equal(descriptor.schema, 'mediflow.redaction-installation.v1');
  assert.ok(fs.lstatSync(descriptor.pythonExecutable).isSymbolicLink());
  assert.notEqual(descriptor.pythonExecutable, fs.realpathSync(descriptor.pythonExecutable));
  const slot = path.dirname(descriptor.workerPath);
  const output = spawnSync(path.join(slot, 'venv/bin/mfl-synthetic-check'), [], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(output.status, 0); assert.equal(output.stdout.trim(), 'synthetic-dependency-present');
  const before = fs.readFileSync(path.join(f.options.root, 'runtime.json'));
  // Existing governance is not overwritten, interpreted or removed by verification.
  f.write(path.join(f.options.root, 'latest.json'), '{"SYNTHETIC_SENTINEL_NOT_A_REPORT":true}');
  const verified = await verify(f.options, f.contract, f.adapter);
  assert.equal(verified.status, 'verified'); assert.equal(verified.technicalSmoke, 'not_run_read_only');
  assert.deepEqual(fs.readFileSync(path.join(f.options.root, 'runtime.json')), before);
  assert.deepEqual(fs.readdirSync(f.options.root).sort(), ['latest.json', 'runtime.json', path.basename(slot)].sort());
  assert.equal(fs.statSync(f.options.root).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(f.options.root, 'runtime.json')).mode & 0o777, 0o600);
  assert.ok(f.calls.some(call => call.python === descriptor.pythonExecutable));
  for (const call of f.calls) assert.equal(call.env.PIP_NO_INDEX, '1');
  unchangedInputs(f);
});
integration('a missing root is created only after full input verification', async t => {
  const f = fixture(t); assert.equal(fs.existsSync(f.options.root), false);
  await install(f.options, f.contract, f.adapter); assert.ok(fs.existsSync(path.join(f.options.root, 'runtime.json')));
});
integration('missing artifact is rejected before running Python', async t => {
  const f = fixture(t); fs.unlinkSync(f.options.worker); await denied(f); assert.equal(f.calls.length, 0);
});
integration('artifact hash mismatch is rejected before running Python', async t => {
  const f = fixture(t); fs.appendFileSync(f.options.worker, '# altered\n'); await denied(f, 'artifact_integrity_mismatch'); assert.equal(f.calls.length, 0);
});
integration('interpreter digest mismatch never executes it', async t => {
  const f = fixture(t); f.manifest.python.sha256 = 'f'.repeat(64); f.refresh(); await denied(f, 'artifact_integrity_mismatch'); assert.equal(f.calls.length, 0);
});
integration('manifest external digest and exact byte count are mandatory', async t => {
  const f = fixture(t); f.options.manifestBytes++; await denied(f, 'artifact_integrity_mismatch'); assert.equal(f.calls.length, 0);
});
integration('wheelhouse missing a listed wheel is rejected before execution', async t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.options.wheelhouse, f.manifest.wheels[0].file)); await denied(f, 'input_inventory_mismatch'); assert.equal(f.calls.length, 0);
});
integration('extra wheel/cache file is not accepted as dependency authority', async t => {
  const f = fixture(t); f.write(path.join(f.options.wheelhouse, 'cached-extra.whl'), 'not approved'); await denied(f, 'input_inventory_mismatch'); assert.equal(f.calls.length, 0);
});
integration('extra model file and extra empty directory are rejected', async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.options.model, 'extra'), { mode: 0o700 }); await denied(f, 'input_inventory_mismatch');
});
integration('dependency closure missing a transitive wheel fails offline with no descriptor', async t => {
  const f = fixture(t); const omitted = f.manifest.wheels.shift(); fs.unlinkSync(path.join(f.options.wheelhouse, omitted.file)); f.refresh();
  await denied(f, 'process_failed'); assert.ok(f.calls.some(c => c.args.includes('--dry-run'))); unchangedInputs(f);
});
integration('wheel Requires-Dist URL is rejected before venv or pip', async t => {
  const f = fixture(t, { requires: ['mfl-install-dep @ https://invalid.example/never-contact.whl'] });
  await denied(f, 'process_failed'); assert.ok(!f.calls.some(c => c.args.includes('venv')));
});
for (const [name, entries] of [
  ['traversal', [{ path: '../outside.py' }]],
  ['absolute path', [{ path: '/outside.py' }]],
  ['symlink', [{ path: 'mfl_install_probe/escape', symlink: true, text: '/outside' }]],
  ['case collision', [{ path: 'MFL_INSTALL_PROBE/__INIT__.PY' }]],
  ['file/directory collision', [{ path: 'mfl_install_probe/empty.py/child' }]],
]) integration(`wheel archive ${name} fails pre-install audit`, async t => {
  const f = fixture(t, { extraWheelEntries: entries }); await denied(f, 'process_failed');
  assert.ok(!f.calls.some(c => c.args.includes('venv')));
});
integration('manifest path traversal is rejected', async t => {
  const f = fixture(t); f.manifest.model.files[0].path = '../escape'; f.refresh(); await denied(f, 'relative_path_invalid');
});
integration('source model symlink is rejected without touching target', async t => {
  const f = fixture(t), external = path.join(f.parent, 'external'); f.write(external, 'SYNTHETIC_KEEP');
  fs.unlinkSync(path.join(f.options.model, 'config.json')); fs.symlinkSync(external, path.join(f.options.model, 'config.json'));
  await denied(f, 'path_symlink_denied'); assert.equal(fs.readFileSync(external, 'utf8'), 'SYNTHETIC_KEEP');
});
integration('destination symlink and symlink ancestor are rejected', async t => {
  const f = fixture(t), external = path.join(f.parent, 'external'); fs.mkdirSync(external, { mode: 0o700 });
  fs.symlinkSync(external, f.options.root); await assert.rejects(install(f.options, f.contract, f.adapter), /path_symlink_denied/);
  assert.deepEqual(fs.readdirSync(external), []); assert.equal(f.calls.length, 0);
  fs.unlinkSync(f.options.root); const parent = path.dirname(f.options.root), moved = parent + '-real'; fs.renameSync(parent, moved); fs.symlinkSync(moved, parent);
  await assert.rejects(install(f.options, f.contract, f.adapter), /path_symlink_denied/); assert.equal(f.calls.length, 0);
});
integration('input/destination nesting is rejected before execution', async t => {
  const f = fixture(t); f.options.root = path.join(f.options.model, 'new-root'); await denied(f, 'input_destination_overlap'); assert.equal(f.calls.length, 0);
});
integration('insecure pre-existing root is not chmodded or repaired', async t => {
  const f = fixture(t); fs.mkdirSync(f.options.root, { mode: 0o755 }); await denied(f, 'root_not_private_owned');
  assert.equal(fs.statSync(f.options.root).mode & 0o777, 0o755);
});
integration('group writable input is rejected', async t => {
  const f = fixture(t); fs.chmodSync(f.options.worker, 0o660); await denied(f, 'path_permissions_invalid'); assert.equal(f.calls.length, 0);
});
integration('root owned by another uid is rejected (requires chown)', async t => {
  if (process.getuid() !== 0) { t.skip('chown needs root; repeat ownership check on parent host'); return; }
  const f = fixture(t); fs.mkdirSync(f.options.root, { mode: 0o700 }); fs.chownSync(f.options.root, 65534, 65534);
  await denied(f, 'path_owner_invalid');
});
integration('existing descriptor or any occupied root is never overwritten', async t => {
  const f = fixture(t); fs.mkdirSync(f.options.root, { mode: 0o700 }); const file = path.join(f.options.root, 'runtime.json'); f.write(file, 'SYNTHETIC_KEEP');
  await assert.rejects(install(f.options, f.contract, f.adapter), /destination_not_empty/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'SYNTHETIC_KEEP'); assert.equal(f.calls.length, 0);
});
integration('base version mismatch rolls back own staging only', async t => {
  const f = fixture(t); f.manifest.python.version = '3.11.99'; f.refresh(); await denied(f, 'base_interpreter_mismatch'); unchangedInputs(f);
});
integration('failure after venv creation rolls back staging, not inputs/root', async t => {
  const f = fixture(t); fs.mkdirSync(f.options.root, { mode: 0o700 }); const rootInode = fs.statSync(f.options.root).ino;
  wrap(f, 'module', async (original, name, args, context) => {
    await original(name, args, context); if (name === 'venv') throw new InstallError('synthetic_injected_failure');
  });
  await denied(f, 'synthetic_injected_failure'); assert.equal(fs.statSync(f.options.root).ino, rootInode); unchangedInputs(f);
});
integration('abort during preparation cannot publish and only removes own slot', async t => {
  const f = fixture(t), controller = new AbortController();
  wrap(f, 'module', async (original, name, args, context) => { await original(name, args, context); if (name === 'venv') controller.abort(); });
  await assert.rejects(install(f.options, f.contract, f.adapter, controller.signal), /interrupted/); noSlot(f); unchangedInputs(f);
});
integration('root substitution is detected; rollback does not follow the new path', async t => {
  const f = fixture(t); const displaced = path.join(f.parent, 'displaced-owned-root');
  wrap(f, 'inspect', async (original, mode, context, payload) => {
    const value = await original(mode, context, payload);
    if (mode === 'base') { fs.renameSync(f.options.root, displaced); fs.mkdirSync(f.options.root, { mode: 0o700 }); f.write(path.join(f.options.root, 'KEEP'), 'KEEP'); }
    return value;
  });
  await assert.rejects(install(f.options, f.contract, f.adapter), e => e.code === 'root_changed' && e.rollback === 'staging_preserved_identity_or_cleanup_failed');
  assert.equal(fs.readFileSync(path.join(f.options.root, 'KEEP'), 'utf8'), 'KEEP'); noDescriptor(f); assert.equal(fs.readdirSync(displaced).length, 1);
});
integration('unowned orphan from an interrupted prior run is not cleaned or reused', async t => {
  const f = fixture(t); fs.mkdirSync(f.options.root, { mode: 0o700 }); const orphan = path.join(f.options.root, 'runtime-previous-run'); fs.mkdirSync(orphan, { mode: 0o700 });
  f.write(path.join(orphan, 'KEEP'), 'KEEP'); await assert.rejects(install(f.options, f.contract, f.adapter), /destination_not_empty/);
  assert.equal(fs.readFileSync(path.join(orphan, 'KEEP'), 'utf8'), 'KEEP'); assert.equal(f.calls.length, 0);
});
for (const behavior of ['missingIdentity', 'badIdentity', 'badSpan', 'extraLine', 'crash']) {
  integration(`technical worker ${behavior} fails closed and publishes nothing`, async t => {
    const f = fixture(t, { workerBehavior: behavior }); await denied(f); unchangedInputs(f);
  });
}
integration('model mutation during technical smoke prevents publication', async t => {
  const f = fixture(t);
  wrap(f, 'smoke', async (original, context, id, worker, model) => { await original(context, id, worker, model); fs.appendFileSync(path.join(model, 'config.json'), ' '); });
  await denied(f, 'artifact_integrity_mismatch'); unchangedInputs(f);
});
integration('descriptor appearing during work is preserved and own staging is removed', async t => {
  const f = fixture(t);
  wrap(f, 'smoke', async (original, ...args) => { await original(...args); f.write(path.join(f.options.root, 'runtime.json'), 'OTHER_INSTALLER_SENTINEL'); });
  await assert.rejects(install(f.options, f.contract, f.adapter), /destination_changed/);
  assert.deepEqual(fs.readdirSync(f.options.root), ['runtime.json']); assert.equal(fs.readFileSync(path.join(f.options.root, 'runtime.json'), 'utf8'), 'OTHER_INSTALLER_SENTINEL');
});
integration('read-only verify rejects a changed installed package without repair', async t => {
  const f = fixture(t); f.options.receiptSha256 = (await install(f.options, f.contract, f.adapter)).receiptSha256;
  const d = JSON.parse(fs.readFileSync(path.join(f.options.root, 'runtime.json'))), slot = path.dirname(d.workerPath);
  const lib = path.join(slot, 'venv/lib', `python${f.manifest.python.version.split('.').slice(0, 2).join('.')}`, 'site-packages/mfl_install_probe/__init__.py');
  fs.appendFileSync(lib, '\n# tampered\n'); const changed = fs.readFileSync(lib);
  await assert.rejects(verify(f.options, f.contract, f.adapter), /installed_inventory_changed/); assert.deepEqual(fs.readFileSync(lib), changed);
});
integration('canonical production pins reject all synthetic manifests', async t => {
  const f = fixture(t), real = await productionContract(); f.manifest.target = real.target; f.refresh();
  assert.throws(() => loadManifest(f.options, real), /worker_pin_mismatch/); assert.equal(f.calls.length, 0);
  assert.ok(!lockText(f.manifest).includes('https://'));
});
integration('CLI production gating cannot be disabled by environment or fixture flags', async t => {
  if (process.platform === 'darwin' && process.versions.node.startsWith('24.')) { t.skip('non-Mac/unsupported-Node rejection is host-specific'); return; }
  const f = fixture(t); const processResult = spawnSync(process.execPath, [path.join(HERE, 'install-redaction-runtime.mjs'), ...cliArgs(f.options)], {
    encoding: 'utf8', env: { ...process.env, MEDIFLOW_REDACTION_TEST: '1', MEDIFLOW_INSTALL_ALLOW_SYNTHETIC: '1' }, timeout: 30_000,
  });
  assert.equal(processResult.status, 1); assert.match(processResult.stderr, /node24_required|macos_required/); noSlot(f);
});

test('process cancellation waits for child death; stderr is never exposed', { timeout: 10_000 }, async () => {
  const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mediflow-child-synthetic-'));
  let pid;
  const adapter = createProcessAdapter(({ env }) => {
    const child = spawn(process.execPath, ['-e', 'process.stderr.write("SYNTHETIC_SECRET_DO_NOT_LOG");setInterval(()=>{},1000)'], {
      cwd: work, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    }); pid = child.pid; return child;
  });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 100);
  try {
    await assert.rejects(adapter.module('synthetic', [], { python: '/not-used', work, signal: controller.signal, phase: 'synthetic' }), e => e.code === 'interrupted' && !e.message.includes('SECRET'));
    assert.throws(() => process.kill(pid, 0));
  } finally { clearTimeout(timer); fs.rmSync(work, { recursive: true, force: true }); }
});

integration('pip must be an explicit hashed wheel, not an interpreter bootstrap', async t => {
  const f = fixture(t); f.manifest.wheels = f.manifest.wheels.filter(w => w.name !== 'pip'); f.refresh();
  await denied(f, 'explicit_pip_wheel_required'); assert.equal(f.calls.length, 0);
});
integration('last-instant descriptor race uses atomic no-replace publication', async t => {
  const f = fixture(t), original = fs.linkSync;
  fs.linkSync = (source, destination) => {
    if (destination === path.join(f.options.root, 'runtime.json')) f.write(destination, 'ATOMIC_RACE_SENTINEL');
    return original(source, destination);
  };
  try { await assert.rejects(install(f.options, f.contract, f.adapter), /no_overwrite/); }
  finally { fs.linkSync = original; }
  assert.deepEqual(fs.readdirSync(f.options.root), ['runtime.json']);
  assert.equal(fs.readFileSync(path.join(f.options.root, 'runtime.json'), 'utf8'), 'ATOMIC_RACE_SENTINEL'); unchangedInputs(f);
});
integration('SIGKILL at a real staging boundary leaves an orphan; retry refuses it', async t => {
  const f = fixture(t), marker = path.join(f.parent, 'staging-reached');
  const engine = pathToURL(path.join(HERE, 'redaction-install/engine.mjs'));
  const processHelper = pathToURL(path.join(HERE, 'redaction-install/process.mjs'));
  const script = `import fs from 'node:fs';import {spawn} from 'node:child_process';
    import {install} from ${JSON.stringify(engine)};import {createProcessAdapter} from ${JSON.stringify(processHelper)};
    const adapter=createProcessAdapter(({python,args,work,env})=>spawn(python,args,{cwd:work,env,detached:true,stdio:['pipe','pipe','pipe']}));
    const wrapped={...adapter,module:async(...args)=>{await adapter.module(...args);if(args[0]==='venv'){fs.writeFileSync(${JSON.stringify(marker)},'created');setInterval(()=>{},1000);await new Promise(()=>{});}}};
    await install(${JSON.stringify(f.options)},${JSON.stringify(f.contract)},wrapped);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'ignore' });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const until = Date.now() + 15_000;
  while (!fs.existsSync(marker) && Date.now() < until && child.exitCode === null) await new Promise(r => setTimeout(r, 30));
  if (!fs.existsSync(marker)) { child.kill('SIGKILL'); await closed; assert.fail('staging boundary not reached'); }
  child.kill('SIGKILL'); assert.equal((await closed).signal, 'SIGKILL');
  noDescriptor(f); const before = fs.readdirSync(f.options.root); assert.equal(before.length, 1);
  await assert.rejects(install(f.options, f.contract, f.adapter), /destination_not_empty/);
  assert.deepEqual(fs.readdirSync(f.options.root), before); unchangedInputs(f);
});
function pathToURL(file) { return pathToFileURL(file).href; }

integration('verification binds the receipt to the externally recorded digest', async t => {
  const f = fixture(t), outcome = await install(f.options, f.contract, f.adapter);
  f.options.receiptSha256 = outcome.receiptSha256;
  const d = JSON.parse(fs.readFileSync(path.join(f.options.root, 'runtime.json'))), receipt = path.join(path.dirname(d.workerPath), 'installation.json');
  fs.appendFileSync(receipt, ' '); const changed = fs.readFileSync(receipt);
  await assert.rejects(verify(f.options, f.contract, f.adapter), /receipt_integrity_mismatch/);
  assert.deepEqual(fs.readFileSync(receipt), changed);
});
integration('descriptor substitution with a physical base interpreter is rejected', async t => {
  const f = fixture(t), outcome = await install(f.options, f.contract, f.adapter); f.options.receiptSha256 = outcome.receiptSha256;
  const file = path.join(f.options.root, 'runtime.json'), d = JSON.parse(fs.readFileSync(file));
  d.pythonExecutable = fs.realpathSync(f.options.python); fs.writeFileSync(file, JSON.stringify(d));
  await assert.rejects(verify(f.options, f.contract, f.adapter), /descriptor_path_invalid/);
});
test('bounded process timeout and output limit fail without leaking stdout/stderr', { timeout: 10_000 }, async () => {
  const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mediflow-process-synthetic-'));
  try {
    for (const [script, timeout, expected] of [
      ['setInterval(()=>{},1000)', 80, 'process_timeout'],
      ['process.stdout.write("SYNTHETIC_SECRET".repeat(100000));setInterval(()=>{},1000)', 3000, 'process_output_limit'],
    ]) {
      const adapter = createProcessAdapter(({ env }) => spawn(process.execPath, ['-e', script], { cwd: work, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] }));
      await assert.rejects(adapter.module('unused', [], { python: '/unused', work, phase: 'synthetic', timeout }), e => e.code === expected && !e.message.includes('SECRET'));
    }
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});
