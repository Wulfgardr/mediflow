/* @Codex */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Reviewed source identity, independent of the checkout used to run this gate.
// Changes to this closure require review and a deliberate update of these pins.
export const SCHEDULED_BACKUP_RUNTIME_ROSTER = Object.freeze([
  ['scripts/run-scheduled-backup.mjs', 'd0446a62097d13a7c5ca1c6d0f3203d077e90997b4c920d47d2b554d5880c913'],
  ['scripts/scheduled-backup-date-fields.mjs', '508ca02d04a291113d6f714eb6169420d7e16d760a7981ce600edc312393403c'],
  ['lib/sqlite-maintenance-admission.mjs', 'd042bf1258a300bbd085593088c0051f51f975636eca33b29c9b11e9d3d3f556'],
  ['lib/sqlite-durability.mjs', '75dc15f8a383bf040d6a0b494a2889d136be248772f5ddca7cd29651d5a4a103'],
  ['lib/backup-audit.ts', 'd58f0e13136e8be04823839f4a61394bb85404da9603803f9a0b27c396243c56'],
  ['lib/exemption-import-receipt.ts', '894cc749fa4f512f65d10e3ff66f0a445b129cd23c56627bfe0c549a932c1e3a'],
  ['lib/exemption-import-contract.ts', '12b97b4a54bca6a3d56103f442035b81d5269ec276789ee2febc0560e533b0e0'],
  ['lib/reference-data/prosthetics-catalog-backup.ts', 'dc495f22cbc6621ed22737510500b62a317a828c1c40852141452f7294cee063'],
  ['lib/reference-data/prosthetics-catalog-contract.ts', '2cca69ebd004209504aae0ee3605fb25634d73bc73080bad7aaa6ac1de0dc2b9'],
].map(([file, sha256]) => Object.freeze({ path: file, sha256 })));

// Import closure from lock-pinned better-sqlite3 12.6.2, bindings 1.5.0 and
// file-uri-to-path 1.0.0. JS/JSON bytes were independently compared with the
// integrity-verified installation. Never derive these pins from the payload:
// dependency code could otherwise forge the child's success receipt and exit.
// This is not an SBOM. prebuild-install is installation tooling; the native
// file has a presence check only and retains its separate ABI gate.
const DEPENDENCY_ROSTER = Object.freeze([
  ['better-sqlite3/package.json', '2477bed8910fa9e3a842f20721f86927ef6d1424851f423539c644e48ec20e84'],
  ['better-sqlite3/build/Release/better_sqlite3.node', null],
  ['better-sqlite3/lib/index.js', '82db11c4ee43a41d859988c5db42c3771dff565371f94bacbd1e4d8d6ceb47cd'],
  ['better-sqlite3/lib/database.js', '02ea23bdd23d7ac5de0675a2f32fc686e76d5c6a32bd3e3891f360e72e07f61f'],
  ['better-sqlite3/lib/sqlite-error.js', '2582d61c27680dead168543f392eb102be621dfbef282a4ca4c7c21aa5e7c75d'],
  ['better-sqlite3/lib/util.js', '92b2e39e2151b43a2252e10b6d6de876ecaf0008336a4fa1dfe1317b20f1916f'],
  ['better-sqlite3/lib/methods/aggregate.js', 'e9f74eb919ec93fe089c95ddf25a98f1f631c80418fa34fb2346ca1bc29f1b82'],
  ['better-sqlite3/lib/methods/backup.js', 'ea29d34992bb02e006d0fdeda9675ac5d2bb227aaf57468decd997e9fc9c7dbf'],
  ['better-sqlite3/lib/methods/function.js', 'f431d49303b8bbdc044b1f1b455bdad21fc9b74b007de0acb22f08f25b4febd3'],
  ['better-sqlite3/lib/methods/inspect.js', '4975a78daee850adee62ba98719d0f223819a0ec135a07c0e302994bd8dbff61'],
  ['better-sqlite3/lib/methods/pragma.js', '8b1c54475bd4340b15e25c50d53d06308be65f8f919ecbe4aa9d285ca859ad5a'],
  ['better-sqlite3/lib/methods/serialize.js', '7a10ee5c2735384b7f0c361811bc6d017db29f62b203fd3c68a35f667e2c2605'],
  ['better-sqlite3/lib/methods/table.js', '97c42d9ded1aa96c7d916b5b92f96b4e59581d50eaf629cd2c7afb78ff26a9ea'],
  ['better-sqlite3/lib/methods/transaction.js', 'bc8624a3ef689d8f78e5669020ad121e17acbc93b1d5ee5afe26860b1084c66c'],
  ['better-sqlite3/lib/methods/wrappers.js', 'a150a6271d23f4e5f8953b129f370ff096c7cdc4b812afbf080a6cf4ab741bcf'],
  ['bindings/package.json', 'a87721fe406e1f1798fef44d697b46ea1efe346fda118010334713346ee4207c'],
  ['bindings/bindings.js', '8e32a0d37f20bd6f7d5bdbf99d041aa27be47cbbe5172ac13ebf7380a10b3bf6'],
  ['file-uri-to-path/package.json', '71eb1e24bb9694f89c613fa0aa307f977dd43f41d11794c7b48fabf6c55f66b0'],
  ['file-uri-to-path/index.js', 'e62293e871bdd5a7449ff3c7956c9536ec1d2ea7369461de77322b5256bb93e7'],
].map(([file, sha256]) => Object.freeze({ path: `node_modules/${file}`, sha256 })));
const DEPENDENCY_FILES = Object.freeze(DEPENDENCY_ROSTER.map(item => item.path));

export const SCHEDULED_BACKUP_TRACING_INCLUDES = Object.freeze([
  ...SCHEDULED_BACKUP_RUNTIME_ROSTER.map(item => `./${item.path}`),
  ...DEPENDENCY_FILES.map(file => `./${file}`),
]);

const PREFIX = 'scheduled backup runtime: ';
function fail(message) { throw new Error(PREFIX + message); }

function physicalFile(root, relative) {
  let current = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail(`symlink is not a payload file: ${relative}`);
    if (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) {
      fail(`expected physical file: ${relative}`);
    }
  }
  const resolved = fs.realpathSync(current);
  if (resolved !== current) fail(`file escapes physical payload: ${relative}`);
  return current;
}

// Serialized into a fresh Node process. No application main, DB open, native
// addon, write, child process, inherited loader or global search path is allowed.
async function importProbe(root, files) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const { createRequire, isBuiltin, registerHooks } = await import('node:module');
  if (process.argv.length !== 1 || !process.permission
      || process.permission.has('fs.write') || process.permission.has('addons')) {
    throw new Error('probe must have no main argument, write permission or native addon permission');
  }
  const allowed = new Set(files.map(file => path.join(root, file)));
  const resolvedFiles = new Set();
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'node:sqlite' || specifier === 'sqlite') throw new Error('DB access forbidden');
      const result = nextResolve(specifier, context);
      if (isBuiltin(result.url)) return result;
      const url = new URL(result.url);
      if (url.protocol !== 'file:' || url.search || url.hash) throw new Error('non-payload resolution');
      const filename = fileURLToPath(url);
      if (!allowed.has(filename) || fs.realpathSync(filename) !== filename) {
        throw new Error(`resolution outside approved payload closure: ${filename}`);
      }
      resolvedFiles.add(path.relative(root, filename).split(path.sep).join('/'));
      return result;
    },
  });
  const runner = pathToFileURL(path.join(root, 'scripts/run-scheduled-backup.mjs'));
  await import(runner.href);
  // better-sqlite3 loads bindings lazily on construction: import both real CJS
  // packages explicitly, without constructing a database or loading its addon.
  const require = createRequire(runner);
  for (const [name, entry] of [
    ['better-sqlite3', 'better-sqlite3/lib/index.js'],
    ['bindings', 'bindings/bindings.js'],
    ['file-uri-to-path', 'file-uri-to-path/index.js'],
  ]) {
    if (require.resolve(name) !== path.join(root, 'node_modules', entry)) {
      throw new Error(`unexpected package entry: ${name}`);
    }
    if (typeof require(name) !== 'function') throw new Error(`unexpected package export: ${name}`);
  }
  if (fs.existsSync(process.env.MEDIFLOW_DATA_DIR)) throw new Error('probe created a data directory');
  console.log(JSON.stringify({ imported: true, databaseAccess: 'denied', resolvedFiles: [...resolvedFiles].sort() }));
}

function probeChild(root, probeRoot, timeoutMs) {
  const files = [...SCHEDULED_BACKUP_RUNTIME_ROSTER.map(item => item.path), ...DEPENDENCY_FILES];
  const code = `(${importProbe.toString()})(${JSON.stringify(root)},${JSON.stringify(files)}).catch(error => { console.error(error); process.exitCode = 1; });`;
  return new Promise((resolve, reject) => {
    let output = '';
    let failure;
    let killTimer;
    const child = spawn(process.execPath, [
      '--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${probeRoot}`,
      '--no-global-search-paths', '--input-type=module', '-e', code,
    ], {
      cwd: root,
      env: {
        MEDIFLOW_DATA_DIR: path.join(probeRoot, 'forbidden-data'),
        MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', NEXT_TELEMETRY_DISABLED: '1',
        ...(process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stop = message => {
      if (failure) return;
      failure = new Error(PREFIX + message);
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 250);
    };
    const timer = setTimeout(() => stop(`import exceeded ${timeoutMs}ms`), timeoutMs);
    const receive = bytes => {
      output += bytes.toString();
      if (output.length > 64 * 1024) { output = output.slice(0, 64 * 1024); stop('import output exceeded limit'); }
    };
    child.stdout.on('data', receive);
    // Keep diagnostics separate so a successful import cannot conceal a failed
    // JSON receipt among warnings from Node's TypeScript module detection.
    let diagnostics = '';
    child.stderr.on('data', bytes => {
      diagnostics += bytes.toString();
      if (diagnostics.length > 64 * 1024) { diagnostics = diagnostics.slice(0, 64 * 1024); stop('import diagnostics exceeded limit'); }
    });
    child.once('error', error => { failure = new Error(PREFIX + error.message); });
    child.once('close', (status, signal) => {
      clearTimeout(timer); clearTimeout(killTimer);
      if (failure) { reject(failure); return; }
      if (status !== 0) { reject(new Error(PREFIX + `import failed (${status ?? signal}): ${diagnostics.trim()}`)); return; }
      try { resolve(JSON.parse(output.trim())); }
      catch { reject(new Error(PREFIX + 'import did not return its receipt')); }
    });
  });
}

/** Verify the physical payload supplied by the caller, without running a job.
 * Does not qualify a distributed artifact unless called on that exact artifact;
 * does not qualify native ABI, signing, audit recovery or online repair drain.
 */
export async function assertScheduledBackupRuntime(runtimeRoot, { timeoutMs = 10_000 } = {}) {
  let probeRoot;
  try {
    if (process.versions.node.split('.')[0] !== '24') fail('Node 24 is required');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) fail('timeout must be 1–60000ms');
    if (typeof runtimeRoot !== 'string' || !path.isAbsolute(runtimeRoot)) fail('runtime root must be absolute');
    const rootStat = fs.lstatSync(runtimeRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('runtime root must be a physical directory');
    const root = fs.realpathSync(runtimeRoot);
    for (const item of SCHEDULED_BACKUP_RUNTIME_ROSTER) {
      const file = physicalFile(root, item.path);
      if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== item.sha256) {
        fail(`source hash mismatch: ${item.path}`);
      }
    }
    for (const item of DEPENDENCY_ROSTER) {
      const file = physicalFile(root, item.path);
      if (item.sha256 !== null && createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== item.sha256) {
        fail(`dependency hash mismatch: ${item.path}`);
      }
    }
    for (const [name, version] of [['better-sqlite3', '12.6.2'], ['bindings', '1.5.0'], ['file-uri-to-path', '1.0.0']]) {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
      if (manifest.name !== name || manifest.version !== version) fail(`unexpected package identity: ${name}`);
    }
    probeRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-scheduler-import-')));
    const receipt = await probeChild(root, probeRoot, timeoutMs);
    if (receipt.imported !== true || receipt.databaseAccess !== 'denied'
        || !Array.isArray(receipt.resolvedFiles)
        || SCHEDULED_BACKUP_RUNTIME_ROSTER.some(item => !receipt.resolvedFiles.includes(item.path))) {
      fail('incomplete import receipt');
    }
    if (fs.readdirSync(probeRoot).length) fail('import changed its synthetic data directory');
    return Object.freeze({ runtimeRoot: root, sourceFiles: SCHEDULED_BACKUP_RUNTIME_ROSTER.length,
      imported: true, databaseAccess: 'denied', resolvedFiles: Object.freeze(receipt.resolvedFiles) });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(PREFIX)) throw error;
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    // probeChild settles on terminal close, including timeout/error paths.
    if (probeRoot) fs.rmSync(probeRoot, { recursive: true, force: true });
  }
}

// Keep the module graph synchronous: Next's transpiled config loads this ESM
// module via require(). Even an unexecuted top-level await blocks that boundary.
async function runCli() {
  if (process.argv.length !== 4 || process.argv[2] !== '--runtime-root') fail('usage: --runtime-root PATH');
  console.log(JSON.stringify(await assertScheduledBackupRuntime(process.argv[3])));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
