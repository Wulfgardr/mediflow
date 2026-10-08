/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SCHEDULED_BACKUP_RUNTIME_ROSTER,
  SCHEDULED_BACKUP_TRACING_INCLUDES,
  assertScheduledBackupRuntime,
} from '../scripts/scheduled-backup-runtime-contract.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
// Only fixture construction uses this explicit local dependency source. The
// production checker never inherits it and never resolves from this checkout.
const dependencyRoot = process.env.C15_SCHEDULER_DEPENDENCY_ROOT ?? path.join(sourceRoot, 'node_modules');
function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-scheduler-payload-')));
  const payload = path.join(dir, 'payload');
  fs.mkdirSync(payload);
  for (const entry of SCHEDULED_BACKUP_TRACING_INCLUDES) {
    const relative = entry.slice(2);
    const source = relative.startsWith('node_modules/')
      ? path.join(dependencyRoot, relative.slice('node_modules/'.length)) : path.join(sourceRoot, relative);
    const destination = path.join(payload, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    assert.equal(fs.lstatSync(destination).isSymbolicLink(), false);
  }
  return { dir, payload, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('real isolated payload imports all eight approved sources and real ESM/CJS dependencies without a database', async () => {
  const f = fixture();
  try {
    const receipt = await assertScheduledBackupRuntime(f.payload);
    assert.equal(receipt.imported, true);
    assert.equal(receipt.databaseAccess, 'denied');
    assert.equal(receipt.sourceFiles, 8);
    assert.ok(receipt.resolvedFiles.includes('node_modules/better-sqlite3/lib/database.js'));
    assert.ok(receipt.resolvedFiles.includes('node_modules/bindings/bindings.js'));
    assert.ok(receipt.resolvedFiles.includes('node_modules/file-uri-to-path/index.js'));
    assert.equal(fs.existsSync(path.join(f.payload, 'medical.db')), false);
    assert.equal(fs.existsSync(path.join(f.payload, 'data')), false);
  } finally { f.cleanup(); }
});

test('tracing roster contains every approved source and the explicit native/import closure without duplicates', () => {
  assert.equal(SCHEDULED_BACKUP_RUNTIME_ROSTER.length, 8);
  assert.equal(new Set(SCHEDULED_BACKUP_TRACING_INCLUDES).size, SCHEDULED_BACKUP_TRACING_INCLUDES.length);
  for (const item of SCHEDULED_BACKUP_RUNTIME_ROSTER) {
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    assert.ok(SCHEDULED_BACKUP_TRACING_INCLUDES.includes(`./${item.path}`));
  }
  assert.ok(SCHEDULED_BACKUP_TRACING_INCLUDES.includes('./node_modules/better-sqlite3/build/Release/better_sqlite3.node'));
});

for (const relative of ['lib/sqlite-maintenance-admission.mjs', 'lib/exemption-import-contract.ts',
  'lib/reference-data/prosthetics-catalog-contract.ts', 'node_modules/better-sqlite3/lib/methods/table.js',
  'node_modules/file-uri-to-path/index.js', 'node_modules/better-sqlite3/build/Release/better_sqlite3.node']) {
  test(`missing runtime closure fails closed: ${relative}`, async () => {
    const f = fixture();
    try {
      fs.unlinkSync(path.join(f.payload, relative));
      await assert.rejects(assertScheduledBackupRuntime(f.payload), /scheduled backup runtime:.*ENOENT/);
    } finally { f.cleanup(); }
  });
}

test('altered admission source is rejected even if it still parses and imports', async () => {
  const f = fixture();
  try {
    fs.appendFileSync(path.join(f.payload, 'lib/sqlite-maintenance-admission.mjs'), '\n// altered payload\n');
    await assert.rejects(assertScheduledBackupRuntime(f.payload), /source hash mismatch: lib\/sqlite-maintenance-admission.mjs/);
  } finally { f.cleanup(); }
});

test('source symlink is rejected despite exact target bytes', async () => {
  const f = fixture();
  try {
    const file = path.join(f.payload, 'lib/sqlite-maintenance-admission.mjs');
    const outside = path.join(f.dir, 'admission.mjs');
    fs.renameSync(file, outside);
    fs.symlinkSync(outside, file);
    await assert.rejects(assertScheduledBackupRuntime(f.payload), /symlink/);
  } finally { f.cleanup(); }
});

test('symlink payload root and dependency directory cannot use checkout fallback', async () => {
  const f = fixture();
  try {
    const alias = path.join(f.dir, 'alias');
    fs.symlinkSync(f.payload, alias, 'junction');
    await assert.rejects(assertScheduledBackupRuntime(alias), /physical directory/);
    const dependencies = path.join(f.payload, 'node_modules');
    const outside = path.join(f.dir, 'dependencies');
    fs.renameSync(dependencies, outside);
    fs.symlinkSync(outside, dependencies, 'junction');
    await assert.rejects(assertScheduledBackupRuntime(f.payload), /symlink/);
  } finally { f.cleanup(); }
});

test('ordinary Node parent node_modules fallback can import, but the payload gate rejects it', async () => {
  const f = fixture();
  try {
    fs.renameSync(path.join(f.payload, 'node_modules'), path.join(f.dir, 'node_modules'));
    const baseline = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${f.dir}`,
      '--no-global-search-paths', '--input-type=module', '-e',
      `await import(${JSON.stringify(pathToFileURL(path.join(f.payload, 'scripts/run-scheduled-backup.mjs')).href)});`], {
      cwd: f.payload, env: { NODE_ENV: 'test', MEDIFLOW_DATA_DIR: path.join(f.dir, 'never-create-data') }, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(baseline.status, 0, baseline.stderr);
    assert.equal(fs.existsSync(path.join(f.dir, 'never-create-data')), false);
    await assert.rejects(assertScheduledBackupRuntime(f.payload), /scheduled backup runtime:.*ENOENT/);
  } finally { f.cleanup(); }
});

test('real CJS transitive resolution cannot escape the approved closure inside the payload', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.payload, 'unexpected.cjs'), 'module.exports = 1;');
    fs.appendFileSync(path.join(f.payload, 'node_modules/bindings/bindings.js'), '\nrequire("../../unexpected.cjs");\n');
    await assert.rejects(assertScheduledBackupRuntime(f.payload), /resolution outside approved payload closure/);
  } finally { f.cleanup(); }
});

test('the real import process cannot write a database', async () => {
  const f = fixture();
  try {
    fs.appendFileSync(path.join(f.payload, 'node_modules/bindings/bindings.js'),
      '\nrequire("node:fs").writeFileSync(process.env.MEDIFLOW_DATA_DIR, "unexpected database");\n');
    await assert.rejects(assertScheduledBackupRuntime(f.payload), /ERR_ACCESS_DENIED/);
  } finally { f.cleanup(); }
});

test('the real import process cannot construct even an in-memory SQLite database', async () => {
  const f = fixture();
  try {
    fs.appendFileSync(path.join(f.payload, 'node_modules/better-sqlite3/lib/index.js'),
      '\nmodule.exports(":memory:");\n');
    await assert.rejects(assertScheduledBackupRuntime(f.payload), /Cannot load native addon|ERR_DLOPEN_DISABLED|ERR_ACCESS_DENIED/);
  } finally { f.cleanup(); }
});

test('configuration can import the contract without dependencies or persistent access', () => {
  const f = fixture();
  try {
    const contract = path.join(f.dir, 'contract.mjs');
    fs.copyFileSync(path.join(sourceRoot, 'scripts/scheduled-backup-runtime-contract.mjs'), contract);
    const run = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${f.dir}`,
      '--input-type=module', '-e', `const m = await import(${JSON.stringify(pathToFileURL(contract).href)}); console.log(m.SCHEDULED_BACKUP_RUNTIME_ROSTER.length);`], {
      cwd: f.dir, env: { NODE_ENV: 'test' }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), '8');
  } finally { f.cleanup(); }
});

test('timeout fails closed and waits for its owned import process to close', async () => {
  const f = fixture();
  try {
    fs.appendFileSync(path.join(f.payload, 'node_modules/bindings/bindings.js'), '\nwhile (true) {}\n');
    await assert.rejects(assertScheduledBackupRuntime(f.payload, { timeoutMs: 250 }), /import exceeded 250ms/);
    // Terminal close precedes return: removing the physical fixture is safe.
  } finally { f.cleanup(); }
});

test('CLI checks the supplied payload and reports failure with a stable prefix', () => {
  const f = fixture();
  try {
    const cli = path.join(sourceRoot, 'scripts/scheduled-backup-runtime-contract.mjs');
    const options: SpawnSyncOptionsWithStringEncoding = {
      cwd: f.dir, env: { NODE_ENV: 'test', MEDIFLOW_DATA_DIR: path.join(f.dir, 'unused') }, encoding: 'utf8', timeout: 15_000,
    };
    const success = spawnSync(process.execPath, [cli, '--runtime-root', f.payload], options);
    assert.equal(success.status, 0, success.stderr);
    assert.equal(JSON.parse(success.stdout).imported, true);
    fs.unlinkSync(path.join(f.payload, 'lib/sqlite-maintenance-admission.mjs'));
    const failure = spawnSync(process.execPath, [cli, '--runtime-root', f.payload], options);
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /scheduled backup runtime:/);
  } finally { f.cleanup(); }
});
