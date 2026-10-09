/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectHeadlessPortableTests, runHeadlessPortableTests } from './run-headless-portable-tests.mjs';

async function selectionFixture(t) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mediflow-headless-selection-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const file of [
        'packages/aip/src/fixture.test.ts',
        'packages/mini/src/fixture.test.ts',
        'packages/mcp/src/fixture.test.ts',
        'scripts/check-headless-portable-imports.test.mjs',
        'scripts/intelligent-host-mcp-stdio.test.mjs',
        'scripts/mediflow-headless-supervisor-athena.test.mjs',
        'scripts/run-headless-portable-tests.test.mjs',
    ]) {
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), '');
    }
    return root;
}

async function assertSelectionFailure(root, expectedPath) {
    let launches = 0;
    const dataDir = path.join(root, 'must-not-be-created');
    const result = await runHeadlessPortableTests({
        root,
        parentEnv: { MEDIFLOW_DATA_DIR: dataDir },
        spawnSyncImpl: () => { launches += 1; return { status: 0, signal: null }; },
    });
    assert.equal(result.status, 1, 'a partial selection must fail');
    assert.equal(result.signal, null);
    assert.ok(result.error instanceof Error);
    assert.ok(result.error.message.includes(expectedPath), result.error.message);
    assert.equal(launches, 0, 'do not execute the surviving subset');
    assert.equal(existsSync(dataDir), false);
}

test('rejects each missing required package or script even when other tests remain', async (t) => {
    for (const missing of [
        'packages/aip', 'packages/mini', 'packages/mcp',
        'scripts/check-headless-portable-imports.test.mjs',
        'scripts/intelligent-host-mcp-stdio.test.mjs',
        'scripts/mediflow-headless-supervisor-athena.test.mjs',
        'scripts/run-headless-portable-tests.test.mjs',
    ]) {
        await t.test(missing, async (t) => {
            const root = await selectionFixture(t);
            await rm(path.join(root, missing), { recursive: true });
            await assertSelectionFailure(root, missing);
        });
    }
});

test('rejects a required package with no tests even when other packages have tests', async (t) => {
    const root = await selectionFixture(t);
    await rm(path.join(root, 'packages/mini/src/fixture.test.ts'));
    await assertSelectionFailure(root, 'packages/mini');
});

test('rejects a required script replaced by a directory', async (t) => {
    const root = await selectionFixture(t);
    const script = 'scripts/intelligent-host-mcp-stdio.test.mjs';
    await rm(path.join(root, script));
    await mkdir(path.join(root, script));
    await assertSelectionFailure(root, script);
});

test('reports a required package that cannot be read as a directory', async (t) => {
    const root = await selectionFixture(t);
    await rm(path.join(root, 'packages/aip'), { recursive: true });
    await writeFile(path.join(root, 'packages/aip'), 'synthetic non-directory');
    await assertSelectionFailure(root, 'packages/aip');
});

test('the CLI reports an incomplete selection without launching its surviving tests', async (t) => {
    const root = await selectionFixture(t);
    for (const file of ['run-headless-portable-tests.mjs', 'test-data-dir.mjs']) {
        await writeFile(path.join(root, 'scripts', file), await readFile(path.join(import.meta.dirname, file)));
    }
    await rm(path.join(root, 'scripts/check-headless-portable-imports.test.mjs'));
    const injection = `import childProcess from 'node:child_process';
        import { syncBuiltinESMExports } from 'node:module';
        childProcess.spawnSync = () => { process.stderr.write('UNEXPECTED_CHILD'); return { status: 0, signal: null }; };
        syncBuiltinESMExports();`;
    const result = spawnSync(process.execPath, [
        `--import=data:text/javascript,${encodeURIComponent(injection)}`,
        path.join(root, 'scripts/run-headless-portable-tests.mjs'),
    ], { encoding: 'utf8', env: { ...process.env, MEDIFLOW_DATA_DIR: path.join(root, 'data') }, timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /scripts\/check-headless-portable-imports\.test\.mjs/u);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_CHILD/u);
});

test('the CLI rejects an incomplete selection when invoked through a directory alias', async (t) => {
    const root = await selectionFixture(t);
    for (const file of ['run-headless-portable-tests.mjs', 'test-data-dir.mjs']) {
        await writeFile(path.join(root, 'scripts', file), await readFile(path.join(import.meta.dirname, file)));
    }
    await rm(path.join(root, 'scripts/check-headless-portable-imports.test.mjs'));
    const alias = path.join(root, 'cli-alias');
    await symlink(root, alias, 'junction');
    const result = spawnSync(process.execPath, [path.join(alias, 'scripts/run-headless-portable-tests.mjs')], {
        encoding: 'utf8',
        env: { ...process.env, MEDIFLOW_DATA_DIR: path.join(root, 'data') },
        timeout: 10000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /scripts\/check-headless-portable-imports\.test\.mjs/u);
    assert.equal(existsSync(path.join(root, 'data')), false);
});

test('preserves a failing child status for a complete selection', async (t) => {
    const root = await selectionFixture(t);
    const result = await runHeadlessPortableTests({
        root,
        parentEnv: {},
        spawnSyncImpl: () => ({ status: 23, signal: null }),
    });
    assert.equal(result.status, 23);
    assert.equal(result.error, null);
});

test('can be imported from stdin without treating the importing program as the CLI', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
        encoding: 'utf8',
        input: `import childProcess from 'node:child_process';
            import { syncBuiltinESMExports } from 'node:module';
            childProcess.spawnSync = () => { process.stderr.write('UNEXPECTED_CHILD'); return { status: 99, signal: null }; };
            syncBuiltinESMExports();
            await import(${JSON.stringify(new URL('./run-headless-portable-tests.mjs', import.meta.url).href)});
            console.log('IMPORTED');`,
        timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'IMPORTED');
    assert.doesNotMatch(result.stderr, /UNEXPECTED_CHILD/u);
});

test('collects only sorted AIP, Mini, MCP, stdio MCP and Supervisor composition tests', async () => {
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
    assert.equal(calls[0].options.env.MEDIFLOW_DATA_DIR.startsWith(path.join(realpathSync(os.tmpdir()), 'mediflow-headless-portable-')), true);
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

test('the CLI reports failure when its test process cannot start', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mediflow-headless-launch-failure-'));
    const injection = `import childProcess from 'node:child_process';
        import { syncBuiltinESMExports } from 'node:module';
        childProcess.spawnSync = () => ({ error: new Error('synthetic child launch failure') });
        syncBuiltinESMExports();`;
    try {
        const result = spawnSync(process.execPath, [
            `--import=data:text/javascript,${encodeURIComponent(injection)}`,
            path.join(import.meta.dirname, 'run-headless-portable-tests.mjs'),
        ], {
            encoding: 'utf8',
            env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
            timeout: 10000,
        });
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /synthetic child launch failure/u);
        assert.equal(existsSync(dataDir), true);
    } finally { await rm(dataDir, { recursive: true, force: true }); }
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
