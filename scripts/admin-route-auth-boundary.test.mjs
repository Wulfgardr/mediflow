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
    { file: 'app/api/system/cloud-provider-probe/route.ts', handlers: ['POST'] },
    { file: 'app/api/system/fix-orphans/route.ts', handlers: ['GET', 'POST'] },
    { file: 'app/api/system/purge-patient/route.ts', handlers: ['GET', 'POST'] },
    { file: 'app/api/system/repair-db/route.ts', handlers: ['POST'] },
    { file: 'app/api/system/restore-patient/route.ts', handlers: ['GET', 'POST'] },
];

/* @Codex */
const SESSION_REQUIRED_SYSTEM_ROUTES = [
    { file: 'app/api/system/update-awareness/route.ts', handlers: ['GET'] },
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

/* @Codex */
test('session-only system metadata routes require a web session before returning local details', () => {
    for (const route of SESSION_REQUIRED_SYSTEM_ROUTES) {
        const source = readSource(route.file);
        assert.match(source, /requireSession/, `${route.file} should read the cookie-backed session`);
        assert.doesNotMatch(source, /requireSessionOrLocalToken/, `${route.file} should not accept local API token fallback`);

        for (const handler of route.handlers) {
            const block = handlerSource(source, handler);
            assert.match(block, /requireSession\(\)/, `${route.file} ${handler} should use requireSession()`);
            assert.match(block, /unauthorizedResponse\(\)/, `${route.file} ${handler} should return the standard 401`);
        }
    }
});

/* @Codex */
test('system revision remains unauthenticated but exposes only launcher and drift-check fields without a session', () => {
    const source = readSource('app/api/system/revision/route.ts');
    const block = handlerSource(source, 'GET');

    assert.match(source, /requireSession/, 'revision route may read a cookie-backed session for optional detail fields');
    assert.doesNotMatch(source, /unauthorizedResponse/, 'revision route should not reject unauthenticated launcher and drift probes');
    assert.match(block, /revision:\s*getAppRevision\(\)/, 'revision route should expose launcher revision');
    assert.match(block, /sourceFingerprint:\s*getAppSourceFingerprint\(\)/, 'revision route should expose launcher source fingerprint');
    assert.match(block, /fingerprint:\s*getAppFingerprint\(\)/, 'revision route should expose UI drift fingerprint');

    const unauthenticatedPayload = block.slice(block.indexOf('{'), block.indexOf('...(session'));
    assert.doesNotMatch(unauthenticatedPayload, /branch:\s*getAppBranch\(\)/, 'revision route should not expose branch without a session');
    assert.doesNotMatch(unauthenticatedPayload, /worktreeHash:\s*getAppWorktreeHash\(\)/, 'revision route should not expose worktree hash without a session');
    assert.match(block, /session\s*\?\s*{[\s\S]*branch:\s*getAppBranch\(\)[\s\S]*worktreeHash:\s*getAppWorktreeHash\(\)/, 'revision route should keep detail fields session-only');
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
