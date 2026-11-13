import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { attestLocalOllamaModel } from '../lib/ai-providers/ollama-locality';
import { runLocalProviderSetup } from './local-provider-setup';
import * as owner from '../lib/security/web-auth-lifecycle-owner-adapter';
import { createLocalProviderOnboardingService } from '../lib/ai-providers/fabric/local-provider-onboarding-service';
import { createHostProviderLifecycleService } from '../lib/ai-providers/fabric/provider-lifecycle-service';

// Real loopback HTTP, with all AbortSignal deadlines and server delays scaled
// equally: 32 simulated seconds take 640 ms, never half a minute of sleep.
const SCALE = 0.02;
const model = { model: 'synthetic:latest', size: 1024, digest: 'synthetic-digest' };
async function fixture(t: TestContext, options: {
    preloadMs?: number; broken?: 'disconnect' | 'digest' | 'remote'; cancel?: boolean;
} = {}) {
    const timeouts: number[] = [];
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    t.mock.method(AbortSignal, 'timeout', (ms: number) => {
        timeouts.push(ms); return timeout(Math.ceil(ms * SCALE));
    });
    const calls: string[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const server = createServer((req, res) => {
        const route = req.url!.split('/').at(-1)!;
        calls.push(route);
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const send = () => {
                if (route === 'generate') {
                    assert.deepEqual(JSON.parse(body), { model: model.model, keep_alive: '30m' });
                    if (options.broken === 'disconnect') { res.destroy(); return; }
                }
                const data = route === 'version' ? { version: '0.40.6' }
                    : route === 'show' ? { details: {} }
                        : route === 'generate' ? { model: model.model, ...(options.broken === 'remote' ? { remote_host: 'remote.invalid' } : {}) }
                            : { models: [{ ...model, ...(route === 'ps' && options.broken === 'digest' ? { digest: 'changed' } : {}) }] };
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data));
            };
            if (route === 'generate') timers.push(setTimeout(send, (options.preloadMs ?? 32_000) * SCALE));
            else send();
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        for (const timer of timers) clearTimeout(timer);
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    });
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const root = mkdtempSync(path.join(tmpdir(), 'mf-cold-start-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const db = new Database(path.join(root, 'medical.db'));
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO settings VALUES (?, ?)');
    insert.run('aiModel_clinical', 'synthetic');
    insert.run('aiUrl', url);
    db.close();
    return { calls, timeouts, root,
        web: async () => {
            const hostTimeouts: number[] = [];
            const setTimeout = globalThis.setTimeout;
            // Scale only the actual host activation timer, alongside the HTTP
            // preload and AbortSignal deadlines. No host constant is substituted.
            t.mock.method(globalThis, 'setTimeout', (callback: () => void, ms: number) => {
                if (ms === 60_000) hostTimeouts.push(ms);
                return setTimeout(callback, ms === 60_000 ? ms * SCALE : ms);
            });
            const control = owner.bootstrapControl()!;
            const attempt = owner.begin('login', { controlId: control.controlId, ifMatch: control.etag,
                idempotencyKey: `cold-${path.basename(root)}` })!;
            const issue = owner.issue(attempt, { id: 'synthetic-operator', username: path.basename(root), role: 'user' })!;
            const resolved = owner.resolve(issue.sessionId, control.controlId);
            assert.equal(resolved.status, 'active');
            if (resolved.status !== 'active') throw new Error('fixture failed');
            t.after(() => owner.retireForUser(resolved.projection));
            const service = createLocalProviderOnboardingService({ appDataDir: root,
                authenticate: async () => {
                    const current = owner.resolve(issue.sessionId, control.controlId);
                    return current.status === 'active' ? current.projection : null;
                },
                readSettings: () => ({ aiProvider: 'ollama', aiModel_clinical: 'synthetic', aiUrl: 'http://127.0.0.1:11434' }),
                immediate: operation => operation(),
                // Keep the host's allowlisted binding. Only the test transport
                // resolves to this fixture's ephemeral loopback HTTP listener.
                attest: (endpoint, requested, signal) => {
                    assert.equal(endpoint, 'http://127.0.0.1:11434');
                    return attestLocalOllamaModel(url, requested, signal);
                },
            });
            try { return await service.activate((await service.inspect()).revision); }
            finally { assert.deepEqual(hostTimeouts, [60_000]); }
        },
        direct: () => attestLocalOllamaModel(url, 'synthetic'),
        admit: () => runLocalProviderSetup({ action: 'admit', dataDir: root, confirmed: true }, async (endpoint, requested, signal) => {
            assert.equal(endpoint, url);
            if (options.cancel) {
                const controller = new AbortController();
                timers.push(setTimeout(() => controller.abort(), 10_000 * SCALE));
                signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
            }
            return attestLocalOllamaModel(endpoint, requested, signal);
        }),
    };
}

test('cold CLI activation admits after 32 simulated seconds with all five locality stages', async t => {
    const f = await fixture(t);
    const result = await f.admit();
    assert.equal(result.outcome, 'admitted');
    assert.equal(result.lifecycle, 'available_unqualified');
    assert.equal(result.inference, 'not_run');
    assert.deepEqual(f.calls, ['version', 'tags', 'show', 'generate', 'ps']);
});

test('only preload has a 60 s cap; the four metadata deadlines stay exactly 5 s', async t => {
    const f = await fixture(t);
    const result = await f.direct();
    assert.equal(result.digest, model.digest);
    assert.deepEqual(f.timeouts, [5_000, 5_000, 5_000, 60_000, 5_000]);
});

for (const [label, options] of [
    ['over the 60 s preload cap', { preloadMs: 61_000 }],
    ['transport interrupted', { broken: 'disconnect' as const }],
    ['caller cancelled', { cancel: true }],
    ['loaded digest changed', { broken: 'digest' as const }],
    ['remote preload response', { broken: 'remote' as const }],
] as const) test(`cold activation denies ${label} and never admits lifecycle`, async t => {
    const f = await fixture(t, options);
    await assert.rejects(f.admit(), /local_attestation_failed/);
    assert.deepEqual(createHostProviderLifecycleService({ appDataDir: f.root }).service.read(), { status: 'denied', reason: 'missing' });
    if ('broken' in options && options.broken === 'digest') assert.equal(f.calls.at(-1), 'ps');
    else { assert.equal(f.calls.at(-1), 'generate'); assert.equal(f.calls.includes('ps'), false); }
});

for (const lane of ['web', 'cli'] as const) {
    test(`${lane} admits a 50 s simulated cold preload without narrowing the Web host budget`, async t => {
        const f = await fixture(t, { preloadMs: 50_000 });
        const result = await (lane === 'web' ? f.web() : f.admit());
        assert.equal('state' in result ? result.state : result.lifecycle, 'available_unqualified');
        assert.deepEqual(f.calls, ['version', 'tags', 'show', 'generate', 'ps']);
    });
    test(`${lane} denies a cold preload beyond the 60 s cap without admitting lifecycle`, async t => {
        const f = await fixture(t, { preloadMs: 61_000 });
        await assert.rejects(lane === 'web' ? f.web() : f.admit());
        assert.equal(f.calls.includes('ps'), false);
        assert.deepEqual(createHostProviderLifecycleService({ appDataDir: f.root }).service.read(), { status: 'denied', reason: 'missing' });
    });
}
