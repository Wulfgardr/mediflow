import { classify, classifyBaseline } from './classification.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SHA = '347699434b321d5576d4e9debd706cc142d1f9fe';
const TREE = '34b50b7940e4e59466f3c67fa31b2c87412ef8c9';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const diagnostic = path.resolve(DIR, '../..');
const [sourceArg, outputArg, ...extra] = process.argv.slice(2);
if (!sourceArg || !outputArg || extra.length) throw new Error('Expected application checkout and absent output directory');
const source = fs.realpathSync(sourceArg);
const output = path.resolve(outputArg);
if (!process.env.RUNNER_TEMP || !output.startsWith(fs.realpathSync(process.env.RUNNER_TEMP) + path.sep)
    || fs.existsSync(output) || output.startsWith(source + path.sep) || output.startsWith(diagnostic + path.sep)) {
  throw new Error('Output must be absent and external under RUNNER_TEMP');
}
fs.mkdirSync(output);
const evidence = path.join(output, 'evidence');
const work = path.join(output, 'work');
fs.mkdirSync(evidence); fs.mkdirSync(work);
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
const baselineOwned = new Map();
function applyBaseline(baseline) {
  check(baselineOwned.size === 0 && !git(source, 'status', '--porcelain=v1'), 'Baseline overlay needs clean test sources');
  for (const entry of baseline.overlays) {
    const target = path.join(source, entry.destination);
    check(entry.originalSha256 === null ? !fs.existsSync(target)
      : hash(fs.readFileSync(target)) === entry.originalSha256, 'Baseline original mismatch: ' + entry.destination);
  }
  for (const entry of baseline.overlays) {
    const target = path.join(source, entry.destination);
    const bytes = fs.readFileSync(path.join(DIR, entry.source));
    check(hash(bytes) === entry.overlaySha256, 'Baseline overlay mismatch');
    baselineOwned.set(target, { entry, original: entry.originalSha256 === null ? null : fs.readFileSync(target) });
    fs.writeFileSync(target, bytes, { flag: entry.originalSha256 === null ? 'wx' : 'w' });
  }
}
function restoreBaseline() {
  for (const [target, owned] of baselineOwned) {
    check(hash(fs.readFileSync(target)) === owned.entry.overlaySha256, 'Unexpected baseline edit; refusing cleanup');
    if (owned.original === null) fs.unlinkSync(target); else fs.writeFileSync(target, owned.original);
    baselineOwned.delete(target);
  }
  check(!git(source, 'status', '--porcelain=v1'), 'Baseline test source restore incomplete');
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
    'MEDIFLOW_APP_SOURCE_FINGERPRINT', 'MEDIFLOW_APP_FINGERPRINT', 'E2E_BASE_URL', 'E2E_PIN']) {
    check(process.env[key] === undefined, 'Unexpected runtime environment key: ' + key);
  }
  check(git(source, 'rev-parse', 'HEAD') === SHA && git(source, 'rev-parse', 'HEAD^{tree}') === TREE
    && !git(source, 'status', '--porcelain=v1'), 'Build checkout differs from fixed clean W347');
  check(git(diagnostic, 'rev-parse', 'HEAD') === process.env.GITHUB_SHA
    && !git(diagnostic, 'status', '--porcelain=v1'), 'Diagnostic checkout identity mismatch');
  for (const [file, expected] of Object.entries(manifest.files)) check(hash(fs.readFileSync(path.join(DIR, file))) === expected, 'Diagnostic source hash mismatch: ' + file);
  check(hash(fs.readFileSync(path.join(diagnostic, '.github/workflows/wul-787-linux-diagnostics.yml'))) === manifest.workflowSha256, 'Workflow source mismatch');
  check(manifest.plan === 'remaining-consumers-two-baselines' && manifest.invocations === 3 && manifest.cases === 4, 'Wrong diagnostic plan');
  write(path.join(evidence, 'source-identity.json'), { application: { revision: SHA, tree: TREE, cleanBeforeBuild: true },
    diagnostic: { revision: git(diagnostic, 'rev-parse', 'HEAD'), tree: git(diagnostic, 'rev-parse', 'HEAD^{tree}'), files: manifest.files },
    runtime: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch, machine: os.machine() } });
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
  const qualified = verifySourceRuntime(source);
  check(qualified.identity.revision === SHA && !git(source, 'status', '--porcelain=v1'), 'Qualified build revision/cleanliness mismatch');
  const ledger = path.join(source, '.next-e2e/runtime-payload-ledger.json');
  const ledgerHash = hash(fs.readFileSync(ledger));
  write(path.join(evidence, 'qualified-runtime.json'), { identity: qualified.identity,
    contract: read(path.join(qualified.web, 'mediflow-runtime-contract.json')), ledgerSha256: ledgerHash,
    sourceRevision: SHA, sourceTree: TREE, qualifiedBeforeOverlay: true });
  {
    const phase = 'consumers';
    const phaseState = { phase, invocation: 'not reached', observation: 'not applicable', classification: 'not reached', serverCleanup: 'not reached' };
    phaseStates.push(phaseState);
    const phaseDir = path.join(evidence, phase); fs.mkdirSync(phaseDir);
    check(hash(fs.readFileSync(path.join(source, 'e2e/utils.ts'))) === manifest.helperSha256, 'Unchanged helper source mismatch');
    write(path.join(phaseDir, 'test-identity.json'), { phase, runtimeRevision: SHA, runtimeTree: TREE,
      diagnosticRevision: process.env.GITHUB_SHA, originalHelperBlob: git(source, 'rev-parse', 'HEAD:e2e/utils.ts'),
      helperSha256: hash(fs.readFileSync(path.join(source, 'e2e/utils.ts'))),
      spec: 'e2e/web-auth-recovery.spec.ts', specSha256: hash(fs.readFileSync(path.join(source, 'e2e/web-auth-recovery.spec.ts'))),
      officialOverlayApplied: false, ledgerSha256: hash(fs.readFileSync(ledger)) });
    check(hash(fs.readFileSync(ledger)) === ledgerHash, 'Runtime ledger changed before phase');
    const data = path.join(work, phase + '-data'); fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, 'SYNTHETIC-PROTOTYPE'), 'Owned synthetic WUL-787 diagnostic fixture\n', { flag: 'wx' });
    const phaseEnv = { ...baseEnv, MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DATA_DIR: data,
      E2E_BASE_URL: 'http://127.0.0.1:3252', PORT: '3252', E2E_PIN: '1234',
      PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(phaseDir, 'report.json'),
      PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(phaseDir, 'html'), PLAYWRIGHT_HTML_OPEN: 'never' };
    await run(phase + '-seed', process.execPath, [path.join(source, 'scripts/prepare-e2e-db.mjs')], phaseEnv);
    await assertPortFree();
    const server = start(phase + '-server', process.execPath, [path.join(source, 'scripts/source-runtime.mjs'), 'web'], phaseEnv);
    let outcome;
    let phaseFailure;
    try {
      write(path.join(phaseDir, 'http-runtime-identity.json'), await ready(server, phaseEnv.E2E_BASE_URL, qualified.identity));
      const argv = [cli, 'test', 'e2e/web-auth-recovery.spec.ts',
        '--grep', manifest.consumers.join('|'),
        '--workers=1', '--retries=0', '--reporter=line,json,html', '--output=' + path.join(phaseDir, 'test-output')];
      phaseState.invocation = 'started';
      const command = await run(phase + '-playwright', process.execPath, argv, phaseEnv, false);
      phaseState.invocation = 'completed';
      phaseState.classification = 'started';
      outcome = classify(phase, command, phaseDir, manifest);
      phaseState.classification = outcome.outcome;
      write(path.join(phaseDir, 'outcome.json'), outcome);
    } catch (error) {
      phaseFailure = error.stack;
      if (phaseState.classification === 'started') phaseState.classification = { rejected: error.message };
    }
    finally {
      try { await stopServer(server, phaseDir); phaseState.serverCleanup = 'complete'; }
      catch (error) { phaseState.serverCleanup = { failed: error.message }; phaseFailure = [phaseFailure, 'Server cleanup: ' + error.stack].filter(Boolean).join('\n'); }
      try {
        check(!git(source, 'status', '--porcelain=v1'), 'Consumer test sources changed; no diagnostic overlay was applied');
        write(path.join(phaseDir, 'source-cleanup.json'), { clean: true, diagnosticOverlaysApplied: false });
      } catch (error) { phaseFailure = [phaseFailure, 'Test source cleanup: ' + error.stack].filter(Boolean).join('\n'); }
      write(path.join(phaseDir, 'phase-state.json'), phaseState);
    }
    if (phaseFailure) throw new Error(phaseFailure);
    outcomes.push(outcome);
  }
  for (const baseline of manifest.baselines) {
    const phase = baseline.phase;
    const phaseDir = path.join(evidence, phase); fs.mkdirSync(phaseDir);
    let phaseFailure;
    let server;
    try {
      applyBaseline(baseline);
      check(hash(fs.readFileSync(ledger)) === ledgerHash, 'Runtime ledger changed before baseline');
      write(path.join(phaseDir, 'test-identity.json'), { phase, runtimeRevision: SHA, runtimeTree: TREE,
        diagnosticRevision: process.env.GITHUB_SHA, overlays: baseline.overlays, ledgerSha256: ledgerHash });
      const data = path.join(work, phase + '-data'); fs.mkdirSync(data);
      fs.writeFileSync(path.join(data, 'SYNTHETIC-PROTOTYPE'), 'Owned synthetic WUL-787 diagnostic fixture\n', { flag: 'wx' });
      const phaseEnv = { ...baseEnv, MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DATA_DIR: data,
        E2E_BASE_URL: 'http://127.0.0.1:3252', PORT: '3252', E2E_PIN: '1234',
        PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(phaseDir, 'result.json'),
        ...(phase === 'per-data' ? { W11_BASELINE: '0', W11_CAPTURES: path.join(phaseDir, 'captures') } : {}) };
      await run(phase + '-seed', process.execPath, [path.join(source, 'scripts/prepare-e2e-db.mjs')], phaseEnv);
      await assertPortFree();
      server = start(phase + '-server', process.execPath, [path.join(source, 'scripts/source-runtime.mjs'), 'web'], phaseEnv);
      write(path.join(phaseDir, 'http-runtime-identity.json'), await ready(server, phaseEnv.E2E_BASE_URL, qualified.identity));
      const argv = [cli, 'test', baseline.spec, '--grep', baseline.grep, '--workers=1', '--retries=0',
        '--repeat-each=1', '--reporter=line,json', '--output=' + path.join(phaseDir, 'results')];
      const command = await run(phase + '-playwright', process.execPath, argv, phaseEnv, false, path.join(phaseDir, 'run.log'));
      const outcome = classifyBaseline(baseline, command, phaseDir);
      write(path.join(phaseDir, 'outcome.json'), outcome);
      outcomes.push(outcome);
      check(outcome.diagnosticErrors.length === 0, phase + ': diagnostic observation/cleanup failure; see outcome');
      if (phase === 'anydoc' && outcome.observation.compatibility)
        check(outcome.observation.complete, 'AnyDoc observation incomplete; see preserved outcome');
    } catch (error) { phaseFailure = error.stack; }
    finally {
      if (server) try { await stopServer(server, phaseDir); }
      catch (error) { phaseFailure = [phaseFailure, 'Server cleanup: ' + error.stack].filter(Boolean).join('\n'); }
      try {
        restoreBaseline();
        write(path.join(phaseDir, 'overlay-cleanup.json'), { clean: true, originalsRestored: true, removedOnlyOwnedFixtures: true });
      } catch (error) { phaseFailure = [phaseFailure, 'Overlay cleanup: ' + error.stack].filter(Boolean).join('\n'); }
    }
    if (phaseFailure) throw new Error(phaseFailure);
  }
  verifySourceRuntime(source);
  check(hash(fs.readFileSync(ledger)) === ledgerHash, 'Runtime ledger changed after diagnostics');
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
} finally {
  if (baselineOwned.size) try { restoreBaseline(); }
  catch (error) { failure = [failure, 'Baseline cleanup: ' + error.stack].filter(Boolean).join('\n'); }
  const baselineCaseFailure = outcomes.some(outcome => outcome.caseOutcome === 'FAIL');
  write(path.join(evidence, 'summary.json'), { applicationRevision: SHA, applicationTree: TREE,
    diagnosticRevision: process.env.GITHUB_SHA, groupsPresent: manifest.groups,
    plannedExecution: { invocations: manifest.invocations, cases: manifest.cases }, reusedEvidence: manifest.reusedOfficialEvidence,
    outcomesScope: 'Only invocations executed in this run; reused Official evidence is not an outcome or case',
    outcomes, failure, phaseStates, baselineCaseFailure,
    rawCommandResultsPreserved: true, acceptance: 'Diagnostic evidence only; independent review and publication remain separate' });
  if (failure) process.stderr.write(failure + '\n');
  if (failure || baselineCaseFailure) process.exitCode = 1;
}
