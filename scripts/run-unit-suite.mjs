#!/usr/bin/env node
/* @Codex */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireTestDataDir, cleanupTestDataDir } from './test-data-dir.mjs';
import { unitTestInvocationArguments } from './unit-test-selection.mjs';

const root = path.resolve(import.meta.dirname, '..');
const node = process.execPath;
const unitInvocations = unitTestInvocationArguments(root);

function run(args, env) {
  const result = spawnSync(node, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  return { signal: result.signal, status: result.status ?? 1 };
}

const { dataDir, owned } = acquireTestDataDir(process.env, 'mediflow-unit-suite-');
const env = { ...process.env, MEDIFLOW_DATA_DIR: dataDir };
let exitCode = 1;
let signal = null;
try {
  const bootstrap = run(['scripts/prepare-e2e-db.mjs'], env);
  signal = bootstrap.signal;
  if (!signal && bootstrap.status !== 0) exitCode = bootstrap.status;
  else if (!signal) {
    for (const unitArgs of unitInvocations) {
      const unit = run(unitArgs, env);
      signal = unit.signal;
      exitCode = unit.status;
      if (signal || exitCode !== 0) break;
    }
  }
} finally {
  cleanupTestDataDir({ dataDir, owned });
}
if (signal) process.kill(process.pid, signal);
if (!process.exitCode) process.exitCode = exitCode;
