import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runHeadlessPortableImportGuard, validateHeadlessPortableSource } from './check-headless-portable-imports.mjs';

async function profileSurfaces(root) {
    for (const file of [
        'packages/patient-profile-contracts/src/query.ts',
        'app/api/patients/[id]/route.ts', 'app/api/v1/patients/[id]/route.ts',
        'app/api/v1/network/patients/[id]/route.ts', 'app/api/patients/[id]/notes-commit/route.ts',
        'app/api/patients/[id]/profile-query/route.ts',
        'app/api/v1/network/patients/[id]/profile-query/route.ts',
        'app/api/patient-profile/review/route.ts', 'app/api/patient-profile/selection-epoch/route.ts',
        'app/api/v1/network/patient-profile/selection-epoch/route.ts',
    ]) {
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), 'export const version = 1;');
    }
}

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
        await profileSurfaces(root);
    }
    try {
        await reset();
        assert.deepEqual(await runHeadlessPortableImportGuard(root), { files: 14, surfaces: 14 });

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

test('scans the complete profile package graph and denies framework, OS and browser dependencies', async () => {
    assert.deepEqual(validateHeadlessPortableSource("import '../../patient-profile-contracts/src/query.ts';", 'packages/aip/src/profile.ts'), []);
    assert.notDeepEqual(validateHeadlessPortableSource("import '../../../lib/patient-profile-service.ts';", 'packages/aip/src/profile.ts'), []);
    const root = await mkdtemp(path.join(os.tmpdir(), 'mediflow-profile-package-'));
    try {
        for (const p of ['packages/aip/src', 'packages/mini/src', 'scripts', 'lib']) await mkdir(path.join(root, p), { recursive: true });
        await writeFile(path.join(root, 'scripts/intelligent-host-mcp-stdio.mjs'), '');
        await profileSurfaces(root);
        const entry = path.join(root, 'packages/patient-profile-contracts/src/query.ts');
        const target = path.join(root, 'packages/patient-profile-contracts/src/helper.ts');
        await writeFile(entry, "export * from './helper.ts';");
        await writeFile(target, 'export const version = 1;');
        await runHeadlessPortableImportGuard(root);
        for (const source of ["import 'server-only';", "import 'next/navigation';", "import 'node:fs';",
            "export type Shape = import('next').NextConfig;", "export type Host = typeof import('../../../lib/db-server');",
            '/// <reference types="react" />', '/// <reference path="../../../lib/db-server.ts" />', '/// <reference lib="dom" />',
            "import Database from 'better-sqlite3';", "export * from '../../../aip/src/helper.ts';",
            "import '../../../native/Keychain.ts';", "await import('mlx');", "require('node:os');",
            'const platform = process.platform;', 'const page = document.body;']) {
            await writeFile(target, source);
            await assert.rejects(runHeadlessPortableImportGuard(root), /pure profile package/u, source);
        }
        await rm(path.join(root, 'packages/patient-profile-contracts/src'), { recursive: true });
        await assert.rejects(runHeadlessPortableImportGuard(root), /required surface is missing/u);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('profile HTTP routes delegate DB and schema access while retaining their Web adapters', () => {
    const route = 'app/api/patients/[id]/notes-commit/route.ts';
    assert.deepEqual(validateHeadlessPortableSource("import { NextResponse } from 'next/server'; import { commit } from '@/lib/patient-profile-service';", route), []);
    for (const source of ["import { dbServer } from '@/lib/db-server';", "export { patients } from '@/lib/schema';",
        "import Database from 'better-sqlite3';", "await import('drizzle-orm');", "import 'node:sqlite';",
        "import '../../../../../lib/schema.ts';"]) {
        assert.notDeepEqual(validateHeadlessPortableSource(source, route), [], source);
    }
});
