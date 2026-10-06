#!/usr/bin/env node
/** Single original Ubuntu CI OCR image invocation; export strictly bounded metadata only. */
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dossier = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(dossier, '..');
const distName = '.next-ocr-causal';
const standalone = path.join(sourceRoot, distName, 'standalone');
const acceptedConfig = path.join(sourceRoot, 'e2e/ocr-causal-ci.config.cts');
const runtimeContractPath = path.join(standalone, 'mediflow-runtime-contract.json');
const testFile = path.join(sourceRoot, 'e2e/document-upload-ocr.spec.ts');
const imageTitle = 'Estrazione locale: image, dalla UI al risultato corrente';
const imageGrep = String.raw`document-upload-ocr\.spec\.ts.*Estrazione locale: image, dalla UI al risultato corrente$`;
const maxSeedMs = 30_000;
const maxReadyMs = 30_000;
const maxCliMs = 5 * 60_000;
const stopGraceMs = 5_000;
let reduced = null;
let exportDir = null;
const pin = { head: process.env.OCR_CAUSAL_EXPECTED_HEAD, tree: null, branch: 'codex/WUL-729-ocr-causal-probe-20261006', revision: process.env.OCR_CAUSAL_EXPECTED_HEAD?.slice(0, 12), worktreeHash: 'clean' };
const stage = Object.freeze({ preflight: 1, fixture: 2, runtime: 3, readiness: 4, identity: 5, playwright: 6 });
const status = Object.freeze({ notStarted: 0, pass: 1, fail: 2, hold: 3, timeout: 4, running: 5 });

// Only this small technical subset is eligible for the final export.
const receipt = { runtime_contract_match: false, source_fingerprint_match: false,
  app_ready: false, playwright_exit_code: null, private_fixture_removed: false };

let tempRoot = null;
let dataDir = null;
let serverChild = null;
let seedChild = null;
let cliChild = null;
let seedLogFd = null;
let seedErrFd = null;
let serverOutFd = null;
let serverErrFd = null;
let cliStdoutFd = null;
let cliStderrFd = null;
let finalStage = stage.preflight;
let finalStatus = status.fail;
let exitCode = null;
let timedOut = false;
let cleanupSafe = true;
let logFailure = false;
let terminationRequested = false;

class GateError extends Error { constructor(code) { super(code); this.code = code; } }
function must(condition, code) { if (!condition) throw new GateError(code); }
function same(actual, expected, code) { if (actual !== expected) throw new GateError(code); }
function readJson(filename) { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
function regular(filename, executable = false) {
  const st = fs.lstatSync(filename, { throwIfNoEntry: false });
  return Boolean(st?.isFile() && !st.isSymbolicLink() && (!executable || (st.mode & 0o111) !== 0));
}
function gitValue(args) {
  const result = spawnSync('git', ['-C', sourceRoot, ...args], {
    encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'],
    env: { PATH: process.env.PATH || '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      TMPDIR: process.env.RUNNER_TEMP || '/tmp', LANG: process.env.LANG || 'en_US.UTF-8', LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
      GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.status !== 0) throw new GateError('SOURCE_PIN_UNAVAILABLE');
  return result.stdout.trim();
}
function verifyPinAndRuntime() {
  same(gitValue(['rev-parse', 'HEAD']), pin.head, 'SOURCE_HEAD_MISMATCH');
  pin.tree = gitValue(['rev-parse', 'HEAD^{tree}']);
  must(/^[a-f0-9]{40}$/.test(pin.tree), 'SOURCE_TREE_MISMATCH');
  same(gitValue(['branch', '--show-current']), '', 'SOURCE_BRANCH_MISMATCH');
  same(gitValue(['status', '--porcelain=v1', '--untracked-files=no']), '', 'SOURCE_WORKTREE_NOT_CLEAN');
  same(process.versions.node, '24.21.0', 'RUNNER_NODE_VERSION_MISMATCH');
  same(process.versions.modules, '137', 'RUNNER_NODE_ABI_MISMATCH');
  same(process.platform, 'linux', 'RUNTIME_PLATFORM_MISMATCH');

  const contract = readJson(runtimeContractPath);
  same(contract.schemaVersion, 1, 'RUNTIME_CONTRACT_SCHEMA_MISMATCH');
  same(contract.node?.major, 24, 'RUNTIME_NODE_MAJOR_MISMATCH');
  same(contract.node?.version, process.versions.node, 'RUNTIME_NODE_VERSION_MISMATCH');
  same(contract.node?.moduleVersion, process.versions.modules, 'RUNTIME_NODE_ABI_MISMATCH');
  same(contract.platform, process.platform, 'RUNTIME_PLATFORM_MISMATCH');
  same(contract.arch, process.arch, 'RUNTIME_ARCH_MISMATCH');
  same(contract.betterSqlite3Version, '12.6.2', 'RUNTIME_SQLITE_VERSION_MISMATCH');

  must(regular(path.join(standalone, 'server.js')), 'STANDALONE_SERVER_MISSING');
  must(regular(path.join(sourceRoot, distName, 'BUILD_ID')), 'BUILD_ID_MISSING');
  must(regular(path.join(standalone, distName, 'BUILD_ID')), 'STANDALONE_BUILD_ID_MISSING');
  same(fs.readFileSync(path.join(sourceRoot, distName, 'BUILD_ID'), 'utf8'),
    fs.readFileSync(path.join(standalone, distName, 'BUILD_ID'), 'utf8'), 'BUILD_ID_MISMATCH');
  const required = readJson(path.join(sourceRoot, distName, 'required-server-files.json'));
  same(required.config?.distDir, distName, 'REQUIRED_SERVER_DISTDIR_MISMATCH');
  same(required.config?.output, 'standalone', 'REQUIRED_SERVER_OUTPUT_MISMATCH');
  must(regular(acceptedConfig), 'LOCAL_CONFIG_MISSING');
  for (const name of ['@playwright/test', 'playwright', '@napi-rs/canvas', 'pdf-lib', 'better-sqlite3']) {
    must(regular(path.join(sourceRoot, 'node_modules', ...name.split('/'), 'package.json')), 'FRESH_DEPENDENCY_MISSING');
  }
  must(fs.statSync(path.join(sourceRoot, distName, 'static')).isDirectory(), 'BUILD_STATIC_MISSING');
  ensureStandaloneAssets();
  receipt.runtime_contract_match = true;
  return contract;
}
function ensureStandaloneAssets() {
  const entries = [
    [path.join(sourceRoot, 'public'), path.join(standalone, 'public'), true],
    [path.join(sourceRoot, distName, 'static'), path.join(standalone, distName, 'static'), false],
  ];
  for (const [source, target, allowExistingDirectory] of entries) {
    must(fs.statSync(source).isDirectory(), 'ASSET_SOURCE_MISSING');
    const targetStat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (targetStat) {
      if (targetStat.isSymbolicLink()) {
        same(fs.realpathSync(target), fs.realpathSync(source), 'ASSET_LINK_MISMATCH');
      } else if (!(allowExistingDirectory && targetStat.isDirectory())) {
        throw new GateError('ASSET_TARGET_CONFLICT');
      }
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(source, target, 'dir');
    }
  }
}
function minimalEnv(dataPath, pinValue) {
  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: process.env.HOME || '/tmp',
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}),
    TMPDIR: process.env.RUNNER_TEMP || '/tmp', LANG: process.env.LANG || 'en_US.UTF-8',
    LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    MEDIFLOW_NEXT_DIST_DIR: distName,
    MEDIFLOW_DATA_DIR: dataPath, MEDIFLOW_E2E_DATA_DIR: dataPath,
    MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', E2E_DISABLE_LEGACY_COPY: '1',
    MF085_SYNTHETIC_E2E: '1', E2E_DOCUMENTS_SYNTHETIC_ONLY: '1',
    MEDIFLOW_OCR_CAUSAL_CAPTURE: '1',
    NEXT_PUBLIC_MEDIFLOW_OCR_CAUSAL_PROBE: '1',
    NEXT_PUBLIC_MEDIFLOW_OCR_CAUSAL_SYNTHETIC_ONLY: '1',
    MEDIFLOW_APP_REVISION: pin.revision, MEDIFLOW_APP_BRANCH: pin.branch,
    MEDIFLOW_APP_WORKTREE_HASH: pin.worktreeHash,
    MEDIFLOW_APP_SOURCE_FINGERPRINT: `${pin.branch}@${pin.revision}:${pin.worktreeHash}`,
    MEDIFLOW_APP_FINGERPRINT: `${pin.branch}@${pin.revision}:${pin.worktreeHash}`,
    E2E_PIN: pinValue, E2E_USERNAME: 'admin',
    E2E_DISPLAY_NAME: 'Synthetic OCR Test', E2E_AMBULATORY_NAME: 'Synthetic OCR Test',
  };
  return env;
}
async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new GateError('LOOPBACK_PORT_UNAVAILABLE');
  await new Promise((resolve, reject) => server.close(error => {
    if (error) reject(error);
    else resolve();
  }));
  return address.port;
}
const completions = new WeakMap();
function logChild(child, stdoutFd, stderrFd) {
  // Retain actual close, which follows exit AND draining/closing stdio.
  completions.set(child, new Promise(resolve => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  }));
  const write = (fd, chunk) => { try { fs.writeSync(fd, chunk); } catch { logFailure = true; } };
  child.stdout?.on('data', chunk => write(stdoutFd, chunk));
  child.stderr?.on('data', chunk => write(stderrFd, chunk));
  child.on('error', () => {});
  return child;
}
function closed(child) {
  return child ? completions.get(child) : Promise.resolve({ code: null, signal: null });
}
async function closeWithin(child, milliseconds) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), milliseconds); });
  const result = await Promise.race([closed(child), timeout]);
  clearTimeout(timer);
  return result;
}
function groupExists(pid) {
  if (!Number.isSafeInteger(pid)) return false;
  try { process.kill(-pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}
async function stopOwned(child, { processGroup = false } = {}) {
  if (!child) return { childStopped: true, groupStopped: true };
  const pid = child.pid;
  if (processGroup && Number.isSafeInteger(pid)) {
    try { process.kill(-pid, 'SIGTERM'); } catch {}
  } else if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGTERM'); } catch {}
  }
  let childResult = await closeWithin(child, stopGraceMs);
  const groupDeadline = Date.now() + stopGraceMs;
  while (processGroup && groupExists(pid) && Date.now() < groupDeadline)
    await new Promise(resolve => setTimeout(resolve, 100));
  if ((processGroup && groupExists(pid)) || (!processGroup && !childResult)) {
    try {
      if (processGroup) process.kill(-pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {}
  }
  if (!childResult) childResult = await closeWithin(child, stopGraceMs);
  if (processGroup && groupExists(pid)) {
    try { process.kill(-pid, 'SIGKILL'); } catch {}
    const finalDeadline = Date.now() + stopGraceMs;
    while (groupExists(pid) && Date.now() < finalDeadline) await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { childStopped: Boolean(childResult) && (child.exitCode !== null || child.signalCode !== null),
    groupStopped: !processGroup || !groupExists(pid) };
}
async function waitReady(child) {
  return new Promise((resolve, reject) => {
    let tail = '';
    let done = false;
    const finish = error => {
      if (done) return;
      done = true; clearTimeout(timer); child.off('error', onError); child.off('close', onClose);
      if (error) reject(error);
      else resolve();
    };
    const onError = () => finish(new GateError('SERVER_SPAWN_FAILED'));
    const onClose = () => finish(new GateError('SERVER_EXITED_BEFORE_READY'));
    const timer = setTimeout(() => finish(new GateError('SERVER_READY_TIMEOUT')), maxReadyMs);
    child.on('error', onError); child.on('close', onClose);
    child.stdout.on('data', chunk => {
      tail = (tail + chunk.toString('utf8')).slice(-2048);
      if (/Ready in/u.test(tail)) finish();
    });
  });
}
async function validateReachedServer(baseUrl) {
  const authResponse = await fetch(`${baseUrl}/api/auth/check`, { signal: AbortSignal.timeout(8_000) });
  must(authResponse.ok, 'AUTH_CHECK_HTTP');
  const auth = await authResponse.json();
  must(auth.status === 'ok' && auth.isSetup === true && auth.hasSession === false && auth.db?.state === 'ready', 'AUTH_FIXTURE_MISMATCH');
  const revisionResponse = await fetch(`${baseUrl}/api/system/revision`, { signal: AbortSignal.timeout(8_000) });
  must(revisionResponse.ok, 'REVISION_HTTP');
  const revision = await revisionResponse.json();
  receipt.app_revision = revision.revision ?? null;
  receipt.app_source_fingerprint = revision.sourceFingerprint ?? null;
  receipt.app_fingerprint = revision.fingerprint ?? null;
  receipt.app_revision_match = revision.revision === pin.revision;
  const fingerprint = `${pin.branch}@${pin.revision}:${pin.worktreeHash}`;
  receipt.source_fingerprint_match = revision.sourceFingerprint === fingerprint && revision.fingerprint === fingerprint;
  must(receipt.app_revision_match && receipt.source_fingerprint_match, 'REACHED_SERVER_SOURCE_MISMATCH');
}
async function main() {
  process.umask(0o077);
  const onTerminate = () => {
    terminationRequested = true;
    for (const child of [seedChild, serverChild, cliChild]) {
      if (Number.isSafeInteger(child?.pid)) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
    }
  };
  process.on('SIGTERM', onTerminate); process.on('SIGINT', onTerminate);
  try {
    finalStage = stage.preflight;
    must(/^[a-f0-9]{40}$/.test(pin.head || ''), 'SOURCE_HEAD_MISMATCH');
    exportDir = process.env.OCR_CAUSAL_EXPORT_DIR;
    must(typeof exportDir === 'string' && path.isAbsolute(exportDir) && fs.realpathSync(exportDir) === exportDir && !fs.lstatSync(exportDir).isSymbolicLink() && fs.statSync(exportDir).isDirectory() && (fs.statSync(exportDir).mode & 0o777) === 0o700 && fs.readdirSync(exportDir).length === 0, 'EXPORT_DIRECTORY_INVALID');
    same(process.versions.node, '24.21.0', 'RUNNER_NODE_VERSION_MISMATCH');
    same(process.versions.modules, '137', 'RUNNER_NODE_ABI_MISMATCH');
    verifyPinAndRuntime();
    finalStatus = status.running;

    finalStage = stage.fixture;
    must(process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP), 'TEMP_DIRECTORY_INVALID');
    tempRoot = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'mf-ocr-run-'));
    fs.chmodSync(tempRoot, 0o700);
    dataDir = path.join(tempRoot, 'data');
    fs.mkdirSync(dataDir, { mode: 0o700 });
    fs.chmodSync(dataDir, 0o700);
    must(path.isAbsolute(dataDir) && fs.realpathSync(dataDir) === dataDir
 && !fs.lstatSync(dataDir).isSymbolicLink(), 'DATA_PATH_NOT_ISOLATED');
    fs.mkdirSync(path.join(tempRoot, 'artifacts'), { mode: 0o700 });
    const marker = path.join(dataDir, 'SYNTHETIC_ONLY');
    const markerFd = fs.openSync(marker, 'wx', 0o600);
    fs.writeFileSync(markerFd, 'synthetic-only\n'); fs.fsyncSync(markerFd); fs.closeSync(markerFd);
    const runPin = randomBytes(12).toString('hex');
    const env = minimalEnv(dataDir, runPin);
    const seedOut = path.join(tempRoot, 'artifacts', 'seed.stdout.log');
    const seedErr = path.join(tempRoot, 'artifacts', 'seed.stderr.log');
    seedLogFd = fs.openSync(seedOut, 'w', 0o600);
    seedErrFd = fs.openSync(seedErr, 'w', 0o600);
    seedChild = logChild(spawn(process.execPath, [path.join(sourceRoot, 'scripts/prepare-e2e-db.mjs')], {
      cwd: sourceRoot, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    }), seedLogFd, seedErrFd);
    const seedResult = await closeWithin(seedChild, maxSeedMs);
    if (!seedResult) {
      timedOut = true;
      const stopped = await stopOwned(seedChild, { processGroup: true });
      receipt.seed_child_stopped = stopped.childStopped;
      throw new GateError('SEED_TIMEOUT');
    }
    receipt.seed_child_stopped = true;
    exitCode = seedResult.code;
    must(seedResult.code === 0, 'SYNTHETIC_SEED_FAILED');
    fs.closeSync(seedLogFd); seedLogFd = null;
    fs.closeSync(seedErrFd); seedErrFd = null;
    for (const name of ['medical.db', 'medical.db-wal', 'medical.db-shm']) {
      const filename = path.join(dataDir, name);
      if (fs.existsSync(filename)) fs.chmodSync(filename, 0o600);
    }
    must(regular(path.join(dataDir, 'medical.db')) && regular(marker), 'SYNTHETIC_FIXTURE_MISSING');

    finalStage = stage.runtime;
    const port = await freeLoopbackPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const serverEnv = { ...env, HOSTNAME: '127.0.0.1', PORT: String(port) };
    receipt.server_env_fixture_match = serverEnv.MEDIFLOW_DATA_DIR === serverEnv.MEDIFLOW_E2E_DATA_DIR
      && serverEnv.MEDIFLOW_E2E_DISABLE_LEGACY_COPY === '1' && serverEnv.E2E_DISABLE_LEGACY_COPY === '1'
      && serverEnv.MF085_SYNTHETIC_E2E === '1' && serverEnv.E2E_DOCUMENTS_SYNTHETIC_ONLY === '1';
    must(receipt.server_env_fixture_match, 'SERVER_FIXTURE_ENV_MISMATCH');
    serverOutFd = fs.openSync(path.join(tempRoot, 'artifacts', 'server.stdout.log'), 'w', 0o600);
    serverErrFd = fs.openSync(path.join(tempRoot, 'artifacts', 'server.stderr.log'), 'w', 0o600);
    serverChild = logChild(spawn(process.execPath, [path.join(standalone, 'server.js')], {
      cwd: standalone, env: serverEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    }), serverOutFd, serverErrFd);
    receipt.server_pid = serverChild.pid ?? null;
    must(Number.isSafeInteger(receipt.server_pid), 'SERVER_PID_UNAVAILABLE');
    finalStage = stage.readiness;
    await waitReady(serverChild);
    receipt.app_ready = true;

    finalStage = stage.identity;
    await validateReachedServer(baseUrl);

    finalStage = stage.playwright;
    const outputDir = path.join(tempRoot, 'artifacts', 'pw-output');
    fs.mkdirSync(outputDir, { mode: 0o700 });
    const stdoutPath = path.join(tempRoot, 'artifacts', 'playwright.stdout.json');
    const stderrPath = path.join(tempRoot, 'artifacts', 'playwright.stderr.log');
    cliStdoutFd = fs.openSync(stdoutPath, 'w', 0o600);
    cliStderrFd = fs.openSync(stderrPath, 'w', 0o600);
    const cli = path.join(sourceRoot, 'node_modules/playwright/cli.js');
    must(regular(cli), 'PLAYWRIGHT_CLI_MISSING');
    const args = [cli, 'test', '--config', acceptedConfig, '--output', outputDir,
      '--workers=1', '--reporter=json', '--grep', imageGrep, testFile];
    cliChild = logChild(spawn(process.execPath, args, {
      cwd: sourceRoot, env: { ...env, E2E_BASE_URL: baseUrl }, detached: true,
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    }), cliStdoutFd, cliStderrFd);
    const cliResult = await closeWithin(cliChild, maxCliMs);
    if (!cliResult) {
      timedOut = true;
      const stopped = await stopOwned(cliChild, { processGroup: true });
      receipt.playwright_child_stopped = stopped.childStopped;
      receipt.playwright_group_stopped = stopped.groupStopped;
        throw new GateError('PLAYWRIGHT_TIMEOUT');
    }
    receipt.playwright_child_stopped = true;
    receipt.playwright_group_stopped = true;
    receipt.playwright_exit_code = cliResult.code;
    exitCode = cliResult.code;
    fs.closeSync(cliStdoutFd); cliStdoutFd = null;
    fs.closeSync(cliStderrFd); cliStderrFd = null;
    must(fs.statSync(stdoutPath).size <= MAX_REPORT_BYTES, 'REPORT_INVALID');
    reduced = reduceReport(fs.readFileSync(stdoutPath), cliResult.code);
    must(!logFailure && !terminationRequested, 'RUNNER_INTERNAL_FAILURE');
    must(reduced.qualification === 'QUALIFIED', 'REPORT_INVALID');
    must(cliResult.code === 0, 'PLAYWRIGHT_FAILED');
    finalStatus = status.pass;
  } catch (error) {
    receipt.failure_code = error instanceof GateError ? error.code : 'RUNNER_INTERNAL_FAILURE';
    finalStatus = timedOut ? status.timeout : (receipt.app_ready ? status.fail : status.hold);
    if (exitCode === null) exitCode = 1;
  } finally {
    const cliStopped = await stopOwned(cliChild, { processGroup: true });
    receipt.playwright_child_stopped = cliStopped.childStopped;
    receipt.playwright_group_stopped = cliStopped.groupStopped;
    const serverStopped = await stopOwned(serverChild, { processGroup: true });
    receipt.server_child_stopped = serverStopped.childStopped;
    receipt.server_group_stopped = serverStopped.groupStopped;
    const seedStopped = await stopOwned(seedChild, { processGroup: true });
    receipt.seed_child_stopped = seedStopped.childStopped;
    cleanupSafe = receipt.playwright_child_stopped && receipt.playwright_group_stopped
      && receipt.server_child_stopped && receipt.server_group_stopped && receipt.seed_child_stopped && seedStopped.groupStopped;
    // Numeric FDs captured by data listeners remain open until actual close.
    const descriptorGroups = [[cliStopped.childStopped, [cliStdoutFd, cliStderrFd]],
      [serverStopped.childStopped, [serverOutFd, serverErrFd]],
      [seedStopped.childStopped, [seedLogFd, seedErrFd]]];
    for (const [stopped, descriptors] of descriptorGroups) {
      if (stopped) for (const fd of descriptors) if (fd !== null) { try { fs.closeSync(fd); } catch {} }
    }
    if (cleanupSafe && dataDir && fs.existsSync(dataDir)) {
      try { fs.rmSync(dataDir, { recursive: true, force: true }); receipt.private_fixture_removed = !fs.existsSync(dataDir); } catch {}
    } else if (cleanupSafe && dataDir) receipt.private_fixture_removed = true;
    if (!cleanupSafe || !receipt.private_fixture_removed) {
      if (finalStatus === status.pass) {
        finalStatus = status.fail;
        receipt.failure_code = 'OWNED_CLEANUP_INCOMPLETE';
      }
    }
    if (finalStatus !== status.pass && (!Number.isInteger(exitCode) || exitCode === 0)) exitCode = 1;
    if (cleanupSafe && tempRoot) {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); receipt.private_fixture_removed = !fs.existsSync(tempRoot); } catch {}
    }
    const cleaned = cleanupSafe && (tempRoot === null || !fs.existsSync(tempRoot));
    if (logFailure || terminationRequested) { finalStatus = status.fail; receipt.failure_code = 'RUNNER_INTERNAL_FAILURE'; }
    if (!cleaned) { finalStatus = status.fail; receipt.failure_code = 'OWNED_CLEANUP_INCOMPLETE'; }
    if (exportDir && regularDirectory(exportDir) && fs.readdirSync(exportDir).length === 0) {
      exportEvidence(exportDir, reduced, { sourceHead: /^[a-f0-9]{40}$/.test(pin.head || '') ? pin.head : null, sourceTree: pin.tree, nodeMajor: Number(process.versions.node.split('.')[0]), nodeAbi: Number(process.versions.modules), originalCliExitCode: receipt.playwright_exit_code, stageCode: finalStage, statusCode: finalStatus, cleanupConfirmed: cleaned, runtimeContractMatch: receipt.runtime_contract_match, identityMatch: receipt.source_fingerprint_match, errorCode: safeErrorCode(receipt.failure_code) });
    }

  }
  process.off('SIGTERM', onTerminate); process.off('SIGINT', onTerminate);
  process.exitCode = finalStatus === status.pass ? 0 : (Number.isInteger(exitCode) && exitCode > 0 ? exitCode : 1);
}

// Importing this module exposes the reducer without starting any process or app.
export const MAX_REPORT_BYTES = 8 * 1024 * 1024;
export const MAX_CAPTURE_BYTES = 256 * 1024;
const PHASES = ['acquire', 'source', 'project', 'release'];
const APP_EVENTS = new Set(`operation_begin operation_end effective_signal_abort
abort_pagehide abort_effect_cleanup abort_delete abort_session_listener
abort_view_cleanup abort_list_refresh abort_user_interrupt session_set_key_clear
session_set_key_replace fetch_call fetch_return fetch_resolved fetch_throw
fetch_rejected source_call source_return source_resolved source_rejected
reader_acquire_call reader_acquired reader_acquire_throw read_call read_return
read_settled read_throw read_rejected read_chunk read_guard_entry read_guard_pre
read_guard_post read_limit decode_chunk_throw decode_flush_throw body_complete
body_absent text_call text_resolved text_rejected reader_cancel_abort
reader_cancel_cleanup reader_cancel_rejected reader_release_call
reader_release_return reader_release_throw release_abort release_finally
release_skipped project_guard project_raw_rejected extraction_keys_rejected
client_available client_catch client_finally ui_preview_return
ui_result_discarded`.split(/\s+/u));
function exact(value, keys) {
  must(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)), 'REPORT_INVALID');
}
function natural(value, maximum = Number.MAX_SAFE_INTEGER) {
  must(Number.isSafeInteger(value) && value >= 0 && value <= maximum, 'REPORT_INVALID');
}
function boolean(value) { must(typeof value === 'boolean', 'REPORT_INVALID'); }
function rows(value, maximum) { must(Array.isArray(value) && value.length <= maximum, 'REPORT_INVALID'); }
export function validateCapture(value) {
  exact(value, ['schema', 'app', 'browser', 'coverage']);
  must(value.schema === 'mediflow.ocr_causal_capture.v1', 'REPORT_INVALID');
  const app = value.app;
  if (app !== null) {
    exact(app, ['schema', 'enabled', 'total', 'dropped', 'invalid', 'late', 'armed', 'sealed', 'operationCount', 'active', 'events']);
    must(app.schema === 'mediflow.ocr_causal_probe.v1' && app.enabled === true, 'REPORT_INVALID');
    for (const key of ['total', 'dropped', 'invalid', 'late', 'operationCount', 'active']) natural(app[key]);
    for (const key of ['armed', 'sealed']) boolean(app[key]);
    rows(app.events, 1024);
    for (const row of app.events) {
      exact(row, ['seq', 'op', 'event', 'phase', 'ms', 'value', 'flags']);
      natural(row.seq); natural(row.op, 8); must(row.op > 0, 'REPORT_INVALID');
      must(APP_EVENTS.has(row.event) && [...PHASES, 'ui', 'session'].includes(row.phase), 'REPORT_INVALID');
      must(typeof row.ms === 'number' && Number.isFinite(row.ms) && row.ms >= 0 && row.ms <= Number.MAX_SAFE_INTEGER, 'REPORT_INVALID');
      natural(row.value, 32 * 1024 * 1024); natural(row.flags, 255);
    }
  }
  const browser = value.browser;
  exact(browser, ['total', 'dropped', 'invalid', 'late', 'sealed', 'events']);
  for (const key of ['total', 'dropped', 'invalid', 'late']) natural(browser[key]);
  boolean(browser.sealed); rows(browser.events, 256);
  for (const row of browser.events) {
    exact(row, ['seq', 'req', 'phase', 'event', 'value']);
    natural(row.seq); natural(row.req, 16); natural(row.value, 65535);
    must([...PHASES, 'context'].includes(row.phase)
      && ['request', 'response', 'finished', 'failed', 'navigation', 'closed', 'crashed'].includes(row.event), 'REPORT_INVALID');
  }
  const coverage = value.coverage;
  exact(coverage, ['appComplete', 'browserComplete', 'browserSettledBeforeSeal', 'roots', 'appCalls', 'uniqueAppCalls', 'singleOperationJoinEligible']);
  for (const key of ['appComplete', 'browserComplete', 'browserSettledBeforeSeal', 'uniqueAppCalls', 'singleOperationJoinEligible']) boolean(coverage[key]);
  for (const key of ['roots', 'appCalls']) {
    rows(coverage[key], 4); must(coverage[key].length === 4, 'REPORT_INVALID');
    coverage[key].forEach((row, index) => {
      exact(row, ['phase', 'count']); must(row.phase === PHASES[index], 'REPORT_INVALID'); natural(row.count, 1024);
    });
  }
  // A detached copy also prevents callers from changing validation after return.
  return JSON.parse(JSON.stringify(value));
}
function completeCapture(capture) {
  const { app, browser, coverage } = capture;
  // Recompute the helper's exclusive operation / role join from validated rows.
  // Advertised coverage flags cannot establish completeness on their own.
  if (!app?.armed || !app.sealed || app.operationCount !== 1 || app.active !== 0
    || !browser.sealed || app.total !== app.events.length || browser.total !== browser.events.length
    || !['dropped', 'invalid', 'late'].every(k => app[k] === 0 && browser[k] === 0)
    || !app.events.every((row, index) => row.seq === index + 1 && row.op === 1)
    || !browser.events.every((row, index) => row.seq === index + 1)
    || app.events.filter(row => row.event === 'operation_begin').length !== 1
    || app.events.filter(row => row.event === 'operation_end').length !== 1) return false;

  const appCalls = PHASES.map(phase => app.events.filter(row => row.phase === phase
    && row.event === (phase === 'source' ? 'source_call' : 'fetch_call')).length);
  if (!appCalls.every(count => count === 1)
    || app.events.filter(row => row.event === 'fetch_call').length !== 3
    || app.events.filter(row => row.event === 'source_call').length !== 1) return false;

  const requests = new Map();
  for (const row of browser.events) {
    if (row.phase === 'context') {
      // Context events have no request owner and preclude browserComplete.
      if (row.req !== 0) return false;
      return false;
    }
    if (!PHASES.includes(row.phase) || row.req < 1 || row.req > 16) return false;
    if (row.event === 'request') {
      if (requests.has(row.req)) return false;
      requests.set(row.req, { phase: row.phase, terminals: 0, responses: 0 });
    } else {
      const owner = requests.get(row.req);
      if (!owner || owner.phase !== row.phase || owner.terminals !== 0) return false;
      if (row.event === 'response') {
        if (++owner.responses > 1) return false;
      } else if (row.event === 'finished' || row.event === 'failed') owner.terminals++;
      else return false;
    }
  }
  const roots = PHASES.map(phase => [...requests.values()].filter(owner => owner.phase === phase).length);
  const browserSettled = requests.size === 4 && [...requests.values()].every(owner => owner.terminals === 1);
  if (!browserSettled || !roots.every(count => count === 1)
    || !coverage.roots.every((row, index) => row.count === roots[index])
    || !coverage.appCalls.every((row, index) => row.count === appCalls[index])) return false;
  return coverage.appComplete && coverage.browserComplete && coverage.browserSettledBeforeSeal
    && coverage.uniqueAppCalls && coverage.singleOperationJoinEligible;
}

function decodeAttachment(attachment) {
  must(attachment.contentType === 'application/json' && typeof attachment.body === 'string', 'REPORT_INVALID');
  must(attachment.body.length <= 4 * Math.ceil(MAX_CAPTURE_BYTES / 3)
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(attachment.body), 'REPORT_INVALID');
  const bytes = Buffer.from(attachment.body, 'base64');
  must(bytes.length <= MAX_CAPTURE_BYTES && bytes.toString('base64') === attachment.body, 'REPORT_INVALID');
  return validateCapture(JSON.parse(bytes.toString('utf8')));
}
export function reduceReport(raw, cliExitCode) {
  // No errors, assertions, paths, grants, response data or report config enter output.
  const result = { schema: 'mediflow.ocr_causal_ci_summary.v1', plannedTests: null, originalTestOutcome: 'reportUnavailable', attemptCountKnown: false,
    originalCliExitCode: Number.isInteger(cliExitCode) && cliExitCode >= 0 && cliExitCode <= 255 ? cliExitCode : null,
    qualification: 'INCONCLUSIVE', errorCode: 'REPORT_INVALID', attempts: [], captures: [] };
  try {
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    must(bytes.length <= MAX_REPORT_BYTES, 'REPORT_INVALID');
    const text = bytes.toString('utf8');
    // JSON reporter stdout must be JSON; no permissive scan past raw log preambles.
    const report = JSON.parse(text);
    must(report !== null && typeof report === 'object' && !Array.isArray(report)
      && Array.isArray(report.suites), 'REPORT_INVALID');
    const tests = [];
    let nodes = 0;
    const visit = (suites, depth = 0) => {
      rows(suites, 32); must(depth <= 16, 'REPORT_INVALID');
      for (const suite of suites) {
        must(++nodes <= 64 && suite !== null && typeof suite === 'object', 'REPORT_INVALID');
        rows(suite.specs ?? [], 32);
        for (const spec of suite.specs ?? []) {
          rows(spec.tests ?? [], 2);
          for (const test of spec.tests ?? []) { tests.push({ spec, test }); must(tests.length <= 1, 'REPORT_INVALID'); }
        }
        visit(suite.suites ?? [], depth + 1);
      }
    };
    visit(report.suites);
    if (tests.length === 0) {
      result.plannedTests = 0; result.originalTestOutcome = 'setupFailure'; result.attemptCountKnown = true;
      result.errorCode = 'SETUP_FAILURE'; return result;
    }
    const { spec, test } = tests[0];
    must(spec.title === imageTitle && typeof spec.file === 'string' && path.basename(spec.file) === 'document-upload-ocr.spec.ts', 'REPORT_INVALID');
    result.plannedTests = 1;
    must(['expected', 'unexpected', 'flaky', 'skipped'].includes(test.status), 'REPORT_INVALID');
    result.originalTestOutcome = test.status;
    rows(test.results, 2);
    let qualified = (test.results?.length ?? 0) > 0;
    for (const [index, attempt] of (test.results ?? []).entries()) {
      must(['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(attempt.status), 'REPORT_INVALID');
      natural(attempt.duration, 300000); must(attempt.retry === index, 'REPORT_INVALID');
      const entry = { attempt: index + 1, retry: index, status: attempt.status, durationMs: attempt.duration,
        captureCount: 0, sameResponseOracle: attempt.status === 'passed' ? 'PASS' : 'NOT_QUALIFIED', interpretation: 'INCONCLUSIVE' };
      result.attempts.push(entry);
      try {
        rows(attempt.attachments ?? [], 32);
        const matches = (attempt.attachments ?? []).filter(a => a?.name === 'ocr-causal-metadata');
        must(matches.length === 1, 'REPORT_INVALID');
        const capture = decodeAttachment(matches[0]);
        const filename = `ocr-causal-capture-${index + 1}.json`;
        result.captures.push({ filename, capture }); entry.captureCount = 1; entry.capture = filename;
        if (completeCapture(capture)) {
          // No historical attribution. Absence only refers to this sealed/disposed capture.
          const aborts = capture.app.events.filter(r => r.event === 'effective_signal_abort');
          const owner = capture.app.events.some(r => r.event.startsWith('abort_') && r.flags === 0
            && aborts.some(a => a.op === r.op && a.phase === r.phase && a.seq === r.seq + 1));
          entry.interpretation = aborts.length ? (owner ? 'POSITIVE_ABORT_OWNER_REQUIRES_SOURCE_REVIEW' : 'ABORT_INITIATOR_UNKNOWN')
            : 'NO_EFFECTIVE_SIGNAL_ABORT_IN_COMPLETE_CAPTURE';
        } else qualified = false;
      } catch { qualified = false; }
      if (attempt.status === 'skipped' || attempt.status === 'interrupted') qualified = false;
    }
    result.attemptCountKnown = true;
    const outcomes = result.attempts.map(a => a.status);
    const failure = s => ['failed', 'timedOut', 'interrupted'].includes(s);
    const consistent = test.status === 'expected' ? outcomes.length === 1 && outcomes[0] === 'passed'
      : test.status === 'flaky' ? outcomes.length === 2 && failure(outcomes[0]) && outcomes[1] === 'passed'
      : test.status === 'unexpected' ? outcomes.length > 0 && failure(outcomes.at(-1))
      : outcomes.length <= 1 && outcomes.every(s => s === 'skipped');
    must(consistent, 'REPORT_INVALID');
    result.qualification = qualified ? 'QUALIFIED' : 'INCONCLUSIVE';
    result.errorCode = qualified ? 'NONE' : 'CAPTURE_INCOMPLETE';
  } catch { result.qualification = 'INCONCLUSIVE'; result.errorCode = 'REPORT_INVALID'; }
  if (result.qualification === 'INCONCLUSIVE') for (const attempt of result.attempts) attempt.interpretation = 'INCONCLUSIVE';
  return result;
}
const ERROR_CODES = new Set(`NONE REPORT_INVALID SETUP_FAILURE CAPTURE_INCOMPLETE SOURCE_HEAD_MISMATCH
SOURCE_TREE_MISMATCH SOURCE_BRANCH_MISMATCH SOURCE_WORKTREE_NOT_CLEAN SOURCE_PIN_UNAVAILABLE
RUNNER_NODE_VERSION_MISMATCH RUNNER_NODE_ABI_MISMATCH RUNTIME_CONTRACT_SCHEMA_MISMATCH
RUNTIME_NODE_MAJOR_MISMATCH RUNTIME_NODE_VERSION_MISMATCH RUNTIME_NODE_ABI_MISMATCH
RUNTIME_PLATFORM_MISMATCH RUNTIME_ARCH_MISMATCH RUNTIME_SQLITE_VERSION_MISMATCH
STANDALONE_SERVER_MISSING BUILD_ID_MISSING STANDALONE_BUILD_ID_MISSING BUILD_ID_MISMATCH
REQUIRED_SERVER_DISTDIR_MISMATCH REQUIRED_SERVER_OUTPUT_MISMATCH LOCAL_CONFIG_MISSING
FRESH_DEPENDENCY_MISSING BUILD_STATIC_MISSING ASSET_SOURCE_MISSING ASSET_LINK_MISMATCH
ASSET_TARGET_CONFLICT EXPORT_DIRECTORY_INVALID TEMP_DIRECTORY_INVALID DATA_PATH_NOT_ISOLATED
SEED_TIMEOUT SYNTHETIC_SEED_FAILED SYNTHETIC_FIXTURE_MISSING SERVER_FIXTURE_ENV_MISMATCH
SERVER_PID_UNAVAILABLE SERVER_SPAWN_FAILED SERVER_EXITED_BEFORE_READY SERVER_READY_TIMEOUT
AUTH_CHECK_HTTP AUTH_FIXTURE_MISMATCH REVISION_HTTP REACHED_SERVER_SOURCE_MISMATCH
LOOPBACK_PORT_UNAVAILABLE PLAYWRIGHT_CLI_MISSING PLAYWRIGHT_TIMEOUT PLAYWRIGHT_FAILED
OWNED_CLEANUP_INCOMPLETE RUNNER_INTERNAL_FAILURE`.split(/\s+/u));
function safeErrorCode(code) { return code === undefined ? 'NONE' : ERROR_CODES.has(code) ? code : 'RUNNER_INTERNAL_FAILURE'; }
function regularDirectory(directory) {
  const st = fs.lstatSync(directory, { throwIfNoEntry: false });
  return Boolean(st?.isDirectory() && !st.isSymbolicLink() && (st.mode & 0o777) === 0o700);
}
function writePrivateExclusive(filename, value) {
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function exportEvidence(directory, reducedReport, identity) {
  const reachedPlaywright = identity.stageCode >= stage.playwright;
  const report = reducedReport ?? { plannedTests: reachedPlaywright ? null : 0,
    originalTestOutcome: reachedPlaywright ? 'reportUnavailable' : 'setupFailure', attemptCountKnown: !reachedPlaywright,
    qualification: 'INCONCLUSIVE', errorCode: reachedPlaywright ? 'REPORT_INVALID' : 'SETUP_FAILURE', attempts: [], captures: [] };
  for (const { filename, capture } of report.captures) writePrivateExclusive(path.join(directory, filename), capture);
  writePrivateExclusive(path.join(directory, 'ocr-causal-summary.json'), {
    schema: 'mediflow.ocr_causal_ci_summary.v1', ...identity,
    plannedTests: report.plannedTests, originalTestOutcome: report.originalTestOutcome, attemptCountKnown: report.attemptCountKnown,
    qualification: identity.cleanupConfirmed && identity.runtimeContractMatch && identity.identityMatch && ['NONE', 'PLAYWRIGHT_FAILED'].includes(identity.errorCode) ? report.qualification : 'INCONCLUSIVE',
    reductionErrorCode: report.errorCode, attempts: report.attempts,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch(() => { process.exitCode = 1; });
