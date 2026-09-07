/* @Codex */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectHeadlessPortableTests, runHeadlessPortableTests } from './run-headless-portable-tests.mjs';

test('collects only sorted AIP, Mini, optional MCP, stdio MCP and Supervisor composition tests', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mediflow-headless-tests-'));
    try {
        for (const directory of ['packages/aip/src', 'packages/mini/src', 'packages/mcp/src', 'scripts', 'lib']) {
            await mkdir(path.join(root, directory), { recursive: true });
        }
        for (const file of [
            'packages/aip/src/z.test.ts', 'packages/aip/src/not-a-test.ts',
            'packages/mini/src/a.test.ts', 'packages/mcp/src/server.test.mts',
            'scripts/check-headless-portable-imports.test.mjs',
            'scripts/intelligent-host-mcp-stdio.test.mjs',
            'scripts/mediflow-headless-supervisor-athena.test.mjs',
            'scripts/run-headless-portable-tests.test.mjs', 'lib/forbidden.test.ts',
        ]) await writeFile(path.join(root, file), '');
        assert.deepEqual(await collectHeadlessPortableTests(root), [
            'packages/aip/src/z.test.ts',
            'packages/mcp/src/server.test.mts',
            'packages/mini/src/a.test.ts',
            'scripts/check-headless-portable-imports.test.mjs',
            'scripts/intelligent-host-mcp-stdio.test.mjs',
            'scripts/mediflow-headless-supervisor-athena.test.mjs',
            'scripts/run-headless-portable-tests.test.mjs',
        ]);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('launches the child with an absolute Node path and an owned synthetic data-dir', async () => {
    const calls = [];
    const result = await runHeadlessPortableTests({
        parentEnv: { ...process.env, MEDIFLOW_DATA_DIR: '   ' },
        spawnSyncImpl: (command, args, options) => {
            calls.push({ command, args, options });
            assert.ok(existsSync(options.env.MEDIFLOW_DATA_DIR));
            return { status: 0, signal: null };
        },
    });

    assert.equal(result.status, 0);
    assert.equal(result.signal, null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.equal(path.isAbsolute(calls[0].command), true);
    assert.equal(calls[0].options.env.MEDIFLOW_STRIP_TYPES_NODE, process.execPath);
    assert.equal(calls[0].options.env.MEDIFLOW_DATA_DIR.startsWith(path.join(os.tmpdir(), 'mediflow-headless-portable-')), true);
    assert.equal(existsSync(calls[0].options.env.MEDIFLOW_DATA_DIR), false);
    assert.equal(calls[0].args[1], '--test');
});

test('preserves an explicit caller-owned data-dir and leaves its cleanup to the caller', async () => {
    const explicit = await mkdtemp(path.join(os.tmpdir(), 'mediflow-headless-explicit-'));
    let observed;
    try {
        const result = await runHeadlessPortableTests({
            parentEnv: { ...process.env, MEDIFLOW_DATA_DIR: explicit },
            spawnSyncImpl: (_command, _args, options) => {
                observed = options.env.MEDIFLOW_DATA_DIR;
                return { status: 0, signal: null };
            },
        });
        assert.equal(result.status, 0);
        assert.equal(observed, explicit);
        assert.equal(existsSync(explicit), true);
    } finally { await rm(explicit, { recursive: true, force: true }); }
});

test('keeps the direct CI caller and npm entrypoint wired to explicit test fixtures', async () => {
    const [coreWorkflow, crossPlatformWorkflow, webCoreWorkflow, packageJson] = await Promise.all([
        readFile(path.join(path.dirname(path.dirname(import.meta.filename)), '.github/workflows/core-tri-os.yml'), 'utf8'),
        readFile(path.join(path.dirname(path.dirname(import.meta.filename)), '.github/workflows/cross-platform.yml'), 'utf8'),
        readFile(path.join(path.dirname(path.dirname(import.meta.filename)), '.github/workflows/web-core.yml'), 'utf8'),
        readFile(path.join(path.dirname(path.dirname(import.meta.filename)), 'package.json'), 'utf8'),
    ]);
    const manifest = JSON.parse(packageJson);

    assert.equal(manifest.scripts['test:headless-portable'], 'node scripts/run-headless-portable-tests.mjs');
    assert.match(coreWorkflow, /data_dir="\$\(mktemp -d "\$\{RUNNER_TEMP\}\/mediflow-h4-golden\.XXXXXX"\)"/u);
    assert.match(coreWorkflow, /export MEDIFLOW_DATA_DIR="\$\{data_dir\}"/u);
    assert.match(coreWorkflow, /trap cleanup EXIT/u);
    assert.match(coreWorkflow, /NODE_BIN="\$\(command -v node\)"/u);
    assert.match(coreWorkflow, /"\$\{NODE_BIN\}" scripts\/run-strip-types\.mjs --test/u);
    assert.match(coreWorkflow, /rm -rf -- "\$\{data_dir\}"/u);
    assert.match(crossPlatformWorkflow, /node-version: 24/u);
    assert.match(crossPlatformWorkflow, /npm run test:headless-portable/u);
    assert.match(webCoreWorkflow, /DATA_DIR="\$\(mktemp -d "\$\{RUNNER_TEMP\}\/mediflow-web-core\.XXXXXX"\)"/u);
    assert.match(webCoreWorkflow, /MEDIFLOW_DATA_DIR=/u);
    assert.match(webCoreWorkflow, /MEDIFLOW_WEB_CORE_DATA_DIR/u);
    assert.match(webCoreWorkflow, /rm -rf -- "\$\{MEDIFLOW_WEB_CORE_DATA_DIR\}"/u);
});
