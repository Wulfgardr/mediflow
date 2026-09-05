/* @Codex */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectHeadlessPortableTests } from './run-headless-portable-tests.mjs';

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
