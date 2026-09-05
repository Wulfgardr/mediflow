/* @Codex */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runHeadlessPortableImportGuard, validateHeadlessPortableSource } from './check-headless-portable-imports.mjs';

test('accepts only portable package and stdio dependencies', () => {
    const source = `
        import { types } from 'node:util';
        import { spawn } from 'node:child_process';
        import { McpServer } from '@modelcontextprotocol/server';
        import { local } from './operation-rpc.ts';
        void [types, spawn, McpServer, local];
    `;
    assert.deepEqual(validateHeadlessPortableSource(source, 'packages/aip/src/portable.ts'), []);
});

test('denies database, Web, native and network imports across static and dynamic forms', () => {
    const forbidden = [
        "import { dbServer } from '../../../lib/db-server';",
        "export { patients } from '@/lib/schema';",
        "import 'server-only';",
        "import { cookies } from 'next/headers';",
        "import Database from 'better-sqlite3';",
        "import { eq } from 'drizzle-orm';",
        "import '../../../native/MediFlowMac/Package.swift';",
        "import 'node:net';",
        "await import('node:https');",
        "require('node:tls');",
        "const target = 'node:http'; await import(target);",
        "process.getBuiltinModule('node:net');",
        "const require = createRequire(import.meta.url); require('node:https');",
        "eval(\"import('node:net')\");",
        "new Function(\"return fetch('https://example.invalid')\");",
        "await fetch('https://example.invalid');",
        "new WebSocket('wss://example.invalid');",
    ];
    for (const source of forbidden) {
        assert.notDeepEqual(validateHeadlessPortableSource(source, 'packages/mcp/src/server.ts'), [], source);
    }
});

test('scans all mandatory surfaces, optional MCP package and rejects symlink escapes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mediflow-headless-imports-'));
    async function reset() {
        await rm(root, { recursive: true, force: true });
        await mkdir(path.join(root, 'packages/aip/src'), { recursive: true });
        await mkdir(path.join(root, 'packages/mini/src'), { recursive: true });
        await mkdir(path.join(root, 'packages/mcp/src'), { recursive: true });
        await mkdir(path.join(root, 'scripts'), { recursive: true });
        await writeFile(path.join(root, 'packages/aip/src/core.ts'), "import { types } from 'node:util'; void types;\n");
        await writeFile(path.join(root, 'packages/mini/src/cli.ts'), "import { stdin } from 'node:process'; void stdin;\n");
        await writeFile(path.join(root, 'packages/mcp/src/server.ts'), "import { core } from '../../aip/src/core.ts'; void core;\n");
        await writeFile(path.join(root, 'scripts/intelligent-host-mcp-stdio.mjs'), "import '../packages/mcp/src/server.ts';\n");
    }
    try {
        await reset();
        assert.deepEqual(await runHeadlessPortableImportGuard(root), { files: 4, surfaces: 4 });

        await writeFile(path.join(root, 'packages/mcp/src/server.ts'), "import '../../../lib/db-server.ts';\n");
        await assert.rejects(runHeadlessPortableImportGuard(root), /database or Web boundary import/u);

        await reset();
        const outside = path.join(path.dirname(root), 'mediflow-headless-escape');
        await mkdir(outside);
        await writeFile(path.join(outside, 'cli.ts'), "import 'node:util';\n");
        await rm(path.join(root, 'packages/mini/src'), { recursive: true, force: true });
        await symlink(outside, path.join(root, 'packages/mini/src'), 'junction');
        await assert.rejects(runHeadlessPortableImportGuard(root), /symlink/u);
        await rm(outside, { recursive: true, force: true });
    } finally { await rm(root, { recursive: true, force: true }); }
});
