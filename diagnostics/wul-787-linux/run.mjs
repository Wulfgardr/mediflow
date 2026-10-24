import { assessPerDataResults } from './classification.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const diagnostic = path.resolve(DIR, '../..');
const [candidateArg, removalArg, outputArg, ...extra] = process.argv.slice(2);
if (!candidateArg || !removalArg || !outputArg || extra.length) throw new Error('Expected two immutable application checkouts and absent output directory');
const sources = [fs.realpathSync(candidateArg), fs.realpathSync(removalArg)];
if (sources[0] === sources[1]) throw new Error('Variant checkouts must be distinct');
let source;
const output = path.resolve(outputArg);
if (!process.env.RUNNER_TEMP || !output.startsWith(fs.realpathSync(process.env.RUNNER_TEMP) + path.sep)
    || fs.existsSync(output) || sources.some(root => output.startsWith(root + path.sep)) || output.startsWith(diagnostic + path.sep)) {
  throw new Error('Output must be absent and external under RUNNER_TEMP');
}
fs.mkdirSync(output);
const evidenceRoot = path.join(output, 'evidence');
const workRoot = path.join(output, 'work');
fs.mkdirSync(evidenceRoot); fs.mkdirSync(workRoot);
let evidence = evidenceRoot;
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const check = (value, message) => { if (!value) throw new Error(message); };
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const envRecord = env => Object.fromEntries(['MEDIFLOW_DATA_DIR', 'MEDIFLOW_E2E_DATA_DIR', 'MEDIFLOW_NEXT_DIST_DIR',
  'E2E_BASE_URL', 'E2E_PIN', 'PORT', 'MEDIFLOW_TEST_OFFICIAL_UI', 'MEDIFLOW_E2E_DISABLE_LEGACY_COPY',
  'E2E_DISABLE_LEGACY_COPY', 'W11_BASELINE', 'W11_CAPTURES', 'PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_HTML_OUTPUT_DIR']
  .filter(key => env[key] !== undefined).map(key => [key, env[key]]));
const active = new Set();
let interruption;
let ownedBrowser;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  if (interruption) return;
  interruption = signal;
  write(path.join(evidence, 'interruption.json'), { signal, ownedPids: [...active].map(child => child.pid) });
  for (const child of active) if (groupAlive(child.pid)) process.kill(-child.pid, 'SIGTERM');
  void ownedBrowser?.close().catch(error => {
    write(path.join(evidence, 'interruption-browser-cleanup-error.json'), { error: error.stack });
  });
  const force = setTimeout(() => {
    for (const child of active) if (groupAlive(child.pid)) process.kill(-child.pid, 'SIGKILL');
  }, 10_000);
  force.unref();
});
function start(label, executable, argv, env, cwd = source, logFile = path.join(evidence, label + '.log')) {
  check(!interruption, 'Diagnostic interrupted: ' + interruption);
  const fd = fs.openSync(logFile, 'wx');
  const command = { label, executable, argv, cwd, logFile, env: envRecord(env), started: new Date().toISOString() };
  const child = spawn(executable, argv, { cwd, env, stdio: ['ignore', fd, fd], detached: true });
  active.add(child);
  let spawnError;
  child.once('error', error => { spawnError = error.message; });
  const done = new Promise(resolve => child.once('close', (code, signal) => {
    active.delete(child);
    fs.closeSync(fd);
    Object.assign(command, { pid: child.pid, code, signal, spawnError, finished: new Date().toISOString() });
    write(path.join(evidence, label + '-command.json'), command);
    resolve(command);
  }));
  return { child, done };
}
async function run(label, executable, argv, env, required = true, logFile) {
  const execution = start(label, executable, argv, env, source, logFile);
  const result = await execution.done;
  check(!interruption, 'Diagnostic interrupted: ' + interruption);
  if (groupAlive(execution.child.pid)) {
    process.kill(-execution.child.pid, 'SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (groupAlive(execution.child.pid)) process.kill(-execution.child.pid, 'SIGKILL');
    throw new Error(label + ': owned child process group survived command completion');
  }
  check(!result.spawnError && !result.signal, label + ' spawn/signal failure');
  if (required) check(result.code === 0, label + ' failed; see preserved command/log');
  return result;
}
function groupAlive(pid) {
  if (!pid) return false;
  try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function assertPortFree() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(3252, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve()));
  });
}
async function stopServer(server, phaseDir) {
  const alreadyExited = server.child.exitCode !== null || server.child.signalCode !== null;
  if (!alreadyExited) process.kill(-server.child.pid, 'SIGTERM');
  let timer;
  const clean = await Promise.race([server.done.then(() => true), new Promise(resolve => {
    timer = setTimeout(() => resolve(false), 10_000);
  })]);
  clearTimeout(timer);
  if (!clean && groupAlive(server.child.pid)) process.kill(-server.child.pid, 'SIGKILL');
  if (!clean) await server.done;
  const childrenRemain = groupAlive(server.child.pid);
  if (childrenRemain) process.kill(-server.child.pid, 'SIGKILL');
  write(path.join(phaseDir, 'server-cleanup.json'), { pid: server.child.pid, alreadyExited, graceful: clean, escalated: !clean || childrenRemain, childrenRemain });
  check(!alreadyExited && clean && !childrenRemain, 'Owned server exited early or required forced cleanup');
}
async function ready(server, url, identity) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    check(server.child.exitCode === null && server.child.signalCode === null, 'Server exited during readiness');
    try {
      const response = await fetch(url + '/api/system/revision', { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const observed = await response.json();
        check(observed.revision === identity.revision.slice(0, 12)
          && observed.sourceFingerprint === identity.sourceFingerprint, 'Runtime HTTP identity mismatch');
        return observed;
      }
    } catch (error) { if (error.message === 'Runtime HTTP identity mismatch') throw error; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Server readiness not reached within the existing 60-second startup window');
}
let failure;
const outcomes = [];
const phaseStates = [];
try {
  check(process.platform === 'linux' && process.arch === 'x64' && os.machine() === 'x86_64'
    && process.version === 'v24.21.0' && process.versions.modules === '137', 'Native Linux x64 / Node24.21 ABI137 required');
  check(process.env.RUNNER_ARCH === 'X64' && process.env.GITHUB_EVENT_NAME === 'push'
    && process.env.GITHUB_REF === 'refs/heads/codex/WUL-787-linux-diagnostics-20261024', 'Wrong diagnostic entry');
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'MEDIFLOW_RUNTIME_TWIN', 'NEXT_PUBLIC_MEDIFLOW_RUNTIME_TWIN',
    'MEDIFLOW_APP_REVISION', 'MEDIFLOW_APP_BRANCH', 'MEDIFLOW_APP_WORKTREE_HASH',
    'MEDIFLOW_APP_SOURCE_FINGERPRINT', 'MEDIFLOW_APP_FINGERPRINT', 'E2E_BASE_URL', 'E2E_PIN', 'W11_BASELINE', 'W11_CAPTURES']) {
    check(process.env[key] === undefined, 'Unexpected runtime environment key: ' + key);
  }
  check(git(diagnostic, 'rev-parse', 'HEAD') === process.env.GITHUB_SHA
    && !git(diagnostic, 'status', '--porcelain=v1'), 'Diagnostic checkout identity mismatch');
  for (const [file, expected] of Object.entries(manifest.files)) check(hash(fs.readFileSync(path.join(DIR, file))) === expected, 'Diagnostic source hash mismatch: ' + file);
  check(hash(fs.readFileSync(path.join(diagnostic, '.github/workflows/wul-787-linux-diagnostics.yml'))) === manifest.workflowSha256, 'Workflow source mismatch');
  check(manifest.plan === 'per-data-candidate-and-declaration-removal' && manifest.invocations === 2 && manifest.cases === 3
    && manifest.variants.map(variant => variant.id).join(',') === 'candidate,removal', 'Wrong closed diagnostic plan');
  for (const [index, variant] of manifest.variants.entries()) {
    source = sources[index];
    evidence = path.join(evidenceRoot, variant.id); fs.mkdirSync(evidence);
    const work = path.join(workRoot, variant.id); fs.mkdirSync(work);
    const SHA = variant.revision;
    const TREE = variant.tree;
    const state = { phase: variant.id, build: 'not reached', invocation: 'not reached', classification: 'not reached', cleanup: 'not reached' };
    phaseStates.push(state);
    let server, phaseFailure, outcome, ledger, ledgerHash, qualified;
    try {
      check(git(source, 'rev-parse', 'HEAD') === SHA && git(source, 'rev-parse', 'HEAD^{tree}') === TREE
        && !git(source, 'status', '--porcelain=v1'), 'Variant differs from fixed clean source');
      for (const [file, expected] of Object.entries({ ...manifest.applicationFiles, 'components/clinical-register.module.css': variant.cssSha256 }))
        check(hash(fs.readFileSync(path.join(source, file))) === expected, 'Application source mismatch: ' + file);
      write(path.join(evidence, 'source-identity.json'), { application: { revision: SHA, tree: TREE, cleanBeforeBuild: true },
        diagnostic: { revision: process.env.GITHUB_SHA, files: manifest.files }, variant: variant.id,
        runtime: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch, machine: os.machine() } });
      state.build = 'started';
      const buildData = path.join(work, 'build-data'); fs.mkdirSync(buildData);
      const baseEnv = { ...process.env, MEDIFLOW_NEXT_DIST_DIR: '.next-e2e',
        MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', E2E_DISABLE_LEGACY_COPY: '1' };
      const buildEnv = { ...baseEnv, MEDIFLOW_DATA_DIR: buildData, MEDIFLOW_E2E_DATA_DIR: buildData };
      const npm = fs.realpathSync(path.join(path.dirname(process.execPath), 'npm'));
      await run('01-npm-ci', process.execPath, [npm, 'ci'], buildEnv);
      const require = createRequire(path.join(source, 'package.json'));
      check(require('@playwright/test/package.json').version === '1.58.2'
        && require('playwright-core/package.json').version === '1.58.2', 'Locked Playwright mismatch');
      for (const [file, expected] of Object.entries(manifest.playwrightFiles)) {
        check(hash(fs.readFileSync(path.join(source, 'node_modules', file))) === expected, 'Reporter/seam source mismatch: ' + file);
      }
      const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
      await run('02-browser-install', process.execPath, [cli, 'install', '--with-deps', 'chromium'], buildEnv);
      const { chromium } = require('playwright');
      const browser = await chromium.launch();
      ownedBrowser = browser;
      try {
        const expected = read(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'browsers.json'))
          .browsers.find(entry => entry.name === 'chromium').browserVersion;
        check(browser.version() === expected, 'Chromium differs from locked browser');
        write(path.join(evidence, 'browser-identity.json'), { playwright: '1.58.2', expected, actual: browser.version(), executable: chromium.executablePath() });
      } finally { await browser.close(); ownedBrowser = undefined; }
      check(!interruption, 'Diagnostic interrupted: ' + interruption);
      check(!git(source, 'status', '--porcelain=v1'), 'npm/browser preparation changed build sources');
      await run('03-build', process.execPath, [npm, 'run', 'build'], buildEnv);
      await run('04-static-routes', process.execPath, [path.join(source, 'scripts/check-static-routes.mjs')], buildEnv);
      process.env.MEDIFLOW_NEXT_DIST_DIR = '.next-e2e';
      const { verifySourceRuntime } = await import(pathToFileURL(path.join(source, 'scripts/source-runtime.mjs')).href);
      qualified = verifySourceRuntime(source);
      check(qualified.identity.revision === SHA && !git(source, 'status', '--porcelain=v1'), 'Qualified build revision/cleanliness mismatch');
      ledger = path.join(source, '.next-e2e/runtime-payload-ledger.json');
      ledgerHash = hash(fs.readFileSync(ledger));
      write(path.join(evidence, 'qualified-runtime.json'), { identity: qualified.identity,
        contract: read(path.join(qualified.web, 'mediflow-runtime-contract.json')), ledgerSha256: ledgerHash,
        sourceRevision: SHA, sourceTree: TREE, qualifiedBeforeOverlay: true });
      state.build = 'qualified';
      const { formatError, nonTerminalScreen } = require(path.join(source, 'node_modules/playwright/lib/reporters/base.js'));
      const data = path.join(work, 'test-data'); fs.mkdirSync(data);
      fs.writeFileSync(path.join(data, 'SYNTHETIC-PROTOTYPE'), 'Owned synthetic WUL-787 Per data variant fixture\n', { flag: 'wx' });
      const phaseEnv = { ...baseEnv, MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DATA_DIR: data,
        E2E_BASE_URL: 'http://127.0.0.1:3252', PORT: '3252', E2E_PIN: '1234',
        W11_CAPTURES: path.join(evidence, 'captures'), PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(evidence, 'result.json') };
      await run('05-seed', process.execPath, [path.join(source, 'scripts/prepare-e2e-db.mjs')], phaseEnv);
      await assertPortFree();
      server = start('06-server', process.execPath, [path.join(source, 'scripts/source-runtime.mjs'), 'web'], phaseEnv);
      write(path.join(evidence, 'http-runtime-identity.json'), await ready(server, phaseEnv.E2E_BASE_URL, qualified.identity));
      write(path.join(evidence, 'test-identity.json'), { variant, runtimeRevision: SHA, runtimeTree: TREE,
        diagnosticRevision: process.env.GITHUB_SHA, applicationFiles: manifest.applicationFiles,
        noDiagnosticOverlays: true, ledgerSha256: ledgerHash });
      const argv = [cli, 'test', 'e2e/measures-composition.spec.ts', '--grep', variant.grep,
        '--workers=1', '--retries=0', '--repeat-each=1', '--reporter=line,json', '--output=' + path.join(evidence, 'results')];
      state.invocation = 'started';
      const command = await run('07-playwright', process.execPath, argv, phaseEnv, false);
      state.invocation = 'completed';
      outcome = assessPerDataResults(read(path.join(evidence, 'result.json')), command, variant, evidence, source, manifest,
        error => formatError(nonTerminalScreen, error));
      write(path.join(evidence, 'outcome.json'), outcome);
      outcomes.push(outcome);
      state.classification = outcome.outcome;
      check(outcome.accepted, 'Variant result not qualifying; see preserved outcome');
      for (const theme of variant.themes) {
        const capture = path.join(evidence, 'captures', 'dopo-' + theme + '-320-per-data');
        check(fs.existsSync(capture + '.png'), 'Original Per data PNG missing');
        const metadata = read(capture + '.json');
        check(metadata.head === SHA && metadata.diff === '' && metadata.baseline === false
          && metadata.theme === theme && metadata.size === '320', 'Original capture source/selection mismatch');
      }
    } catch (error) { phaseFailure = error.stack; }
    finally {
      if (server) try { await stopServer(server, evidence); }
      catch (error) { phaseFailure = [phaseFailure, 'Server cleanup: ' + error.stack].filter(Boolean).join('\n'); }
      if (qualified) try {
        const { verifySourceRuntime } = await import(pathToFileURL(path.join(source, 'scripts/source-runtime.mjs')).href);
        verifySourceRuntime(source);
        check(hash(fs.readFileSync(ledger)) === ledgerHash, 'Variant runtime ledger changed');
      } catch (error) { phaseFailure = [phaseFailure, 'Final payload verification: ' + error.stack].filter(Boolean).join('\n'); }
      try {
        check(git(source, 'rev-parse', 'HEAD') === SHA && git(source, 'rev-parse', 'HEAD^{tree}') === TREE
          && !git(source, 'status', '--porcelain=v1'), 'Variant test sources changed; refusing restore');
        for (const [file, expected] of Object.entries({ ...manifest.applicationFiles, 'components/clinical-register.module.css': variant.cssSha256 }))
          check(hash(fs.readFileSync(path.join(source, file))) === expected, 'Source changed during execution: ' + file);
        write(path.join(evidence, 'source-cleanup.json'), { clean: true, revision: SHA, tree: TREE, noDiagnosticOverlays: true });
        if (variant.id === 'removal') {
          write(path.join(evidence, 'candidate-restoration-started.json'), { argv: ['git', 'checkout', '--detach', manifest.variants[0].revision], cwd: source });
          git(source, 'checkout', '--detach', manifest.variants[0].revision);
          check(git(source, 'rev-parse', 'HEAD') === manifest.variants[0].revision
            && git(source, 'rev-parse', 'HEAD^{tree}') === manifest.variants[0].tree
            && !git(source, 'status', '--porcelain=v1'), 'Candidate source restoration incomplete');
          for (const [file, expected] of Object.entries({ ...manifest.applicationFiles, 'components/clinical-register.module.css': manifest.variants[0].cssSha256 }))
            check(hash(fs.readFileSync(path.join(source, file))) === expected, 'Candidate bytes not restored: ' + file);
          write(path.join(evidence, 'candidate-restoration.json'), { clean: true, revision: manifest.variants[0].revision,
            tree: manifest.variants[0].tree, bytesMatchCandidate: true, notAGreenOrPayloadQualification: true, noTestAfterRestore: true });
        }
        state.cleanup = 'complete';
      } catch (error) { phaseFailure = [phaseFailure, 'Source cleanup/restoration: ' + error.stack].filter(Boolean).join('\n'); }
      write(path.join(evidence, 'phase-state.json'), { ...state, failure: phaseFailure ?? null });
    }
    if (phaseFailure) throw new Error(phaseFailure);
  }
} catch (error) { failure = error instanceof Error ? error.stack : String(error); }
finally {
  write(path.join(evidenceRoot, 'summary.json'), { diagnosticRevision: process.env.GITHUB_SHA,
    plan: manifest.plan, plannedInvocations: 2, plannedCases: 3, variants: manifest.variants,
    reusedEvidence: manifest.reusedEvidence, outcomes, phaseStates, failure,
    acceptance: 'Diagnostic evidence only; no visual/product/clinical acceptance or historical reclassification' });
  if (failure) { process.stderr.write(failure + '\n'); process.exitCode = 1; }
}
