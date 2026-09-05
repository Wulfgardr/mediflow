/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mediflow-web-lifecycle-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
    env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});
const { completePortableSupervisorWebLifecycleMutationV1 } = await import(
    './portable-supervisor-web-lifecycle.ts'
);

after(() => rmSync(dataDir, { recursive: true, force: true }));

function response(status: number): Response {
    return new Response(status === 204 ? null : '{}', {
        status,
        headers: { 'Cache-Control': 'no-store' },
    });
}

test('awaits retirement after each successful canonical mutation and preserves its response', async () => {
    for (const [reason, status, retirement] of [
        ['logout', 204, true],
        ['application_lock', 200, true],
        ['reselection', 200, false],
    ] as const) {
        const order: string[] = [];
        const original = response(status);
        const result = await completePortableSupervisorWebLifecycleMutationV1(
            Promise.resolve().then(() => { order.push('mutation'); return original; }),
            reason,
            { retire: async (received) => { order.push(`retire:${received}`); return retirement; } },
        );
        assert.equal(result, original);
        assert.deepEqual(order, ['mutation', `retire:${reason}`]);
    }
});

test('does not retire after a denied or conflicting canonical mutation', async () => {
    for (const [reason, status] of [
        ['logout', 401],
        ['application_lock', 409],
        ['reselection', 409],
    ] as const) {
        let retirements = 0;
        const original = response(status);
        const result = await completePortableSupervisorWebLifecycleMutationV1(
            Promise.resolve(original), reason,
            { retire: async () => { retirements += 1; return true; } },
        );
        assert.equal(result, original);
        assert.equal(retirements, 0);
    }
});

test('returns a detail-free 503 after a retirement throw, rejection, or invalid result', async () => {
    const sources = [
        { retire: () => { throw new Error('synthetic patient detail'); } },
        { retire: async () => { throw new Error('synthetic patient detail'); } },
        { retire: () => true as never },
        { retire: async () => 'yes' as never },
    ];
    for (const source of sources) {
        const result = await completePortableSupervisorWebLifecycleMutationV1(
            Promise.resolve(response(204)), 'logout', source,
        );
        assert.equal(result.status, 503);
        assert.equal(result.headers.get('Cache-Control'), 'no-store');
        assert.deepEqual(await result.json(), {
            error: 'Host intelligente non disponibile.', code: 'host_unavailable',
        });
    }
});

test('routes wrap only the successful canonical POST mutation', () => {
    const logout = readFileSync(new URL('../../app/api/auth/logout/route.ts', import.meta.url), 'utf8');
    const lock = readFileSync(new URL('../../app/api/auth/lock/route.ts', import.meta.url), 'utf8');
    const selection = readFileSync(new URL('../../app/api/ai/smart-import/selection/route.ts', import.meta.url), 'utf8');
    for (const source of [logout, lock, selection]) {
        assert.match(source, /completePortableSupervisorWebLifecycleMutationV1/u);
    }
    assert.match(logout, /completeExactWebP3Logout[\s\S]*'logout'/u);
    assert.match(lock, /completeExactWebP3ApplicationLock[\s\S]*'application_lock'/u);
    assert.match(selection, /selectCurrent[\s\S]*'reselection'/u);
    assert.match(selection, /export const GET = createSmartImportSelectionEpochHttpHandler/u);
});
