import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertNodeRuntime, readNodeContract, standaloneDirectory, verifyNativeBinding } from './node-runtime-contract.mjs';
import { generatePayloadLedger, verifyPayloadLedger } from './generate-runtime-payload-ledger.mjs';
import { physicalFiles, physicalRecord } from './launch-bundled-headless-supervisor.mjs';
import { assertBuildInputMetadata } from './build-input-metadata.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ledgerPath = web => path.join(path.dirname(web), 'runtime-payload-ledger.json');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const distDirectory = web => readJson(path.join(web, 'mediflow-runtime-contract.json')).distDir ?? '.next';

// Registry aliases reuse only the physical traced subset already in this build;
// an external local package additionally requires its complete pinned provenance.
// Neither kind of alias is admitted at startup.
export function materializeSourceRuntime(web, sourceRoot = ROOT, directory = web, active = new Set()) {
  const real = fs.realpathSync(directory);
  if (active.has(real) || (real !== web && !real.startsWith(web + path.sep))) throw new Error('Source runtime alias escapes or cycles');
  const ancestors = new Set([...active, real]);
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      let target = fs.realpathSync(file), installed, traced;
      if (!target.startsWith(web + path.sep)) {
        for (const input of [sourceRoot, path.join(sourceRoot, 'node_modules')]) {
          const physical = path.resolve(input), inputStat = fs.lstatSync(physical);
          if (!inputStat.isDirectory() || inputStat.isSymbolicLink() || fs.realpathSync(physical) !== physical) {
            throw new Error('Source runtime install roots must be physical');
          }
        }
        const packageName = path.relative(path.join(sourceRoot, 'node_modules'), target).split(path.sep).join('/');
        if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageName)) {
          throw new Error('Source runtime alias escapes build or installed package root');
        }
        const reference = readJson(path.join(sourceRoot, 'package.json')).dependencies?.[packageName];
        if (reference?.startsWith('file:')) {
          installed = generatePayloadLedger({ sourceRoot, payloadRoot: target, profile: 'local-package', packageName });
        } else {
          const lock = readJson(path.join(sourceRoot, 'package-lock.json'));
          const locked = lock.packages?.[`node_modules/${packageName}`];
          const canonical = path.join(web, 'node_modules', packageName);
          traced = physicalFiles(canonical).map(name => [name, physicalRecord(path.join(canonical, name))]);
          const metadata = readJson(path.join(canonical, 'package.json'));
          if (!reference || lock.lockfileVersion !== 3 || locked?.dev === true
            || !locked?.resolved?.startsWith('https://') || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(locked?.integrity ?? '')
            || metadata.name !== packageName || metadata.version !== locked?.version) {
            throw new Error('Source runtime alias lacks a matching locked runtime package');
          }
          for (const [name, record] of traced) {
            if (JSON.stringify(physicalRecord(path.join(target, name))) !== JSON.stringify(record)) {
              throw new Error('Source runtime traced package differs from installed member');
            }
          }
          target = canonical;
        }
      } else if (fs.statSync(target).isDirectory()) materializeSourceRuntime(web, sourceRoot, target, ancestors);
      const temporary = `${file}.${process.pid}.tmp`;
      fs.mkdirSync(temporary); // Claim an absent, owned container before copying.
      try {
        const copy = path.join(temporary, 'payload');
        fs.cpSync(target, copy, { recursive: true, errorOnExist: true, force: false });
        if (installed) verifyPayloadLedger({ payloadRoot: copy, ledger: installed });
        if (traced && JSON.stringify(physicalFiles(copy).map(name => [name, physicalRecord(path.join(copy, name))])) !== JSON.stringify(traced)) {
          throw new Error('Source runtime traced package changed while copying');
        }
        fs.unlinkSync(file); fs.renameSync(copy, file);
      } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    } else if (stat.isDirectory()) materializeSourceRuntime(web, sourceRoot, file, ancestors);
    else if (!stat.isFile()) throw new Error('Source runtime contains a special file');
  }
}

export async function prepareSourceRuntime(root = ROOT) {
  assertBuildInputMetadata({ sourceRoot: root, payloadRoot: standaloneDirectory(root), protectedRoots: [process.env.MEDIFLOW_DATA_DIR] });
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
  materializeSourceRuntime(web, root);
  await stageSourceHeadlessRuntime(web);
  for (const [source, destination] of [
    [path.join(root, 'public'), path.join(web, 'public')],
    [path.join(path.dirname(web), 'static'), path.join(web, distDir, 'static')],
  ]) fs.cpSync(source, destination, { recursive: true });
  assertBuildInputMetadata({ sourceRoot: root, payloadRoot: web, protectedRoots: [process.env.MEDIFLOW_DATA_DIR], allowPayloadAliases: false });
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
  assertBuildInputMetadata({ sourceRoot: root, payloadRoot: standaloneDirectory(root), protectedRoots: [process.env.MEDIFLOW_DATA_DIR] });
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
  assertBuildInputMetadata({ sourceRoot: root, payloadRoot: standaloneDirectory(root), protectedRoots: [process.env.MEDIFLOW_DATA_DIR] });
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
  const web = standaloneDirectory(root);
  // Reuse may run from a checkout with private data: inspect only the sealed
  // payload, before the ledger or any payload content can be read.
  assertBuildInputMetadata({ sourceRoot: web, payloadRoot: web, allowPayloadAliases: false });
  assertNodeRuntime(readNodeContract(root));
  const ledger = readJson(ledgerPath(web));
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
  if (!['web', 'headless', 'local-ui'].includes(mode)) throw new Error('Expected web, headless or local-ui');
  const { web, identity } = verifySourceRuntime(root);
  if (mode === 'local-ui' && process.env.MEDIFLOW_PLUGIN_EXPECTED_REVISION !== undefined
    && process.env.MEDIFLOW_PLUGIN_EXPECTED_REVISION !== identity.revision) throw new Error('Plugin runtime revision mismatch');
  Object.assign(process.env, { NODE_ENV: 'production', HOSTNAME: '127.0.0.1',
    MEDIFLOW_APP_REVISION: identity.revision.slice(0, 12), MEDIFLOW_APP_BRANCH: identity.branch,
    MEDIFLOW_APP_WORKTREE_HASH: identity.worktreeHash,
    MEDIFLOW_APP_SOURCE_FINGERPRINT: identity.sourceFingerprint,
    MEDIFLOW_APP_FINGERPRINT: identity.sourceFingerprint });
  process.chdir(web);
  if (mode === 'web') {
    if (process.connected && process.env.MEDIFLOW_PLUGIN_LOCAL_UI === '1') {
      const { installLocalUiWebNavigation } = await import('./local-ui-web-navigation.mjs');
      const { openUrl } = await import('./launcher-helpers.mjs');
      installLocalUiWebNavigation(process, `http://127.0.0.1:${process.env.PORT}`, openUrl);
    }
    return createRequire(path.join(web, 'package.json'))(path.join(web, 'server.js'));
  }
  await import(pathToFileURL(path.join(web, 'scripts/register-strip-types-loader.mjs')).href);
  const { runHeadlessSupervisorV1 } = await import(pathToFileURL(path.join(web, 'scripts/mediflow-headless-supervisor.mjs')).href);
  process.argv = process.argv.slice(0, 2);
  return runHeadlessSupervisorV1({ webDirectory: web, webTargetPath: path.join(web, 'server.js'), webBuildIdentity: identity,
    ...(mode === 'local-ui' ? { sourceRoot: path.resolve(root) } : {}) }, mode === 'local-ui' ? 'plugin_local_ui' : 'clinical');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    if (command !== 'build' && process.argv.length !== 3) throw new Error('Source runtime arguments invalid');
    if (['web', 'headless', 'local-ui'].includes(command) && (process.execArgv.length
      || ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH']
        .some(key => process.env[key] !== undefined))) throw new Error('Source runtime invocation invalid');
    if (['web', 'headless', 'local-ui'].includes(command) && process.connected) {
      process.on('message', message => {
        if (message?.type !== 'mediflow-launcher-stop') return;
        if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
        else process.exit(0);
      });
      process.once('disconnect', () => {
        if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
        else process.exit(1);
      });
    }
    if (command === 'build') await buildSourceRuntime(ROOT, process.argv.slice(3));
    else if (process.argv[2] === 'prepare') await prepareSourceRuntime();
    else await startSourceRuntime(process.argv[2]);
  } catch (error) {
    process.stderr.write(`MediFlow source runtime: ${error.message}\n`); process.exitCode = 1;
  }
}
