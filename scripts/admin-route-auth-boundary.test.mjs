#!/usr/bin/env node
/* @Codex */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

test('backup restore rejects cross-port and text/plain transport before preflight, fence, or database mutation', () => {
    const routeUrl = pathToFileURL(path.join(ROOT, 'app/api/system/backup-restore/route.ts')).href;
    const transportUrl = pathToFileURL(path.join(ROOT, 'lib/security/request-transport.ts')).href;
    const toDataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
    const program = `
        import { registerHooks } from 'node:module';
        const routeUrl = ${JSON.stringify(routeUrl)};
        const modules = new Map([
            ['next/server', ${JSON.stringify(toDataModule("export const NextResponse = Response;"))}],
            ['@/lib/db-server', ${JSON.stringify(toDataModule("export const dbServer = { transaction() { globalThis.dbCalls = (globalThis.dbCalls ?? 0) + 1; throw new Error('database touched'); } };"))}],
            ['@/lib/schema', ${JSON.stringify(toDataModule(`export const ${[
                'attachments', 'ambulatories', 'checkups', 'conversations', 'documentDiagnosisProposals',
                'durableReviewOperations', 'durableReviewPatientLinks', 'durableReviewRecords', 'drugs', 'entries',
                'exemptions', 'headlessSoapActiveRoleAttestations', 'headlessSoapEntryCommits', 'messages',
                'observations', 'patients', 'patientsToAmbulatories', 'physicianReviewAttestations',
                'prostheticPrescriptions', 'serviceCatalogEntries', 'servicePrescriptionItems',
                'servicePrescriptions', 'sissHandoffEvents', 'therapies',
            ].map((name) => `${name} = Object.freeze({})`).join(', ')};`))}],
            ['@/lib/security/server-auth', ${JSON.stringify(toDataModule("export async function requireSession() { globalThis.sessionCalls = (globalThis.sessionCalls ?? 0) + 1; return Object.freeze({ id: 'session.synthetic.restore', userId: 'user.synthetic.restore', role: 'admin' }); } export function unauthorizedResponse() { return new Response(null, { status: 401 }); } export function forbiddenResponse() { return new Response(null, { status: 403 }); }"))}],
            ['@/lib/security/server-auth-policy', ${JSON.stringify(toDataModule("export function isWebAdminSession() { globalThis.adminCalls = (globalThis.adminCalls ?? 0) + 1; return true; }"))}],
            ['@/lib/backup-artifact', ${JSON.stringify(toDataModule("export const BACKUP_COLLECTIONS = Object.freeze([]); export async function serializeBackupArtifact() { return '{}'; }"))}],
            ['@/lib/backup-patient-ambulatory-links', ${JSON.stringify(toDataModule("export function enrichBackupPatientsWithAmbulatoryLinks(rows) { return rows; }"))}],
            ['@/lib/backup-restore-preflight', ${JSON.stringify(toDataModule("export async function runBackupRestorePreflight() { globalThis.preflightCalls = (globalThis.preflightCalls ?? 0) + 1; return { artifact: { format: 'mediflow-backup', version: 1, manifest: { recordCounts: {} } }, result: { ok: true } }; }"))}],
            ['@/lib/backup-restore-executor', ${JSON.stringify(toDataModule("export function restoreBackupArtifact(_artifact, fence) { globalThis.restoreCalls = (globalThis.restoreCalls ?? 0) + 1; fence(); }"))}],
            ['@/lib/api-error-response', ${JSON.stringify(toDataModule("export function apiFailure(code, error, status) { const response = Response.json({ error, code }, { status }); response.headers.set('Cache-Control', 'no-store'); return response; } export function apiInternalError() { return Response.json({ error: 'internal' }, { status: 500 }); }"))}],
            ['@/lib/security/headless-checkup-status-transition-web-production', ${JSON.stringify(toDataModule("export function disposeCheckupStatusTransitionForHostV1() { globalThis.fenceCalls = (globalThis.fenceCalls ?? 0) + 1; return true; }"))}],
            ['@/lib/security/request-transport', ${JSON.stringify(toDataModule(`export { isTrustedWebMutationRequest } from ${JSON.stringify(transportUrl)};`))}],
        ]);
        registerHooks({ resolve(specifier, context, nextResolve) {
            if (context.parentURL === routeUrl && modules.has(specifier)) {
                return { shortCircuit: true, url: modules.get(specifier), format: 'module' };
            }
            return nextResolve(specifier, context);
        } });
        const { POST } = await import(routeUrl);
        const cases = [
            { origin: 'http://127.0.0.1:4000', 'sec-fetch-site': 'same-site', 'content-type': 'application/json' },
            { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
        ];
        for (const headers of cases) {
            const response = await POST(new Request('http://127.0.0.1:3000/api/system/backup-restore', {
                method: 'POST', headers, body: '{}',
            }));
            const observed = { status: response.status, cacheControl: response.headers.get('cache-control'),
                body: await response.json() };
            const expected = { status: 403, cacheControl: 'no-store', body: {
                error: 'Ripristino backup non disponibile.', code: 'request_transport_invalid',
            } };
            if (JSON.stringify(observed) !== JSON.stringify(expected)) throw new Error(JSON.stringify(observed));
        }
        const counters = { sessionCalls: globalThis.sessionCalls ?? 0, adminCalls: globalThis.adminCalls ?? 0,
            preflightCalls: globalThis.preflightCalls ?? 0, restoreCalls: globalThis.restoreCalls ?? 0,
            fenceCalls: globalThis.fenceCalls ?? 0, dbCalls: globalThis.dbCalls ?? 0 };
        const expectedCounters = { sessionCalls: 2, adminCalls: 2, preflightCalls: 0,
            restoreCalls: 0, fenceCalls: 0, dbCalls: 0 };
        if (JSON.stringify(counters) !== JSON.stringify(expectedCounters)) throw new Error(JSON.stringify(counters));
    `;
    const child = spawnSync(process.execPath, [
        '--experimental-strip-types', '--input-type=module', '--eval', program,
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr || child.stdout);
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
