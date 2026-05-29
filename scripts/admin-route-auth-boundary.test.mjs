#!/usr/bin/env node
/* @Codex */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WEB_ADMIN_ROUTES = [
    { file: 'app/api/system/audit/route.ts', handlers: ['GET'] },
    { file: 'app/api/system/backup-restore/route.ts', handlers: ['GET', 'POST'] },
    { file: 'app/api/system/backup-scheduler/route.ts', handlers: ['GET', 'POST'] },
    { file: 'app/api/system/repair-db/route.ts', handlers: ['POST'] },
];

function readSource(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function handlerSource(source, handlerName) {
    const start = source.indexOf(`export async function ${handlerName}`);
    assert.notEqual(start, -1, `Expected ${handlerName} handler`);
    const next = source.indexOf('\nexport async function ', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
}

test('admin system routes require a web admin session instead of local-token admin inheritance', () => {
    for (const route of WEB_ADMIN_ROUTES) {
        const source = readSource(route.file);
        assert.match(source, /requireSession/, `${route.file} should read the cookie-backed session`);
        assert.match(source, /isWebAdminSession/, `${route.file} should enforce the web-admin policy`);
        assert.doesNotMatch(source, /requireSessionOrLocalToken/, `${route.file} should not accept local API token fallback`);

        for (const handler of route.handlers) {
            const block = handlerSource(source, handler);
            assert.match(block, /requireSession\(\)/, `${route.file} ${handler} should use requireSession()`);
            assert.match(block, /isWebAdminSession\(session\)/, `${route.file} ${handler} should check web admin`);
            assert.doesNotMatch(block, /session\.role\s*!==\s*['"]admin['"]/, `${route.file} ${handler} should not use role-only admin checks`);
        }
    }
});

test('MLX keeps token-backed status reads but requires web admin for lifecycle writes', () => {
    const source = readSource('app/api/system/mlx/route.ts');
    const getBlock = handlerSource(source, 'GET');
    const postBlock = handlerSource(source, 'POST');
    const deleteBlock = handlerSource(source, 'DELETE');

    assert.match(getBlock, /requireSessionOrLocalToken\(request\)/, 'MLX status should remain available to paired local surfaces');

    for (const [method, block] of [['POST', postBlock], ['DELETE', deleteBlock]]) {
        assert.match(block, /requireSession\(\)/, `MLX ${method} should use requireSession()`);
        assert.match(block, /isWebAdminSession\(session\)/, `MLX ${method} should check web admin`);
        assert.doesNotMatch(block, /requireSessionOrLocalToken/, `MLX ${method} should not accept local API token fallback`);
    }
});
