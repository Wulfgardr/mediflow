/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import { createPatientSmartImportHostCapability } from '../domain/documents/patient-smart-import-host-capability.ts';
import {
    AuthenticatedSmartImportPreviewError,
    createAuthenticatedSmartImportPreviewService,
} from './server-session-authenticated-smart-import-preview.ts';
import { clearAllSessions, createSession } from './server-session.ts';

const USER = { id: 'synthetic-preview-user', username: ['synthetic', 'preview-clinician'].join('-'), role: 'clinician' };
const REQUEST = { handle: `prj_${'1'.repeat(32)}`, requestId: 'request.synthetic.0001' };
const DENIED = Object.freeze({ writesPerformed: 0 as const, apply: 'denied' as const, status: 'denied' as const,
    code: 'input_invalid' as const, proposal: null, receipt: null, provenance: null, reviewRef: null });

afterEach(() => clearAllSessions());

function context(resolve: () => Readonly<{ consume(input: unknown): unknown }>) {
    const session = createSession(USER);
    return Object.freeze({ session, owner: { resolveProjectionService(value: unknown) {
        assert.equal(value, session); return resolve();
    } } as never });
}
function rejects(code: string) {
    return (error: unknown) => error instanceof AuthenticatedSmartImportPreviewError && error.code === code;
}
function blockedCapability(broker: Parameters<typeof createPatientSmartImportHostCapability>[0]['broker'], enabled: boolean) {
    return createPatientSmartImportHostCapability({
        killSwitch: { read: async () => enabled ? { status: 'enabled' as const } : { status: 'denied' as const, code: 'disabled' as const } },
        broker, lifecycle: {} as never, binding: {} as never, readiness: {} as never, route: (() => null) as never,
    });
}

test('acquires one context and returns the capability review-only result unchanged', async () => {
    let contexts = 0; let factories = 0; let resolved = 0; let consumed = 0;
    const current = context(() => { resolved += 1; return { consume: () => { consumed += 1; return {}; } }; });
    const service = createAuthenticatedSmartImportPreviewService({ acquireContext: async () => { contexts += 1; return current; },
        createCapability: (broker) => { factories += 1; return Object.freeze({ preview: async (input: unknown) => {
            assert.deepEqual(input, REQUEST); broker.consume({ ...REQUEST, capability: 'smart_import' }); return DENIED;
        } }); } });

    assert.equal(await service.preview(REQUEST), DENIED);
    assert.deepEqual({ contexts, factories, resolved, consumed }, { contexts: 1, factories: 1, resolved: 1, consumed: 1 });
});

test('fails with a fixed error before capability construction when no authenticated context exists', async () => {
    let factories = 0;
    const service = createAuthenticatedSmartImportPreviewService({ acquireContext: async () => null,
        createCapability: () => { factories += 1; return { preview: async () => DENIED }; } });

    await assert.rejects(() => service.preview(REQUEST), rejects('session_unavailable'));
    assert.equal(factories, 0);
});

test('keeps hostile input invalid after authentication and defers broker resolution behind the kill switch', async () => {
    let resolves = 0;
    const current = context(() => { resolves += 1; return { consume: () => ({}) }; });
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('synthetic raw marker'); } });
    const invalid = createAuthenticatedSmartImportPreviewService({ acquireContext: async () => current,
        createCapability: (broker) => createPatientSmartImportHostCapability({
            killSwitch: { read: async () => ({ status: 'enabled' as const }) }, broker,
            lifecycle: {} as never, binding: {} as never, readiness: {} as never, route: (() => null) as never,
        }) });
    const denied = createAuthenticatedSmartImportPreviewService({ acquireContext: async () => current,
        createCapability: (broker) => blockedCapability(broker, false) });

    assert.deepEqual(await invalid.preview(hostile), DENIED);
    assert.equal((await denied.preview(REQUEST)).code, 'kill_switch_disabled');
    assert.equal(resolves, 0);
});

test('maps owner consume failure to the existing projection-unavailable denial once', async () => {
    let resolves = 0; let consumes = 0;
    const current = context(() => { resolves += 1; return { consume: () => { consumes += 1; throw new Error('synthetic owner marker'); } }; });
    const service = createAuthenticatedSmartImportPreviewService({ acquireContext: async () => current,
        createCapability: (broker) => blockedCapability(broker, true) });

    const result = await service.preview(REQUEST);
    assert.deepEqual({ code: result.code, writesPerformed: result.writesPerformed, apply: result.apply },
        { code: 'projection_unavailable', writesPerformed: 0, apply: 'denied' });
    assert.deepEqual({ resolves, consumes }, { resolves: 1, consumes: 1 });
});

test('production wiring remains read-only and excludes route, apply, lifecycle control, and generic proxy paths', () => {
    const core = readFileSync(new URL('./server-session-authenticated-smart-import-preview.ts', import.meta.url), 'utf8');
    const production = readFileSync(new URL('./server-session-authenticated-smart-import-preview-production.ts', import.meta.url), 'utf8');

    assert.match(production, /createHostProviderLifecycleService\(\)\.service/u);
    assert.match(production, /observeClinical|routeHostResolvedCandidateCapability/u);
    assert.doesNotMatch(`${core}\n${production}`, /(?:\/api\/|fetch\(|proxy|\.control\b|\.apply\b)/u);
});
