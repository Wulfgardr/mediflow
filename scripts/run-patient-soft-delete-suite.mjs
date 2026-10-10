#!/usr/bin/env node
import { SOFT_DELETE_ROUTE_FILES } from './additional-test-selection.mjs';
import { SOFT_DELETE_TS_FILES } from './additional-test-selection.mjs';
/* @Codex: run the existing soft-delete tests with the canonical TypeScript loader and an isolated data root. */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireTestDataDir, cleanupTestDataDir } from './test-data-dir.mjs';

const root = path.resolve(import.meta.dirname, '..');
const node = process.execPath;
const typeScriptTests = SOFT_DELETE_TS_FILES;
const routeWiringTests = SOFT_DELETE_ROUTE_FILES;

function run(args, env) {
    const result = spawnSync(node, args, { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    return { signal: result.signal, status: result.status ?? 1 };
}

const { dataDir, owned } = acquireTestDataDir(process.env, 'mediflow-patient-soft-delete-');
const env = { ...process.env, MEDIFLOW_DATA_DIR: dataDir };
let exitCode = 1;
let signal = null;
try {
    const typeScript = run(['scripts/run-strip-types.mjs', '--test', ...typeScriptTests], env);
    signal = typeScript.signal;
    if (!signal && typeScript.status !== 0) exitCode = typeScript.status;
    else if (!signal) {
        const routeWiring = run(['--test', ...routeWiringTests], env);
        signal = routeWiring.signal;
        exitCode = routeWiring.status;
    }
} finally {
    cleanupTestDataDir({ dataDir, owned });
}
if (signal) process.kill(process.pid, signal);
if (!process.exitCode) process.exitCode = exitCode;
