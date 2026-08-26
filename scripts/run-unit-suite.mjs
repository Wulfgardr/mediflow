#!/usr/bin/env node
/* @Codex */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const node = process.execPath;
const unitArgs = ['scripts/run-strip-types.mjs', '--test', '--glob', 'lib/**/*.test.ts', '--glob', 'components/**/*.test.ts', 'scripts/check-schema-drift.test.ts', 'scripts/run-native-probe.test.mjs', 'scripts/audit-quality-gate.test.mjs'];

function syntheticDataDir(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const resolved = path.resolve(value);
  const temporary = `${path.resolve(os.tmpdir())}${path.sep}`;
  return resolved.startsWith(temporary) && path.basename(resolved).startsWith('mediflow-') ? resolved : null;
}

function run(args, env) {
  const result = spawnSync(node, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  return result.status ?? 1;
}

const explicit = syntheticDataDir(process.env.MEDIFLOW_DATA_DIR);
const dataDir = explicit ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-unit-suite-'));
const env = { ...process.env, MEDIFLOW_DATA_DIR: dataDir };
let exitCode = 1;
try {
  const bootstrap = run(['scripts/prepare-e2e-db.mjs'], env);
  if (bootstrap !== 0) process.exitCode = bootstrap;
  else exitCode = run(unitArgs, env);
} finally {
  if (!explicit) fs.rmSync(dataDir, { recursive: true, force: true });
}
if (!process.exitCode) process.exitCode = exitCode;
