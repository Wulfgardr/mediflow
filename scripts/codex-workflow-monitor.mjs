#!/usr/bin/env node
/* @Codex */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd());
const branch = git(['branch', '--show-current'], repoRoot) || '(detached)';
const headSha = git(['rev-parse', 'HEAD'], repoRoot);
const dirty = git(['status', '--porcelain=v1', '-z'], repoRoot).length > 0;
const statePath = path.join(args.stateDir, 'checks.json');
const repoId = createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);

if (args.command === 'clear-checks') {
  const state = readState(statePath);
  delete state.entries[repoId];
  writeState(statePath, state);
  console.log('Workflow monitor: cleared persisted checks for this repository.');
  process.exit(0);
}

const baseRef = resolveBaseRef(repoRoot);
const [behind, ahead] = baseRef === 'origin/main'
  ? git(['rev-list', '--left-right', '--count', 'origin/main...HEAD'], repoRoot).split(/\s+/).map(Number)
  : [0, 0];
const changedPaths = baseRef && branch !== 'main'
  ? gitLines(['diff', '--name-only', `${baseRef}...HEAD`], repoRoot)
  : [];
const hardStopCount = changedPaths.filter(isHardStopPath).length;
const persisted = readState(statePath).entries[repoId];
const persistedMatches = !dirty
  && !args.noPersistedChecks
  && persisted?.branch === branch
  && persisted?.headSha === headSha;
const checks = args.checks.length > 0
  ? args.checks
  : persistedMatches
    ? persisted.checks
    : [];
const checksSource = args.checks.length > 0 ? 'cli' : persistedMatches ? 'sidecar' : 'none';

if (args.persistChecks) {
  if (dirty) fail('Cannot persist checks from a dirty worktree.');
  if (branch === '(detached)') fail('Cannot persist checks for detached HEAD.');
  if (args.checks.length === 0) fail('--persist-checks requires at least one --check=name=status.');
  const state = readState(statePath);
  state.entries[repoId] = { branch, headSha, checks: args.checks, persistedAt: new Date().toISOString() };
  writeState(statePath, state);
}

const failedChecks = checks.filter((check) => check.status === 'fail').length;
const skippedChecks = checks.filter((check) => check.status === 'skip').length;
let decision = 'continue';
let risk = 'low';
let reason = changedPaths.length === 0 ? 'No committed branch delta.' : 'Declared checks cover the committed branch delta.';

if (hardStopCount > 0) {
  decision = 'blocked';
  risk = 'high';
  reason = 'A changed path crosses a protected boundary; path names are withheld.';
} else if (failedChecks > 0) {
  decision = 'blocked';
  risk = 'high';
  reason = 'At least one declared check failed.';
} else if (dirty) {
  decision = 'needs_codex';
  risk = 'medium';
  reason = 'The worktree is dirty; inspect it before promotion.';
} else if (behind > 0) {
  decision = 'needs_codex';
  risk = 'medium';
  reason = 'The local HEAD is behind the current origin/main metadata.';
} else if (changedPaths.length > 0 && checks.length === 0) {
  decision = 'needs_codex';
  risk = 'medium';
  reason = 'The committed branch delta has no check declarations.';
} else if (skippedChecks > 0) {
  decision = 'needs_codex';
  risk = 'medium';
  reason = 'At least one declared check was skipped.';
}

console.log(`Workflow monitor: branch=${branch} head=${headSha.slice(0, 9)} clean=${dirty ? 'no' : 'yes'} changed=${changedPaths.length} ahead=${ahead} behind=${behind}`);
console.log(`Checks: source=${checksSource} declared=${checks.length} pass=${checks.filter((item) => item.status === 'pass').length} fail=${failedChecks} skip=${skippedChecks}`);
console.log(`Decision: ${decision} (${risk})`);
console.log(`Reason: ${reason}`);
console.log('Privacy: metadata-only; no diff content or changed paths emitted.');

function parseArgs(argv) {
  const parsed = {
    command: 'once',
    checks: [],
    noPersistedChecks: false,
    persistChecks: false,
    stateDir: path.join(os.homedir(), '.codex', 'state', 'mediflow-workflow-monitor'),
  };
  for (const arg of argv) {
    if (arg === 'once' || arg === 'clear-checks') parsed.command = arg;
    else if (arg === '--persist-checks') parsed.persistChecks = true;
    else if (arg === '--no-persisted-checks') parsed.noPersistedChecks = true;
    else if (arg.startsWith('--state-dir=')) parsed.stateDir = path.resolve(arg.slice(12));
    else if (arg.startsWith('--check=')) parsed.checks.push(parseCheck(arg.slice(8)));
    else fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function parseCheck(value) {
  const separator = value.lastIndexOf('=');
  if (separator < 1) fail(`Invalid check declaration: ${value}`);
  const check = { name: value.slice(0, separator), status: value.slice(separator + 1) };
  if (!['pass', 'fail', 'skip'].includes(check.status)) fail(`Invalid check status: ${check.status}`);
  return check;
}

function resolveBaseRef(root) {
  for (const candidate of ['origin/main', 'main']) {
    try {
      git(['rev-parse', '--verify', candidate], root);
      return candidate;
    } catch {
      // Try the next local metadata source.
    }
  }
  return null;
}

function isHardStopPath(file) {
  return /(^|\/)(Downloads|mail|calendar|vault)(\/|$)/i.test(file)
    || /(^|\/)(medical\.db|[^/]+\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?)$/i.test(file)
    || /(^|\/)(?:\.env(?:\..+)?|credentials?[^/]*|secrets?[^/]*)$/i.test(file)
    || /(^|\/)(?:siss|fse)(?:\/|[-_.])/i.test(file);
}

function gitLines(gitArgs, cwd) {
  const value = git(gitArgs, cwd);
  return value ? value.split('\n').filter(Boolean) : [];
}

function git(gitArgs, cwd) {
  return execFileSync('git', ['-C', cwd, ...gitArgs], { encoding: 'utf8' }).trim();
}

function readState(file) {
  if (!fs.existsSync(file)) return { version: 1, entries: {} };
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (state?.version !== 1 || !state.entries || typeof state.entries !== 'object') fail('Invalid workflow-monitor state file.');
  return state;
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function fail(message) {
  console.error(`workflow-monitor: ${message}`);
  process.exit(1);
}
