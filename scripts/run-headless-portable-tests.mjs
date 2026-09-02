#!/usr/bin/env node
/* @Codex */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageRoots = ['packages/aip', 'packages/mini', 'packages/mcp'];
const scriptTests = [
    'scripts/check-headless-portable-imports.test.mjs',
    'scripts/intelligent-host-mcp-stdio.test.mjs',
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const tests = await collectHeadlessPortableTests();
    if (tests.length === 0) {
        process.stderr.write('No Headless portable tests found.\n');
        process.exitCode = 1;
    } else {
        const runner = path.join(repoRoot, 'scripts/run-strip-types.mjs');
        const result = spawnSync(process.execPath, [runner, '--test', ...tests], {
            cwd: repoRoot,
            env: { ...process.env, MEDIFLOW_STRIP_TYPES_NODE: process.execPath },
            stdio: 'inherit',
        });
        if (result.error) {
            process.stderr.write(`${result.error.message}\n`);
            process.exitCode = 1;
        } else process.exitCode = result.status ?? 1;
    }
}
