#!/usr/bin/env node
/* @Codex */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireTestDataDir, cleanupTestDataDir } from './test-data-dir.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageRoots = ['packages/aip', 'packages/mini', 'packages/mcp'];
const scriptTests = [
    'scripts/check-headless-portable-imports.test.mjs',
    'scripts/intelligent-host-mcp-stdio.test.mjs',
    'scripts/mediflow-headless-supervisor-athena.test.mjs',
    'scripts/run-headless-portable-tests.test.mjs',
];

async function collect(root, current, output) {
    let entries;
    try { entries = await readdir(path.join(root, current), { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const relative = path.posix.join(current.replaceAll('\\', '/'), entry.name);
        if (entry.isDirectory()) await collect(root, relative, output);
        else if (entry.isFile() && /\.test\.(?:[cm]?[jt]s|tsx)$/u.test(entry.name)) output.push(relative);
    }
}

export async function collectHeadlessPortableTests(root = repoRoot) {
    const tests = [];
    for (const directory of packageRoots) await collect(root, directory, tests);
    for (const file of scriptTests) {
        try {
            const entries = await readdir(path.dirname(path.join(root, file)));
            if (entries.includes(path.basename(file))) tests.push(file);
        } catch { /* Required count check below. */ }
    }
    return [...new Set(tests)].sort();
}

export async function runHeadlessPortableTests({
    root = repoRoot,
    parentEnv = process.env,
    spawnSyncImpl = spawnSync,
} = {}) {
    const tests = await collectHeadlessPortableTests(root);
    if (tests.length === 0) return { status: 1, signal: null, error: null, empty: true };

    const runner = path.join(root, 'scripts/run-strip-types.mjs');
    const { dataDir, owned } = acquireTestDataDir(parentEnv, 'mediflow-headless-portable-');
    let result;
    try {
        result = spawnSyncImpl(process.execPath, [runner, '--test', '--test-concurrency=1', ...tests], {
            cwd: root,
            env: { ...parentEnv, MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_STRIP_TYPES_NODE: process.execPath },
            stdio: 'inherit',
        });
    } finally {
        cleanupTestDataDir({ dataDir, owned });
    }

    if (result.error) return { status: 1, signal: null, error: result.error };
    return { status: result.status ?? 1, signal: result.signal ?? null, error: null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = await runHeadlessPortableTests();
    if (result.empty) {
        process.stderr.write('No Headless portable tests found.\n');
        process.exitCode = result.status;
    }
    else if (result.error) process.stderr.write(`${result.error.message}\n`);
    else if (result.signal) process.kill(process.pid, result.signal);
    else process.exitCode = result.status;
}
