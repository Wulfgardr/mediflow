/* @Codex: WUL-673. Synthetic authority/transport; real canonical runtime and parsers. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { createIcd11WhoNetworkRoute, type WhoNetworkOperation } from './icd11-who-network-route';
import { createIcd11WhoLocalRuntime } from './icd11-who-local-runtime';
import { ICD11_WHO_BINDING, Icd11WhoServiceError } from './icd11-who-service';
import { parseWhoLocalSearchResponse, WHO_LOCAL_BINDING_ID } from './icd11-who-local-contract';
import { parseWhoCodeCheckResult, whoCodeInfoReference } from './icd11-who-code-check-contract';

type Dependencies = Parameters<typeof createIcd11WhoNetworkRoute>[1];
type Resolution = Awaited<ReturnType<Dependencies['resolveContext']>>;
type Context = Extract<Resolution, { ok: true }>['context'];
const URI = 'http://id.who.int/icd/release/11/2026-01/mms/1000000001';
const environment = {
    MEDIFLOW_ICD_WHO_ENABLED: '1', MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}`,
    MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID: `sha256:${'b'.repeat(64)}`,
} as Record<string, string>;
const entity = { theCode: 'AA00', title: 'Synthetic term', id: URI };
const upstream = (entities: unknown[] = [entity], partial = false) => ({ status: 200, body: JSON.stringify({
    error: false, resultChopped: partial, destinationEntities: entities,
}) });
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
function fixture(options: { entities?: unknown[]; partial?: boolean; found?: boolean } = {}) {
    const session = { id: 'synthetic-session', userId: 'synthetic-user', username: 'synthetic', role: 'user', authChannel: 'native' };
    let context = {
        session, pairedClient: { clientId: 'synthetic-client', tokenHash: 'synthetic-token-hash',
            clientPlatform: 'macos', grantedCapabilities: ['network.catalogs.readonly'] },
        scopeAmbulatoryId: 'synthetic-amb-a',
    } as unknown as Context;
    let currentSession: unknown = session;
    let rejection: number | null = null;
    let resolutions = 0, runtimeAdmissions = 0;
    const calls: string[] = [], audits: unknown[] = [], checks: string[] = [];
    let transportHook: (() => Promise<ReturnType<typeof upstream>>) | undefined;
    let resolveHook: (() => Promise<void>) | undefined;
    let auditHook: (() => Promise<void>) | undefined;
    let now = Date.parse('2026-09-12T10:00:00.000Z');
    const runtime = createIcd11WhoLocalRuntime({
        readEnvironment: key => environment[key], now: () => now,
        async transport(query) { calls.push(query); return transportHook ? transportHook() : upstream(options.entities, options.partial); },
        async audit(receipt) { audits.push(receipt); await auditHook?.(); },
        async codeCheckTransport(code) { checks.push(code); return options.found === false ? null : {
            canonicalUri: whoCodeInfoReference(code), stemUri: URI, stemCode: code.split(/[&/]/u)[0], stemTitle: 'Synthetic stem',
        }; },
        async auditCodeCheck(receipt) { audits.push(receipt); await auditHook?.(); },
    });
    const dependencies: Dependencies = {
        async resolveContext() {
            resolutions++; await resolveHook?.();
            return rejection === null ? { ok: true, context } : { ok: false, response: Response.json(
                rejection === 409 ? { code: 'NETWORK_MODE_DISABLED' } : { error: 'Denied' }, { status: rejection }) };
        },
        isSessionCurrent: candidate => candidate.session === currentSession,
        getRuntime() { runtimeAdmissions++; return runtime; },
    };
    const request = (op: WhoNetworkOperation, suffix = op === 'search' ? '?q=synthetic' : op === 'code-check' ? '?code=AA00&release=2026-01' : '', signal?: AbortSignal) =>
        new Request(`https://synthetic.invalid/api/v1/network/terminology/who/${op}${suffix}`, { signal });
    return {
        runtime, dependencies, calls, checks, audits, request,
        run: (op: WhoNetworkOperation, suffix?: string, signal?: AbortSignal) => createIcd11WhoNetworkRoute(op, dependencies)(request(op, suffix, signal)),
        context: () => context, changeContext: (next: Context) => { context = next; },
        revoke: () => { currentSession = null; }, setSession: (value: unknown) => { currentSession = value; },
        reject: (status: number) => { rejection = status; }, resolutions: () => resolutions, admissions: () => runtimeAdmissions,
        transport: (hook: typeof transportHook) => { transportHook = hook; },
        resolving: (hook: typeof resolveHook) => { resolveHook = hook; },
        auditing: (hook: typeof auditHook) => { auditHook = hook; }, advance: (ms: number) => { now += ms; },
    };
}

for (const status of [401, 403, 409]) test(`canonical authority denial ${status} prevents runtime admission`, async () => {
    const f = fixture(); f.reject(status);
    const response = await f.run('search', '?q=one&q=two');
    assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(f.admissions(), 0); assert.deepEqual(f.calls, []);
});

test('search preserves live then cache receipts through the real canonical runtime and audits both', async () => {
    const f = fixture();
    const first = await f.run('search', '?q=%20synthetic%20%20term%20');
    const live = await first.json();
    assert.ok(parseWhoLocalSearchResponse(live)); assert.equal(live.receipt.source, 'live');
    assert.equal(live.entries[0].canonicalUri, URI); assert.equal(live.receipt.bindingId, WHO_LOCAL_BINDING_ID);
    f.advance(1000);
    const cache = await (await f.run('search', '?q=synthetic%20term')).json();
    assert.equal(cache.receipt.source, 'cache'); assert.equal(cache.receipt.fetchedAt, live.receipt.fetchedAt);
    assert.deepEqual(f.calls, ['synthetic term']); assert.equal(f.audits.length, 2);
    assert.doesNotMatch(JSON.stringify(f.audits), /synthetic term|AA00|canonicalUri|tokenHash/u);
});

for (const partial of [false, true]) for (const empty of [false, true]) test(`search partial=${partial} empty=${empty} retains exact provenance`, async () => {
    const f = fixture({ partial, entities: empty ? [] : [entity] });
    const response = await f.run('search'); const data = await response.json();
    assert.equal(response.status, 200); assert.ok(parseWhoLocalSearchResponse(data));
    assert.equal(data.partial, partial); assert.equal(data.entries.length, empty ? 0 : 1);
    assert.equal(data.receipt.resultCount, data.entries.length);
});

test('readiness is passive and configured never becomes available without a live observation', async () => {
    const f = fixture();
    const before = await f.run('readiness');
    assert.equal(before.status, 503); assert.equal((await before.json()).status, 'configured');
    assert.deepEqual(f.calls, []); assert.deepEqual(f.checks, []);
    await f.run('search'); await f.run('search');
    const after = await f.run('readiness'); const body = await after.json();
    assert.equal(after.status, 200); assert.equal(body.status, 'available'); assert.equal(body.lastResultSource, 'cache');
    f.advance(86_400_001);
    const expired = await f.run('readiness'); assert.equal(expired.status, 503); assert.equal((await expired.json()).status, 'configured');
});

for (const found of [true, false]) for (const code of ['AA00', 'AA00&XA001', 'AA00/XA001']) test(`code check ${code} found=${found} uses canonical live receipt`, async () => {
    const f = fixture({ found });
    const response = await f.run('code-check', `?code=${encodeURIComponent(code)}&release=2026-01`);
    const result = await response.json();
    assert.equal(response.status, 200); assert.ok(parseWhoCodeCheckResult(result, code));
    assert.equal(result.status, found ? 'found' : 'not_found'); assert.equal(result.receipt.source, 'live');
    assert.equal(result.receipt.found, found); assert.equal(f.audits.length, 1); assert.deepEqual(f.checks, [code]);
});

test('invalid/duplicate/unknown/oversized parameters do not invoke the runtime', async () => {
    const cases: [WhoNetworkOperation, string, number][] = [
        ['search', '', 400], ['search', '?q=', 400], ['search', '?q=a&q=b', 400], ['search', '?q=a&limit=5', 400],
        ['search', '?q=%3Cb%3E', 400], ['search', '?q=' + 'a'.repeat(161), 400], ['search', '?q=' + '%C3%A9'.repeat(81), 400],
        ['readiness', '?q=a', 400], ['code-check', '?code=AA00', 400], ['code-check', '?code=N%2FA&release=2026-01', 400],
        ['code-check', '?code=AA00&&release=2025-01', 409], ['code-check', '?code=AA00&code=BB00&release=2026-01', 400],
        ['code-check', '?code=AA00&release=2026-01&host=elsewhere', 400],
    ];
    for (const [op, suffix, status] of cases) {
        const f = fixture(); const response = await f.run(op, suffix);
        assert.equal(response.status, status, suffix); assert.equal(f.admissions(), 0);
    }
    const f = fixture();
    const response = await createIcd11WhoNetworkRoute('search', f.dependencies)(new Request(f.request('search'), { method: 'POST' }));
    assert.equal(response.status, 405); assert.equal(f.admissions(), 0);
});

test('revocation during initial authority resolution denies before service access', async () => {
    const f = fixture(); f.resolving(async () => { f.revoke(); });
    assert.equal((await f.run('search')).status, 401); assert.equal(f.admissions(), 0);
});

test('paired capability or network-mode revocation at preflight prevents service work', async () => {
    for (const status of [403, 409]) {
        const f = fixture(); f.resolving(async () => { if (f.resolutions() === 2) f.reject(status); });
        assert.equal((await f.run('search')).status, status); assert.equal(f.admissions(), 0);
    }
});

for (const op of ['search', 'code-check', 'readiness'] as const) test(`${op}: original session is rechecked after the last authority await`, async () => {
    const f = fixture();
    f.resolving(async () => { if (f.resolutions() === 3) f.revoke(); });
    const response = await f.run(op);
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'Unauthorized' });
});

for (const change of ['session', 'same-id-session', 'user', 'role', 'channel', 'scope', 'client', 'token', 'platform'] as const) test(`pending search rejects changed ${change}, even newly authorized`, async () => {
    const f = fixture(); const started = deferred<void>(); const blocked = deferred<ReturnType<typeof upstream>>();
    f.transport(async () => { started.resolve(); return blocked.promise; });
    const work = f.run('search'); await started.promise;
    const old = f.context();
    const next = { ...old, pairedClient: { ...old.pairedClient } };
    if (change === 'session' || change === 'same-id-session') {
        Object.assign(next, { session: { ...old.session, id: change === 'session' ? 'new-synthetic-session' : old.session.id } });
        f.setSession(next.session);
    } else if (change === 'user') Object.assign(next.session, { userId: 'other-synthetic-user' });
    else if (change === 'role') Object.assign(next.session, { role: 'admin' });
    else if (change === 'channel') Object.assign(next.session, { authChannel: 'web' });
    else if (change === 'scope') next.scopeAmbulatoryId = 'synthetic-amb-b';
    else if (change === 'client') next.pairedClient.clientId = 'other-synthetic-client';
    else if (change === 'token') next.pairedClient.tokenHash = 'other-synthetic-hash';
    else Object.assign(next.pairedClient, { clientPlatform: 'ios' });
    f.changeContext(next); blocked.resolve(upstream());
    const response = await work; assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'Unauthorized' });
});

for (const op of ['search', 'code-check'] as const) test(`${op}: revocation during canonical audit prevents delivery`, async () => {
    const f = fixture(); f.auditing(async () => { f.revoke(); });
    const response = await f.run(op); assert.equal(response.status, 401);
    assert.doesNotMatch(await response.text(), /AA00|Synthetic|receipt/u);
});

test('abort before work and during transport never delivers data', async () => {
    const early = fixture(); const controller = new AbortController(); controller.abort();
    assert.equal((await early.run('search', undefined, controller.signal)).status, 401); assert.equal(early.admissions(), 0);
    const late = fixture(); const started = deferred<void>(); const blocked = deferred<ReturnType<typeof upstream>>();
    late.transport(async () => { started.resolve(); return blocked.promise; });
    const cancel = new AbortController(); const work = late.run('search', undefined, cancel.signal);
    await started.promise; cancel.abort(); blocked.resolve(upstream());
    const response = await work; assert.equal(response.status, 401); assert.doesNotMatch(await response.text(), /receipt/u);
});

test('uncooperative service completing after cancellation is also denied', async () => {
    const f = fixture(); const valid = await f.runtime.search('fixture'); const blocked = deferred<typeof valid>();
    const cancel = new AbortController();
    const handler = createIcd11WhoNetworkRoute('search', { ...f.dependencies,
        getRuntime: () => ({ ...f.runtime, search: () => blocked.promise }),
    });
    const work = handler(f.request('search', '?q=late', cancel.signal));
    while (f.resolutions() < 2) await nextTurn(); await nextTurn();
    cancel.abort(); blocked.resolve(valid);
    assert.equal((await work).status, 401);
});

test('wrong schema, binding, count, enum, URI and malformed results fail closed', async () => {
    const f = fixture(); const valid = await f.runtime.search('fixture');
    const values = [
        { ...valid, receipt: { ...valid.receipt, schemaVersion: 'wrong' } },
        { ...valid, receipt: { ...valid.receipt, bindingId: 'wrong' } },
        { ...valid, receipt: { ...valid.receipt, source: 'remote' } },
        { ...valid, receipt: { ...valid.receipt, resultCount: 2 } },
        { ...valid, entries: [{ ...valid.entries[0], canonicalUri: 'https://example.invalid/' }] },
        { ...valid, partial: 'true' },
    ];
    for (const value of values) {
        const handler = createIcd11WhoNetworkRoute('search', { ...f.dependencies, getRuntime: () => ({ ...f.runtime,
            search: async () => value as typeof valid,
        }) });
        assert.equal((await handler(f.request('search'))).status, 502);
    }
});

test('raw 65536-byte bound remains enforced; no invented paging or raised cap', async () => {
    assert.equal(ICD11_WHO_BINDING.maxResponseBytes, 65536);
    const f = fixture(); f.transport(async () => ({ status: 200, body: upstream().body + ' '.repeat(65536) }));
    const response = await f.run('search'); assert.equal(response.status, 502);
    assert.equal((await response.json()).code, 'upstream_response_invalid');
});

test('invalid readiness and code-check projections fail closed', async () => {
    for (const op of ['readiness', 'code-check'] as const) {
        const f = fixture();
        const handler = createIcd11WhoNetworkRoute(op, { ...f.dependencies,
            getRuntime: () => ({ ...f.runtime,
                readiness: () => ({ ...f.runtime.readiness(), schemaVersion: 'legacy' }) as unknown as ReturnType<typeof f.runtime.readiness>,
                checkCode: async code => ({ ...await f.runtime.checkCode(code), code: 'OTHER' }),
            }),
        });
        assert.equal((await handler(f.request(op))).status, 502);
    }
});

test('errors are closed, query-free and do not call every 503 an oversized response', async () => {
    for (const [error, status, code] of [
        [new Error('vendor detail query=private token=secret'), 503, 'service_unavailable'],
        [new Icd11WhoServiceError('audit_unavailable'), 503, 'service_unavailable'],
        [new Icd11WhoServiceError('request_timeout'), 504, 'upstream_timeout'],
        [new Icd11WhoServiceError('response_invalid'), 502, 'upstream_response_invalid'],
    ] as const) {
        const f = fixture();
        const handler = createIcd11WhoNetworkRoute('search', { ...f.dependencies, getRuntime: () => ({ ...f.runtime, search: async () => { throw error; } }) });
        const response = await handler(f.request('search'));
        assert.equal(response.status, status); const body = await response.json(); assert.equal(body.code, code);
        assert.doesNotMatch(JSON.stringify(body), /private|secret|vendor|audit|query/u);
    }
});

test('three production routes bind actual paired authority, original session and canonical runtime', () => {
    for (const op of ['search', 'readiness', 'code-check']) {
        const source = readFileSync(new URL(`../../app/api/v1/network/terminology/who/${op}/route.ts`, import.meta.url), 'utf8');
        assert.match(source, /requireNetworkCapabilityContext\(request, NETWORK_CATALOG_READ_CAPABILITY\)/u);
        assert.match(source, /peekSession\(context\.session\.id\) === context\.session/u);
        assert.match(source, /getRuntime: getIcd11WhoProductionRuntime/u);
        assert.doesNotMatch(source, /create.*Runtime\(|fetch\(|requireSession\(|console\./u);
    }
});

// Authority probes can themselves fail; no thrown probe becomes a 500 or a result.
for (const at of [1, 4, 8]) test(`throwing currentness probe ${at} fails closed`, async () => {
    const f = fixture(); let probes = 0;
    const handler = createIcd11WhoNetworkRoute('search', { ...f.dependencies,
        isSessionCurrent: () => { if (++probes === at) throw new Error('synthetic probe'); return true; },
    });
    const response = await handler(f.request('search'));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await response.text(), /synthetic probe|entries|receipt/);
});

for (const bytes of [63726, 65536, 65537, 69966]) test(`synthetic raw response of exactly ${bytes} bytes preserves canonical cap`, async () => {
    const f = fixture();
    const body = upstream().body.padEnd(bytes, ' ');
    assert.equal(new TextEncoder().encode(body).byteLength, bytes);
    f.transport(async () => ({ status: 200, body }));
    const response = await f.run('search');
    assert.equal(response.status, bytes <= 65536 ? 200 : 502);
    const result = await response.json();
    if (bytes <= 65536) assert.ok(parseWhoLocalSearchResponse(result));
    else assert.equal(result.code, 'upstream_response_invalid');
});

test('valid-shaped but oversized paired projection is not delivered', async () => {
    const f = fixture(); const result = await f.runtime.search('fixture');
    const entries = Array.from({ length: 25 }, (_, index) => ({ ...result.entries[0],
        code: `AA${String(index).padStart(2, '0')}`, description: 'x'.repeat(3000),
    }));
    const large = { ...result, entries, receipt: { ...result.receipt, resultCount: 25 } };
    const handler = createIcd11WhoNetworkRoute('search', { ...f.dependencies,
        getRuntime: () => ({ ...f.runtime, search: async () => large }),
    });
    const response = await handler(f.request('search'));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, 'upstream_response_invalid');
});
