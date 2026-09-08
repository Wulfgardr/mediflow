#!/usr/bin/env node
/* @Codex */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertNodeRuntime, readNodeContract, verifyNativeBinding } from './node-runtime-contract.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const MINI_DESKTOP_ACCEPTANCE_TESTS = Object.freeze([
  'packages/mini/src/protocol.test.ts',
  'packages/mini/src/session.test.ts',
  'packages/mini/src/cli.test.ts',
  'lib/security/portable-supervisor-mini-production.test.ts',
]);
const SUPPORT_FILES = Object.freeze([
  '.nvmrc', 'package.json', 'package-lock.json',
  'scripts/prepare-e2e-db.mjs', 'scripts/run-strip-types.mjs',
  'scripts/register-strip-types-loader.mjs',
  'lib/security/portable-supervisor-production.ts',
  'lib/security/web-auth-lifecycle-owner-test-fixture.ts',
  'packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.7.tgz',
]);
const LOCKED_DEPENDENCIES = Object.freeze([
  'typescript', 'better-sqlite3', 'drizzle-orm', 'zod', 'bcryptjs',
  '@mediflow/web-auth-lifecycle-owner',
]);
const OS_ENVIRONMENT = new Set([
  'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'LANG', 'LC_ALL', 'TZ',
]);

/** A fixed roster is intentional: missing tests must not become a smaller green run. */
export function requireMiniAcceptanceFiles(root = repoRoot) {
  for (const relative of [...SUPPORT_FILES, ...MINI_DESKTOP_ACCEPTANCE_TESTS]) {
    let stat;
    try { stat = fs.lstatSync(path.join(root, relative)); } catch { /* checked below */ }
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`Required acceptance file missing: ${relative}`);
  }
  return [...MINI_DESKTOP_ACCEPTANCE_TESTS];
}

/** The harness never adopts a caller's DB, provider, credentials, NODE_OPTIONS or loader. */
export function miniAcceptanceEnvironment(parentEnv, dataDir) {
  if (!path.isAbsolute(dataDir)) throw new Error('Acceptance data directory must be absolute.');
  const env = {};
  const seen = new Set();
  for (const [key, value] of Object.entries(parentEnv)) {
    const normalized = key.toUpperCase();
    if (!OS_ENVIRONMENT.has(normalized) || typeof value !== 'string' || seen.has(normalized)) continue;
    seen.add(normalized);
    env[key] = value;
  }
  return {
    ...env,
    MEDIFLOW_DATA_DIR: dataDir,
    MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1',
    MEDIFLOW_STRIP_TYPES_NODE: process.execPath,
    E2E_USERNAME: 'synthetic-mini-acceptance',
    E2E_PIN: '1234',
    E2E_DISPLAY_NAME: 'Synthetic Mini Acceptance',
    E2E_AMBULATORY_NAME: 'Synthetic Mini Ambulatory',
  };
}

/** Only this newly allocated directory is ever deleted, including on a thrown stage error. */
export function withMiniAcceptanceDataDir(action) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-mini-acceptance #%-')));
  try { return action(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

/** TAP is evidence from node:test, not a claim inferred from the existence of test files. */
export function miniAcceptanceSummary(stdout) {
  if (typeof stdout !== 'string') return null;
  const summary = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...stdout.matchAll(new RegExp(`^# ${key} ([0-9]+)\\r?$`, 'gm'))];
    if (matches.length !== 1) return null;
    const value = Number(matches[0][1]);
    if (!Number.isSafeInteger(value)) return null;
    summary[key] = value;
  }
  if (summary.tests < 1 || summary.tests !== summary.pass
    || summary.fail || summary.cancelled || summary.skipped || summary.todo) return null;
  return summary;
}

/** Injectable process/console seams test orchestration only; they do not substitute AIP or SQLite. */
export function executeMiniAcceptanceStages({
  root, dataDir, parentEnv = process.env, spawnSyncImpl = spawnSync,
  writeOut = (text) => process.stdout.write(text), writeErr = (text) => process.stderr.write(text),
}) {
  const tests = requireMiniAcceptanceFiles(root);
  const env = miniAcceptanceEnvironment(parentEnv, dataDir);
  const stages = [
    ['synthetic_database', [path.join(root, 'scripts/prepare-e2e-db.mjs')]],
    ['mini_real_host_tests', [path.join(root, 'scripts/run-strip-types.mjs'),
      '--test', '--test-concurrency=1', '--test-reporter=tap', ...tests]],
  ];
  const results = [];
  let summary = null;
  for (const [name, args] of stages) {
    let child;
    try {
      child = spawnSyncImpl(process.execPath, args, {
        cwd: root, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES,
      });
    } catch { child = { status: null, signal: null, error: new Error('spawn_failed') }; }
    if (typeof child.stdout === 'string') writeOut(child.stdout);
    if (typeof child.stderr === 'string') writeErr(child.stderr);
    const status = Number.isInteger(child.status) ? child.status : 1;
    const failed = Boolean(child.error) || Boolean(child.signal) || status !== 0;
    if (!failed && name === 'mini_real_host_tests') summary = miniAcceptanceSummary(child.stdout);
    const invalidSummary = !failed && name === 'mini_real_host_tests' && summary === null;
    results.push({ name, status: failed || invalidSummary ? (status || 1) : 0,
      signal: child.signal ?? null,
      error: child.error ? 'process_failure' : invalidSummary ? 'incomplete_test_evidence' : null });
    if (failed || invalidSummary) return { status: 'failed', exitCode: results.at(-1).status, stages: results, summary };
  }
  return { status: 'passed', exitCode: 0, stages: results, summary };
}

function requireLockedDependencies(root) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  for (const name of LOCKED_DEPENDENCIES) {
    const key = `node_modules/${name}`;
    let installed;
    try { installed = JSON.parse(fs.readFileSync(path.join(root, key, 'package.json'), 'utf8')); }
    catch { throw new Error(`Locked dependency unavailable: ${name}`); }
    if (!lock.packages?.[key]?.version || installed.version !== lock.packages[key].version) {
      throw new Error(`Locked dependency version mismatch: ${name}`);
    }
  }
}

/** No bypass flag: the acceptance command itself requires the supported runtime and real binding. */
export function runMiniDesktopAcceptance() {
  const root = fs.realpathSync(repoRoot);
  requireMiniAcceptanceFiles(root);
  const runtime = assertNodeRuntime(readNodeContract(root));
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) throw new Error('Unsupported acceptance platform.');
  requireLockedDependencies(root);
  verifyNativeBinding(root);
  return withMiniAcceptanceDataDir((dataDir) => ({
    ...executeMiniAcceptanceStages({ root, dataDir }),
    runtime: { node: runtime.version, abi: runtime.moduleVersion, platform: process.platform, arch: process.arch },
    scope: 'synthetic Mini/AIP read-proposal integration; not native UI or release qualification',
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/run-mini-desktop-acceptance.mjs');
    const result = runMiniDesktopAcceptance();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'blocked',
      reason: error instanceof Error ? error.message : 'acceptance_preflight_failed' })}\n`);
    process.exitCode = 1;
  }
}
