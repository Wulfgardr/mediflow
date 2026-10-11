import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertNodeRuntime, readNodeContract, standaloneDirectory, verifyNativeBinding } from './node-runtime-contract.mjs';
import { generatePayloadLedger, verifyPayloadLedger } from './generate-runtime-payload-ledger.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ledgerPath = web => path.join(path.dirname(web), 'runtime-payload-ledger.json');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const distDirectory = web => readJson(path.join(web, 'mediflow-runtime-contract.json')).distDir ?? '.next';

// Next emits internal package aliases. Materialize only targets inside this
// build, before inventory; aliases are never admitted at startup.
function materialize(web, directory = web, active = new Set()) {
  const real = fs.realpathSync(directory);
  if (active.has(real) || (real !== web && !real.startsWith(web + path.sep))) throw new Error('Source runtime alias escapes or cycles');
  const ancestors = new Set([...active, real]);
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(file);
      if (!target.startsWith(web + path.sep)) throw new Error('Source runtime alias escapes build');
      if (fs.statSync(target).isDirectory()) materialize(web, target, ancestors);
      const temporary = `${file}.${process.pid}.tmp`;
      fs.cpSync(target, temporary, { recursive: true, errorOnExist: true, force: false });
      fs.unlinkSync(file); fs.renameSync(temporary, file);
    } else if (stat.isDirectory()) materialize(web, file, ancestors);
    else if (!stat.isFile()) throw new Error('Source runtime contains a special file');
  }
}

export async function prepareSourceRuntime(root = ROOT) {
  assertNodeRuntime(readNodeContract(root));
  const web = standaloneDirectory(root);
  if (fs.realpathSync(web) !== web) throw new Error('Source runtime must be physical');
  const identity = readJson(path.join(web, 'mediflow-build-identity.json'));
  const checkSource = () => {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    if (git(['rev-parse', 'HEAD']) !== identity.revision || git(['status', '--porcelain', '--untracked-files=normal'])) {
      throw new Error('Source differs from the committed build');
    }
  };
  checkSource();
  // A failed rebuild must not leave an earlier admission usable.
  fs.rmSync(ledgerPath(web), { force: true });
  const distDir = distDirectory(web);
  if (readJson(path.join(web, distDir, 'required-server-files.json')).config.experimental.isrFlushToDisk !== false) {
    throw new Error('Source runtime requires an immutable disk cache configuration');
  }
  const { stageSourceHeadlessRuntime } = await import('./stage-headless-runtime.mjs');
  materialize(web);
  await stageSourceHeadlessRuntime(web);
  for (const [source, destination] of [
    [path.join(root, 'public'), path.join(web, 'public')],
    [path.join(path.dirname(web), 'static'), path.join(web, distDir, 'static')],
  ]) fs.cpSync(source, destination, { recursive: true });
  const ledger = generatePayloadLedger({ sourceRoot: root, payloadRoot: web, profile: 'standalone',
    expectedRuntime: { nodeVersion: process.versions.node, nodeAbi: process.versions.modules,
      platform: process.platform, arch: process.arch } });
  checkSource();
  fs.writeFileSync(ledgerPath(web), JSON.stringify(ledger) + '\n', { flag: 'wx' });
  verifySourceRuntime(root);
}

// Keep build identity at the build boundary, never stamp an old standalone
// with the commit of a later preparation. Source production uses committed code.
async function buildSourceRuntime(root = ROOT, args = []) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('Commit source changes before a production build');
  const revision = git(['rev-parse', 'HEAD']);
  const branch = git(['branch', '--show-current']) || 'detached';
  const sourceFingerprint = `${branch}@${revision.slice(0, 12)}:clean`;
  execFileSync(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', ...args], {
    cwd: root, stdio: 'inherit', env: { ...process.env,
      MEDIFLOW_APP_REVISION: revision.slice(0, 12), MEDIFLOW_APP_BRANCH: branch,
      MEDIFLOW_APP_WORKTREE_HASH: 'clean', MEDIFLOW_APP_SOURCE_FINGERPRINT: sourceFingerprint,
      MEDIFLOW_APP_FINGERPRINT: sourceFingerprint },
  });
  if (git(['rev-parse', 'HEAD']) !== revision || git(['status', '--porcelain', '--untracked-files=normal'])) {
    throw new Error('Source changed during build');
  }
  const web = standaloneDirectory(root);
  fs.writeFileSync(path.join(web, 'mediflow-build-identity.json'), JSON.stringify({
    schemaVersion: 1, revision, branch, worktreeHash: 'clean', sourceFingerprint,
    buildId: fs.readFileSync(path.join(web, path.basename(path.dirname(web)), 'BUILD_ID'), 'utf8').trim(),
  }) + '\n');
}

// Trust comes from the reviewed source/build and its external ledger, not an
// attacker-replaceable signature in the payload. No application imports here.
export function verifySourceRuntime(root = ROOT) {
  assertNodeRuntime(readNodeContract(root));
  const web = standaloneDirectory(root), ledger = readJson(ledgerPath(web));
  if (ledger.profile !== 'standalone' || ledger.closure?.buildIdentity !== 'REVISION_AND_BUILD_ID_MATCH') {
    throw new Error('Source runtime build identity is missing');
  }
  verifyPayloadLedger({ payloadRoot: web, ledger });
  const contract = readJson(path.join(web, 'mediflow-runtime-contract.json'));
  if (contract.schemaVersion !== 1 || contract.node?.major !== 24
    || contract.node.moduleVersion !== process.versions.modules
    || contract.platform !== process.platform || contract.arch !== process.arch) {
    throw new Error('Source runtime Node/ABI/platform/architecture mismatch');
  }
  const identity = readJson(path.join(web, 'mediflow-build-identity.json'));
  if (identity.schemaVersion !== 1 || identity.revision !== ledger.source.revision
    || identity.buildId !== fs.readFileSync(path.join(web, distDirectory(web), 'BUILD_ID'), 'utf8').trim()) {
    throw new Error('Source runtime build identity mismatch');
  }
  // This probe executes only the now-verified binding, against in-memory SQLite.
  verifyNativeBinding(web);
  return { web, identity };
}

export async function startSourceRuntime(mode, root = ROOT) {
  if (!['web', 'headless'].includes(mode)) throw new Error('Expected web or headless');
  const { web, identity } = verifySourceRuntime(root);
  Object.assign(process.env, { NODE_ENV: 'production', HOSTNAME: '127.0.0.1',
    MEDIFLOW_APP_REVISION: identity.revision.slice(0, 12), MEDIFLOW_APP_BRANCH: identity.branch,
    MEDIFLOW_APP_WORKTREE_HASH: identity.worktreeHash,
    MEDIFLOW_APP_SOURCE_FINGERPRINT: identity.sourceFingerprint,
    MEDIFLOW_APP_FINGERPRINT: identity.sourceFingerprint });
  process.chdir(web);
  if (mode === 'web') return createRequire(path.join(web, 'package.json'))(path.join(web, 'server.js'));
  await import(pathToFileURL(path.join(web, 'scripts/register-strip-types-loader.mjs')).href);
  const { runHeadlessSupervisorV1 } = await import(pathToFileURL(path.join(web, 'scripts/mediflow-headless-supervisor.mjs')).href);
  process.argv = process.argv.slice(0, 2);
  return runHeadlessSupervisorV1({ webDirectory: web, webTargetPath: path.join(web, 'server.js'), webBuildIdentity: identity });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    if (command !== 'build' && process.argv.length !== 3) throw new Error('Source runtime arguments invalid');
    if (['web', 'headless'].includes(command) && (process.execArgv.length
      || ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH']
        .some(key => process.env[key] !== undefined))) throw new Error('Source runtime invocation invalid');
    if (command === 'build') await buildSourceRuntime(ROOT, process.argv.slice(3));
    else if (process.argv[2] === 'prepare') await prepareSourceRuntime();
    else await startSourceRuntime(process.argv[2]);
  } catch (error) {
    process.stderr.write(`MediFlow source runtime: ${error.message}\n`); process.exitCode = 1;
  }
}
