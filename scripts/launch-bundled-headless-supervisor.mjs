/* @Codex: MCP-only app entrypoint. Invoke with an explicit, provisioned Node;
 * never an env shebang, PATH search, runtime installer or second supervisor. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as nodeModule from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Committed by stage-headless-runtime AFTER inner signing, BEFORE the outer seal.
const ROSTER_SHA256 = '__MEDIFLOW_HEADLESS_ROSTER_SHA256__';
const SELF = fileURLToPath(import.meta.url);
const RESOURCES = path.dirname(SELF);
const CONTENTS = path.dirname(RESOURCES);
const WEB = path.join(RESOURCES, 'WebRuntime');
const RUNTIME = path.join(WEB, 'HeadlessRuntime');
const PREFIX = 'Resources/WebRuntime/HeadlessRuntime/';
const ROSTER = 'headless-roster.json';
const SERVER_ONLY = 'data:text/javascript,export%20%7B%7D%3B';
const { isBuiltin, registerHooks } = nodeModule;
const fail = () => { throw new Error('headless_bundle_invalid'); };
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Do not canonicalize an alias into an accepted input; inspect every ancestor.
export function physicalPath(value, directory = false) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value
    || /[\x00-\x1f\x7f\\]/u.test(value)) fail();
  let current = path.parse(value).root;
  const parts = value.slice(current.length).split(path.sep);
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (index < parts.length - 1 || directory
      ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) fail();
  }
  if (fs.realpathSync(value) !== value) fail();
  return value;
}
export function physicalRecord(file) {
  physicalPath(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd), bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
    const named = fs.lstatSync(file);
    if (!after.isFile() || after.nlink !== 1 || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || named.ino !== after.ino || named.dev !== after.dev) fail();
    return { sha256: sha256(bytes), bytes: bytes.length, mode: after.mode & 0o7777 };
  } finally { fs.closeSync(fd); }
}
function sameRecord(expected, file) {
  const actual = physicalRecord(file);
  if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes || actual.mode !== expected.mode) fail();
}
function relativeFile(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')
    || /[\x00-\x1f\x7f]/u.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) fail();
  return value;
}
export function physicalFiles(root) {
  physicalPath(root, true);
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { physicalPath(file, true); visit(file); }
      else { physicalPath(file); files.push(path.relative(root, file).split(path.sep).join('/')); }
    }
  }
  visit(root);
  return files.sort();
}
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail();
}
function identityEnvironment(value) {
  exactKeys(value, ['schemaVersion', 'revision', 'branch', 'worktreeHash', 'sourceFingerprint', 'buildId']);
  if (value.schemaVersion !== 1 || !/^(?:[0-9a-f]{12}|[0-9a-f]{40})$/u.test(value.revision)
    || ![value.branch, value.worktreeHash, value.buildId].every(item => typeof item === 'string' && item.trim())
    || value.sourceFingerprint !== `${value.branch}@${value.revision}:${value.worktreeHash}`) fail();
  return {
    MEDIFLOW_APP_REVISION: value.revision, MEDIFLOW_APP_BRANCH: value.branch,
    MEDIFLOW_APP_WORKTREE_HASH: value.worktreeHash,
    MEDIFLOW_APP_SOURCE_FINGERPRINT: value.sourceFingerprint,
    MEDIFLOW_APP_FINGERPRINT: value.sourceFingerprint,
  };
}
export function verifyHeadlessBundle() {
  if (path.basename(RESOURCES) !== 'Resources' || path.basename(CONTENTS) !== 'Contents'
    || !path.dirname(CONTENTS).endsWith('.app') || !/^[a-f0-9]{64}$/u.test(ROSTER_SHA256)) fail();
  physicalPath(SELF); physicalPath(RUNTIME, true);
  if ((fs.statSync(SELF).mode & 0o7777) !== 0o644) fail();
  const rosterFile = path.join(RUNTIME, ROSTER);
  physicalPath(rosterFile);
  if ((fs.statSync(rosterFile).mode & 0o7777) !== 0o644) fail();
  const bytes = fs.readFileSync(rosterFile);
  if (sha256(bytes) !== ROSTER_SHA256) fail();
  const roster = JSON.parse(bytes);
  exactKeys(roster, ['schemaVersion', 'mode', 'node', 'identity', 'files']);
  if (roster.schemaVersion !== 1 || roster.mode !== 'mcp' || !Array.isArray(roster.files) || !roster.files.length) fail();
  const entries = new Map();
  for (const item of roster.files) {
    exactKeys(item, ['path', 'sha256', 'bytes', 'mode']);
    const name = relativeFile(item.path);
    if ((!name.startsWith('Resources/WebRuntime/') && !name.startsWith('Frameworks/'))
      || entries.has(name) || name === `${PREFIX}${ROSTER}` || !/^[a-f0-9]{64}$/u.test(item.sha256)
      || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !Number.isInteger(item.mode)
      || item.mode < 0 || item.mode > 0o777 || (item.mode & 0o022)) fail();
    sameRecord(item, path.join(CONTENTS, name)); entries.set(name, item);
  }
  const owned = [...entries.keys()].filter(name => name.startsWith(PREFIX)).map(name => name.slice(PREFIX.length));
  const expected = [...owned, ROSTER].sort();
  if (JSON.stringify(physicalFiles(RUNTIME)) !== JSON.stringify(expected)) fail();
  // Empty unrostered directories are also substitutions, not free module-search roots.
  const directories = new Set(['']);
  for (const name of expected) {
    let parent = path.posix.dirname(name);
    while (parent !== '.') { directories.add(parent); parent = path.posix.dirname(parent); }
  }
  const checkDirectories = (directory, relative = '') => {
    if (!directories.has(relative)) fail();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) checkDirectories(path.join(directory, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
    }
  };
  checkDirectories(RUNTIME);
  for (const name of ['scripts/mediflow-headless-supervisor.mjs', 'scripts/intelligent-host-mcp-stdio.mjs',
    'scripts/register-strip-types-loader.mjs', 'scripts/headless-source-loader.mjs',
    'scripts/node-runtime-contract.mjs', 'lib/security/portable-supervisor-production.ts', '.nvmrc', 'package.json']) {
    if (!entries.has(`${PREFIX}${name}`)) fail();
  }
  for (const name of ['server.js', 'mediflow-build-identity.json', 'mediflow-runtime-contract.json', '.next/BUILD_ID', 'package.json']) {
    if (!entries.has(`Resources/WebRuntime/${name}`)) fail();
  }
  if ([...entries.keys()].some(name => /(?:^|\/)packages\/mini\//u.test(name))) fail();
  const identity = JSON.parse(fs.readFileSync(path.join(WEB, 'mediflow-build-identity.json'), 'utf8'));
  const environment = identityEnvironment(identity);
  if (JSON.stringify(identity) !== JSON.stringify(roster.identity)
    || fs.readFileSync(path.join(WEB, '.next/BUILD_ID'), 'utf8').trim() !== identity.buildId) fail();
  const contract = JSON.parse(fs.readFileSync(path.join(WEB, 'mediflow-runtime-contract.json'), 'utf8'));
  exactKeys(roster.node, ['major', 'version', 'moduleVersion', 'platform', 'arch', 'sha256', 'bytes', 'mode']);
  if (roster.node.major !== 24 || !/^24\./u.test(process.versions.node)
    || roster.node.version !== process.versions.node || roster.node.moduleVersion !== process.versions.modules
    || roster.node.platform !== process.platform || roster.node.arch !== process.arch
    || contract.schemaVersion !== 1 || contract.node?.major !== 24
    || contract.node.version !== roster.node.version || contract.node.moduleVersion !== roster.node.moduleVersion
    || contract.platform !== process.platform || contract.arch !== process.arch
    || typeof registerHooks !== 'function') fail();
  sameRecord(roster.node, process.execPath);
  if (fs.readFileSync(path.join(RUNTIME, '.nvmrc'), 'utf8').trim().replace(/^v/u, '') !== '24'
    || JSON.parse(fs.readFileSync(path.join(RUNTIME, 'package.json'), 'utf8')).engines?.node !== '>=24 <25') fail();
  return { entries, environment };
}
let loaderInstalled = false;
export async function installHeadlessLoader() {
  if (loaderInstalled) return;
  const { entries } = verifyHeadlessBundle();
  // This is the unchanged source loader, at the same depth, with its traced TS dependency.
  await import(pathToFileURL(path.join(RUNTIME, 'scripts/headless-source-loader.mjs')).href);
  const checked = (url) => {
    if (isBuiltin(url) || url === SERVER_ONLY) return;
    if (!url.startsWith('file:')) fail();
    const file = fileURLToPath(url);
    if (pathToFileURL(file).href !== url) fail();
    const item = entries.get(path.relative(CONTENTS, file).split(path.sep).join('/'));
    if (!item) fail();
    sameRecord(item, file);
  };
  // Last registered = outermost: also guard aliases resolved by the source loader.
  registerHooks({
    resolve(specifier, context, next) { const result = next(specifier, context); checked(result.url); return result; },
    load(url, context, next) { checked(url); return next(url, context); },
  });
  loaderInstalled = true;
}
async function main() {
  if (process.argv[1] !== SELF || (process.argv.length !== 2
    && !(process.argv.length === 3 && process.argv[2] === '--mcp')) || process.execArgv.length
    || ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH']
      .some(key => process.env[key] !== undefined)) fail();
  const { environment } = verifyHeadlessBundle();
  const dataDir = process.env.MEDIFLOW_DATA_DIR
    ?? path.join(os.userInfo().homedir, 'Library', 'Application Support', 'MediFlow');
  // Deliberately require provisioning of the data directory, never write the app.
  physicalPath(dataDir, true);
  const app = path.dirname(CONTENTS);
  if (dataDir === app || dataDir.startsWith(`${app}${path.sep}`)) fail();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, environment, { MEDIFLOW_DATA_DIR: dataDir });
  process.chdir(RUNTIME);
  await installHeadlessLoader();
  const target = path.join(RUNTIME, 'scripts/mediflow-headless-supervisor.mjs');
  process.argv = [process.execPath, SELF];
  const { runHeadlessSupervisorV1 } = await import(pathToFileURL(target).href);
  // No wrapper child: lifecycle, signals, leases and revocation stay in the real Supervisor.
  await runHeadlessSupervisorV1({ webDirectory: WEB, webTargetPath: path.join(WEB, 'server.js') });
}
// realpath is used ONLY to recognize direct invocation; main still rejects an alias.
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === SELF) {
  try { await main(); }
  catch { process.stderr.write('MediFlow bundled Headless launcher failed closed.\n'); process.exitCode = 1; }
}
