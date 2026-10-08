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
  ['lib/sqlite-maintenance-admission.mjs', '51874cfccee20bf43ac82da5ee69c9dac801e0b5533aa541f9fa924377cb8a4e'],
  ['lib/backup-audit.ts', 'd58f0e13136e8be04823839f4a61394bb85404da9603803f9a0b27c396243c56'],
  ['lib/exemption-import-receipt.ts', '894cc749fa4f512f65d10e3ff66f0a445b129cd23c56627bfe0c549a932c1e3a'],
  ['lib/exemption-import-contract.ts', '12b97b4a54bca6a3d56103f442035b81d5269ec276789ee2febc0560e533b0e0'],
  ['lib/reference-data/prosthetics-catalog-backup.ts', 'dc495f22cbc6621ed22737510500b62a317a828c1c40852141452f7294cee063'],
  ['lib/reference-data/prosthetics-catalog-contract.ts', '2cca69ebd004209504aae0ee3605fb25634d73bc73080bad7aaa6ac1de0dc2b9'],
].map(([file, sha256]) => Object.freeze({ path: file, sha256 })));

// Runtime import closure, not an SBOM. prebuild-install is installation tooling.
// Presence of the native file is checked; its ABI is a separate runtime gate.
const DEPENDENCY_FILES = Object.freeze([
  'better-sqlite3/package.json',
  'better-sqlite3/build/Release/better_sqlite3.node',
  'better-sqlite3/lib/index.js', 'better-sqlite3/lib/database.js',
  'better-sqlite3/lib/sqlite-error.js', 'better-sqlite3/lib/util.js',
  ...['aggregate', 'backup', 'function', 'inspect', 'pragma', 'serialize', 'table', 'transaction', 'wrappers']
    .map(name => `better-sqlite3/lib/methods/${name}.js`),
  'bindings/package.json', 'bindings/bindings.js',
  'file-uri-to-path/package.json', 'file-uri-to-path/index.js',
].map(file => `node_modules/${file}`));

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
    for (const file of DEPENDENCY_FILES) physicalFile(root, file);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--runtime-root') fail('usage: --runtime-root PATH');
    console.log(JSON.stringify(await assertScheduledBackupRuntime(process.argv[3])));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
