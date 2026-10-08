/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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

// Guard-only experiments need a deliberately changed dependency to reach the
// import probe. Re-pin that ONE mutation in a disposable copy of the checker;
// never add a bypass to the production API or count these as payload approval.
async function scratchProbeChecker(f: ReturnType<typeof fixture>, relative: string): Promise<typeof assertScheduledBackupRuntime> {
  assert.ok(relative.startsWith('node_modules/'));
  const original = fs.readFileSync(path.join(dependencyRoot, relative.slice('node_modules/'.length)));
  const originalHash = createHash('sha256').update(original).digest('hex');
  const mutatedHash = createHash('sha256').update(fs.readFileSync(path.join(f.payload, relative))).digest('hex');
  assert.notEqual(mutatedHash, originalHash);
  const source = fs.readFileSync(path.join(sourceRoot, 'scripts/scheduled-backup-runtime-contract.mjs'), 'utf8');
  assert.equal(source.split(`'${originalHash}'`).length, 2, 'exactly one test-only pin must be replaced');
  const checker = path.join(f.dir, 'scratch-probe-contract.mjs');
  fs.writeFileSync(checker, source.replace(`'${originalHash}'`, `'${mutatedHash}'`));
  const scratch = await import(pathToFileURL(checker).href);
  return scratch.assertScheduledBackupRuntime;
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

for (const relative of SCHEDULED_BACKUP_TRACING_INCLUDES
  .map(file => file.slice(2)).filter(file => file.startsWith('node_modules/') && !file.endsWith('.node'))) {
  test(`production gate rejects changed dependency bytes: ${relative}`, async () => {
    const f = fixture();
    try {
      // Whitespace preserves valid JS/JSON: rejection must be byte identity,
      // independent of package name/version, parse success or child output.
      fs.appendFileSync(path.join(f.payload, relative), '\n');
      await assert.rejects(assertScheduledBackupRuntime(f.payload), error => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, `scheduled backup runtime: dependency hash mismatch: ${relative}`);
        return true;
      });
    } finally { f.cleanup(); }
  });
}

test('production gate rejects a forged success receipt hiding a broken transitive dependency', async () => {
  const f = fixture();
  try {
    const positive = await assertScheduledBackupRuntime(f.payload);
    const broken = path.join(f.payload, 'node_modules/better-sqlite3/lib/methods/aggregate.js');
    fs.writeFileSync(broken, 'this is deliberately invalid JavaScript !!!\n');
    await assert.rejects(assertScheduledBackupRuntime(f.payload), /dependency hash mismatch:.*aggregate.js/);
    const fake = { imported: true, databaseAccess: 'denied', resolvedFiles: positive.resolvedFiles };
    const index = path.join(f.payload, 'node_modules/better-sqlite3/lib/index.js');
    fs.writeFileSync(index, `process.stdout.write(${JSON.stringify(JSON.stringify(fake))}); process.exit(0);\n${fs.readFileSync(index, 'utf8')}`);
    await assert.rejects(assertScheduledBackupRuntime(f.payload), /dependency hash mismatch:.*lib\/index.js/);
    assert.match(fs.readFileSync(broken, 'utf8'), /invalid JavaScript/);
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

test('scratch probe guard: real CJS transitive resolution cannot escape its approved closure', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.payload, 'unexpected.cjs'), 'module.exports = 1;');
    fs.appendFileSync(path.join(f.payload, 'node_modules/bindings/bindings.js'), '\nrequire("../../unexpected.cjs");\n');
    const checkProbe = await scratchProbeChecker(f, 'node_modules/bindings/bindings.js');
    await assert.rejects(checkProbe(f.payload), /resolution outside approved payload closure/);
  } finally { f.cleanup(); }
});

test('scratch probe guard: real import process cannot write a database', async () => {
  const f = fixture();
  try {
    fs.appendFileSync(path.join(f.payload, 'node_modules/bindings/bindings.js'),
      '\nrequire("node:fs").writeFileSync(process.env.MEDIFLOW_DATA_DIR, "unexpected database");\n');
    const checkProbe = await scratchProbeChecker(f, 'node_modules/bindings/bindings.js');
    await assert.rejects(checkProbe(f.payload), /ERR_ACCESS_DENIED/);
  } finally { f.cleanup(); }
});

test('scratch probe guard: real import process cannot construct even an in-memory SQLite database', async () => {
  const f = fixture();
  try {
    fs.appendFileSync(path.join(f.payload, 'node_modules/better-sqlite3/lib/index.js'),
      '\nmodule.exports(":memory:");\n');
    const checkProbe = await scratchProbeChecker(f, 'node_modules/better-sqlite3/lib/index.js');
    await assert.rejects(checkProbe(f.payload), /Cannot load native addon|ERR_DLOPEN_DISABLED|ERR_ACCESS_DENIED/);
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

test('scratch probe guard: timeout waits for its owned import process to close', async () => {
  const f = fixture();
  try {
    fs.appendFileSync(path.join(f.payload, 'node_modules/bindings/bindings.js'), '\nwhile (true) {}\n');
    const checkProbe = await scratchProbeChecker(f, 'node_modules/bindings/bindings.js');
    await assert.rejects(checkProbe(f.payload, { timeoutMs: 250 }), /import exceeded 250ms/);
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
