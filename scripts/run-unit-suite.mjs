#!/usr/bin/env node
/* @Codex */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireTestDataDir, cleanupTestDataDir } from './test-data-dir.mjs';

const root = path.resolve(import.meta.dirname, '..');
const node = process.execPath;
const unitArgs = ['scripts/run-strip-types.mjs', '--test', '--glob', 'lib/**/*.test.ts', '--glob', 'components/**/*.test.ts', 'scripts/admin-route-auth-boundary.test.mjs', 'scripts/check-never-regress-icd-who.test.mjs', 'scripts/inventory-first-party-code.test.mjs', 'scripts/test-data-dir.test.mjs', 'scripts/check-schema-drift.test.ts', 'scripts/run-native-probe.test.mjs', 'scripts/audit-quality-gate.test.mjs', 'scripts/audit-test-config.test.mjs', 'scripts/prosthetic-audit-guard.test.mjs', 'scripts/service-audit-guard.test.mjs', 'scripts/ambulatory-audit-guard.test.mjs', 'scripts/prepare-e2e-db.test.mjs', 'scripts/db-server-data-isolation.test.mjs', 'scripts/native-first-install.test.mjs', 'scripts/native-network-bounded-json.test.mjs', 'scripts/native-network-attachment-budget.test.mjs', 'scripts/checkup-parent-lifecycle.test.mjs', 'scripts/checkup-parent-lifecycle-harness.test.mjs', 'scripts/anydoc-consumer-diagnostic.test.mjs', 'scripts/run-unit-suite.test.mjs', 'scripts/run-strip-types.test.mjs', 'scripts/check-motion-budget.test.mjs'];

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
    const unit = run(unitArgs, env);
    signal = unit.signal;
    exitCode = unit.status;
  }
} finally {
  cleanupTestDataDir({ dataDir, owned });
}
if (signal) process.kill(process.pid, signal);
if (!process.exitCode) process.exitCode = exitCode;
