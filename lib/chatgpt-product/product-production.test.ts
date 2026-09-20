/* @Codex — ONLY THIS TEST FILE supplies fake protocol/OS observations. The root,
 * routes, owner 0.8.7, consent and synthesis binding are the actual source. */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ExecutionCode, ExecutionMethod, ExecutionTransport } from '../chatgpt-execution/execution-contract';
import type { WebSessionProjection } from '../security/web-auth-lifecycle-owner-adapter';
import type { QualifiedExecutionHost } from '../chatgpt-execution/execution-host';
import type { ProductOperation, ProductResponse, ProductSnapshot, QualificationSnapshot } from './product-contract';
const dataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(dataDir && isAbsolute(dataDir), 'Absolute run-owned synthetic MEDIFLOW_DATA_DIR required');
mkdirSync(dataDir, { recursive: true });
const { createChatGptProduct } = await import('./product-production.ts');
const { createProductBrowser } = await import('./product-browser.ts');
const { PRODUCT_NAMESPACE, PRODUCT_OPERATION, PRODUCT_DATA_CLASS } = await import('./product-contract.ts');
const { expectedExecutionConfig, expectedExecutionEnvironment } = await import('../chatgpt-execution/execution-login.ts');
const { EXECUTION_SUBSTRATE } = await import('../chatgpt-execution/execution-sandbox.ts');
const { CHATGPT_SYNTHESIS_FIXTURE } = await import('../chatgpt-execution/synthetic-synthesis-fixture.ts');
const { issueSyntheticWebSessionContext, retireSyntheticWebSession } = await import('../security/web-auth-lifecycle-owner-test-fixture.ts');
export const tick = () => new Promise<void>(resolve => setImmediate(resolve));
export function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
export class SyntheticProductTransport implements ExecutionTransport {
    calls: { method: ExecutionMethod; params: Record<string, unknown> }[] = [];
    listeners = new Set<{ notify(method: string, params: unknown): void; fail(code: ExecutionCode): void }>();
    closed = false; closeCalls = 0; initializedCalls = 0; connected = false; autoFinish = true;
    identity = 'synthetic-product@example.invalid'; plan = 'plus'; cleanup = true;
    model = 'fixture-model-not-a-real-model'; efforts = ['high', 'xhigh'];
    output: unknown = { summary: 'Proposta esclusivamente DEMO.', explanation: 'Sintesi delle sole fonti dimostrative.',
        citations: [{ sourceId: 'S1', quote: 'Caso DEMO interamente sintetico.' }] };
    quotas: unknown = { rateLimitsByLimitId: { codex: { primary: { usedPercent: 5 }, secondary: { usedPercent: 10 }, rateLimitReachedType: null } } };
    override?: (method: ExecutionMethod, params: Record<string, unknown>) => unknown;
    constructor(readonly cwd: string) {}
    initialized() { this.initializedCalls++; }
    subscribe(notify: (method: string, params: unknown) => void, fail: (code: ExecutionCode) => void = () => {}) {
        const listener = { notify, fail }; this.listeners.add(listener); return () => { this.listeners.delete(listener); };
    }
    emit(method: string, params: unknown) { for (const listener of [...this.listeners]) listener.notify(method, params); }
    fail(code: ExecutionCode) { for (const listener of [...this.listeners]) listener.fail(code); }
    login(id = 'fixture-login', success = true) { this.connected = success; this.emit('account/login/completed', { loginId: id, success, error: null }); }
    finish() {
        this.emit('item/completed', { threadId: 'fixture-thread', turnId: 'fixture-turn', item: { type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(this.output) } });
        this.emit('turn/completed', { threadId: 'fixture-thread', turn: { id: 'fixture-turn', items: [], status: 'completed' } });
    }
    async close() { this.closeCalls++; this.closed = true; return true; }
    drainObservation() { return { closing: this.closed, leaderExited: this.closed, ownedGroupCeased: this.closed ? true : null }; }
    async request(method: ExecutionMethod, raw?: unknown): Promise<unknown> {
        assert.equal(this.closed, false, 'NO protocol work after synthetic transport close');
        const params = (raw ?? {}) as Record<string, unknown>; this.calls.push({ method, params });
        const custom = this.override?.(method, params); if (custom !== undefined) return custom;
        switch (method) {
            case 'initialize': return { ...expectedExecutionEnvironment(this.cwd), userAgent: `codex_cli_rs/${EXECUTION_SUBSTRATE.codexVersion} (synthetic transport, not binary evidence)` };
            case 'config/read': return { config: expectedExecutionConfig(), layers: null, origins: {} };
            case 'account/read': return { requiresOpenaiAuth: true, account: this.connected ? { type: 'chatgpt', planType: this.plan, email: this.identity } : null };
            case 'account/login/start': assert.deepEqual(params, { type: 'chatgptDeviceCode' }); return { type: 'chatgptDeviceCode', loginId: 'fixture-login', userCode: 'FAKE-TEST', verificationUrl: 'https://auth.openai.com/fixture-only-not-opened' };
            case 'account/login/cancel': return { status: 'canceled' };
            case 'account/logout': this.connected = false; return {};
            case 'model/list': return { data: [{ model: this.model, hidden: false, inputModalities: ['text'], supportedReasoningEfforts: this.efforts.map(reasoningEffort => ({ reasoningEffort })) }], nextCursor: null };
            case 'account/rateLimits/read': return this.quotas;
            case 'thread/start': return { thread: { id: 'fixture-thread', ephemeral: true, cwd: this.cwd, modelProvider: 'openai', model: params.model, reasoningEffort: (params.config as Record<string, unknown>).model_reasoning_effort, turns: [] },
                model: params.model, reasoningEffort: (params.config as Record<string, unknown>).model_reasoning_effort, cwd: this.cwd, modelProvider: 'openai', approvalPolicy: 'never', instructionSources: [], sandbox: { type: 'readOnly', networkAccess: false }, serviceTier: 'priority' };
            case 'turn/start': if (this.autoFinish) this.finish(); return { turn: { id: 'fixture-turn', items: [], status: 'inProgress' } };
            case 'turn/interrupt': return {};
        }
    }
}
let sequence = 0;
/** Imported by other test files/isolated browser harness only, never production. */
export function createProductFixture(t?: Pick<TestContext, 'after'>) {
    const id = `product-fixture-${++sequence}`;
    const context = issueSyntheticWebSessionContext({ id, username: 'synthetic', role: 'doctor' }, id);
    let session: typeof context.session | null = context.session;
    let qualification: QualificationSnapshot = { platform: 'synthetic-test-only', state: 'qualified', revision: 'fake-qualification-v1', missing: [] };
    let created = 0, qualified = true;
    let createOverride: ((host: QualifiedExecutionHost) => Promise<QualifiedExecutionHost>) | undefined;
    const transport = new SyntheticProductTransport(join(dataDir!, id, 'work'));
    const host: QualifiedExecutionHost = { transport, cwd: transport.cwd, boundaryQualified: () => qualified,
        async close() { qualified = false; return transport.close(); }, cleanupComplete: () => transport.closed && transport.cleanup };
    const root = createChatGptProduct({ resolveSession: async () => session as WebSessionProjection | null, platform: {
        snapshot: () => qualification,
        async create() { created++; return createOverride ? createOverride(host) : host; },
    } });
    const paths: string[] = [], responses: number[] = [];
    async function call(operation: ProductOperation, body: unknown = {}, options: { signal?: AbortSignal; headers?: Record<string, string>; method?: string; raw?: string; query?: string } = {}) {
        const headers = new Headers({ 'content-type': 'application/json', origin: 'http://localhost:3987', 'sec-fetch-site': 'same-origin', ...options.headers });
        const method = options.method ?? (operation === 'status' ? 'GET' : 'POST');
        const response = await root.handle(new Request(`http://localhost:3987${PRODUCT_NAMESPACE}${operation}${options.query ?? ''}`, { method, headers,
            ...(method === 'GET' || method === 'HEAD' ? {} : { body: options.raw ?? JSON.stringify(body) }), signal: options.signal }), operation);
        assert.equal(response.headers.get('cache-control'), 'no-store'); return response;
    }
    async function request(operation: ProductOperation, body: unknown = {}) {
        const response = await call(operation, body); const result = await response.json();
        assert.equal(response.status, 200, JSON.stringify(result)); return result as ProductResponse;
    }
    const browser = createProductBrowser(async (input, init) => {
        const path = String(input); paths.push(path);
        assert.ok(path.startsWith(PRODUCT_NAMESPACE));
        const headers = new Headers(init?.headers); if (init?.method === 'POST') { headers.set('origin', 'http://localhost:3987'); headers.set('sec-fetch-site', 'same-origin'); }
        const response = await root.handle(new Request('http://localhost:3987' + path, { ...init, headers }), path.slice(PRODUCT_NAMESPACE.length) as ProductOperation);
        responses.push(response.status); return response;
    });
    async function consent() {
        const state = await request('status');
        return request('consent', { operation: PRODUCT_OPERATION, dataClass: PRODUCT_DATA_CLASS, expectedDisclosureRevision: state.snapshot.disclosure.revision });
    }
    async function connected() { await consent(); await request('login/start'); transport.login(); return request('login/complete'); }
    async function ready() { await connected(); return (await request('models')).snapshot; }
    function dispose() { root.dispose(); browser.dispose(); retireSyntheticWebSession(context.session); }
    t?.after(dispose);
    return { context, root, transport, host, browser, paths, responses, call, request, consent, connected, ready, dispose,
        created: () => created, setCreate: (override: typeof createOverride) => { createOverride = override; },
        setQualification: (value: QualificationSnapshot) => { qualification = value; }, disqualifyHost: () => { qualified = false; },
        setSession: (value: typeof session) => { session = value; }, retire: () => retireSyntheticWebSession(context.session) };
}
function selection(state: ProductSnapshot) { return { modelOptionId: state.catalog!.choices[0].optionId, expectedCatalogRevision: state.catalog!.revision }; }

// Do not register this suite when imported as a test fixture by the DOM harness.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/product-production.test.ts')) {
    test('actual root + owner + binding: explicit full synthetic chain, one turn, fixed sources and bounded provenance', async t => {
        const f = createProductFixture(t);
        for (let i = 0; i < 3; i++) await f.request('status');
        assert.equal(f.created(), 0); assert.equal(f.transport.calls.length, 0);
        assert.equal((await f.call('login/start')).status, 409);
        await f.consent(); assert.equal(f.created(), 0);
        const start = await f.request('login/start'); assert.ok(start.login); assert.equal(start.snapshot.authenticatedProcess, 'none');
        assert.doesNotMatch(JSON.stringify((await f.request('status')).snapshot), /FAKE-TEST|fixture-login|verificationUrl|synthetic-product@example/);
        assert.equal((await f.call('login/complete')).status, 409);
        f.transport.login(); const linked = await f.request('login/complete'); assert.equal(linked.snapshot.authenticatedProcess, 'dedicated_execution');
        const state = (await f.request('models')).snapshot;
        assert.equal(state.catalog!.choices.length, 2); assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 0);
        const done = await f.request('generate', selection(state));
        assert.equal(done.snapshot.state, 'completed'); assert.ok(done.snapshot.result);
        assert.equal(done.snapshot.result.provenance.model, f.transport.model);
        assert.equal(done.snapshot.result.provenance.effort, 'high');
        assert.equal(done.snapshot.result.provenance.observedServiceTier, null);
        assert.deepEqual(done.snapshot.result.sources, CHATGPT_SYNTHESIS_FIXTURE.sources);
        assert.equal(done.snapshot.result.clinicalWrites, 0); assert.equal(done.snapshot.result.proposalOnly, true);
        assert.equal(done.snapshot.receipt.escapedDescendants, 'not_attested');
        assert.equal(f.transport.calls.filter(x => x.method === 'thread/start').length, 1);
        assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 1);
        const turn = f.transport.calls.find(x => x.method === 'turn/start')!;
        for (const source of CHATGPT_SYNTHESIS_FIXTURE.sources) assert.ok(JSON.stringify(turn.params).includes(source.text));
        const count = f.transport.calls.length; await f.request('status'); assert.equal(f.transport.calls.length, count);
        assert.equal((await f.call('generate', selection(state))).status, 409);
        const logout = await f.request('logout'); assert.equal(logout.snapshot.result, null); assert.equal(logout.snapshot.receipt.remoteLogout, 'not_attempted');
        assert.equal(logout.snapshot.receipt.localAuthorityWithdrawn, true); assert.equal(f.created(), 1);
    });
    test('same-origin/method/exact bounded body/session checks precede process creation', async t => {
        const f = createProductFixture(t);
        for (const field of ['prompt', 'text', 'sourceIds', 'provider', 'apiKey', 'endpoint', 'method', 'params', 'binaryPath', 'context', 'writer']) {
            assert.equal((await f.call('login/start', { [field]: 'not-allowed' })).status, 400);
        }
        assert.equal((await f.call('login/start', {}, { headers: { origin: 'https://example.invalid' } })).status, 403);
        assert.equal((await f.call('login/start', {}, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
        assert.equal((await f.call('login/start', {}, { headers: { 'content-type': 'text/plain' } })).status, 403);
        assert.equal((await f.call('login/start', {}, { method: 'GET' })).status, 405);
        assert.equal((await f.call('status', {}, { method: 'POST' })).status, 405);
        assert.equal((await f.call('status', {}, { query: '?path=anything' })).status, 400);
        for (const raw of ['{"x":1,"x":1}', '{"x":"' + 'x'.repeat(1024) + '"}', '[]', 'null', '{}garbage']) assert.equal((await f.call('consent', {}, { raw })).status, 400);
        assert.equal(f.created(), 0); f.setSession(null); assert.equal((await f.call('status')).status, 401);
        f.setSession({ ...f.context.session }); assert.equal((await f.call('status')).status, 401);
        f.setSession(f.context.session); f.retire(); assert.equal((await f.call('status')).status, 401);
    });
    for (const cause of ['cancel', 'owner', 'request-abort', 'qualification'] as const) test(`late host under ${cause} is drained by original ownership and never initialized`, async t => {
        const f = createProductFixture(t); const late = deferred<QualifiedExecutionHost>(); const reached = deferred<void>();
        f.setCreate(() => { reached.resolve(); return late.promise; }); await f.consent();
        const abort = new AbortController(); const pending = f.call('login/start', {}, { signal: abort.signal }); await reached.promise;
        if (cause === 'cancel') await f.request('cancel');
        else if (cause === 'owner') f.retire();
        else if (cause === 'request-abort') abort.abort();
        else f.setQualification({ platform: 'synthetic-test-only', state: 'unqualified', revision: 'withdrawn', missing: ['synthetic'] });
        late.resolve(f.host); const response = await pending; await tick();
        assert.notEqual(response.status, 200); assert.equal(f.transport.closed, true); assert.equal(f.transport.calls.length, 0);
        assert.equal(f.created(), 1);
    });
    test('cancel before completion suppresses late login notice and erases challenge', async t => {
        const f = createProductFixture(t); await f.consent(); await f.request('login/start');
        await f.request('login/cancel'); f.transport.login();
        const state = (await f.request('status')).snapshot; assert.equal(state.state, 'canceled'); assert.equal(state.authenticatedProcess, 'none');
        assert.equal((await f.call('login/complete')).status, 409); assert.ok(f.transport.calls.some(x => x.method === 'account/login/cancel'));
    });
    for (const cause of ['owner', 'cancel', 'account-change', 'quota-change', 'request-abort'] as const) test(`generation ${cause}: no late result or second turn`, async t => {
        const f = createProductFixture(t); const state = await f.ready(); f.transport.autoFinish = false;
        const reached = deferred<void>(); f.transport.override = method => { if (method === 'turn/start') reached.resolve(); };
        const abort = new AbortController(); const pending = f.call('generate', selection(state), { signal: abort.signal }); await reached.promise; await tick();
        if (cause === 'owner') f.retire();
        else if (cause === 'cancel') await f.request('cancel');
        else if (cause === 'account-change') f.transport.emit('account/updated', { authMode: 'chatgpt', planType: 'pro' });
        else if (cause === 'quota-change') f.transport.emit('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: { usedPercent: 100 } } });
        else abort.abort();
        assert.notEqual((await pending).status, 200); f.transport.finish(); await tick();
        if (cause !== 'owner') assert.equal((await f.request('status')).snapshot.result, null);
        assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 1); assert.equal(f.transport.closed, true);
    });
    for (const changed of ['model', 'effort', 'revision'] as const) test(`stale ${changed} is rejected without turn or fallback`, async t => {
        const f = createProductFixture(t); const state = await f.ready(); const choice = selection(state);
        if (changed === 'model') f.transport.model = 'different-fixture-model';
        else if (changed === 'effort') f.transport.efforts = ['low'];
        else await f.request('models');
        const response = await f.call('generate', choice); assert.equal((await response.json()).error, 'catalog_stale');
        assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 0);
    });
    for (const quota of [null, {}, { rateLimits: { primary: { usedPercent: 0 } }, rateLimitsByLimitId: {} },
        { rateLimitsByLimitId: { codex: { primary: null, secondary: null } } },
        { rateLimitsByLimitId: { codex: { primary: { usedPercent: 100 } } } },
        { rateLimitsByLimitId: { codex: { primary: { usedPercent: -1 } } } }]) test(`missing/exhausted quota denies: ${JSON.stringify(quota)}`, async t => {
        const f = createProductFixture(t); await f.connected(); f.transport.quotas = quota;
        const response = await f.call('models'); assert.equal(response.status, 503); assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 0);
        assert.equal((await f.request('status')).snapshot.catalog, null);
    });
    for (const corruption of ['citation', 'extra-output', 'tool', 'model-readback', 'effort-readback', 'account-readback'] as const) test(`guard ${corruption} in actual product composition denies`, async t => {
        const f = createProductFixture(t); const state = await f.ready();
        if (corruption === 'citation') f.transport.output = { summary: 'x', explanation: 'x', citations: [{ sourceId: 'unknown', quote: 'not in corpus' }] };
        if (corruption === 'extra-output') f.transport.output = { ...(f.transport.output as object), clinicalWrite: 'forbidden' };
        if (corruption === 'account-readback') f.transport.identity = 'other@example.invalid';
        f.transport.override = (method, params) => {
            if (corruption === 'tool' && method === 'turn/start') { f.transport.emit('item/started', { threadId: 'fixture-thread', turnId: 'fixture-turn', item: { type: 'commandExecution' } }); return { turn: { id: 'fixture-turn', status: 'inProgress', items: [] } }; }
            if ((corruption === 'model-readback' || corruption === 'effort-readback') && method === 'thread/start') return { thread: { id: 'fixture-thread', ephemeral: true, turns: [] }, model: corruption === 'model-readback' ? 'wrong' : params.model, reasoningEffort: corruption === 'effort-readback' ? 'low' : params.reasoningEffort, modelProvider: 'openai', cwd: f.transport.cwd, sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [], approvalPolicy: 'never', serviceTier: 'priority' };
        };
        const response = await f.call('generate', selection(state)); assert.notEqual(response.status, 200);
        assert.equal((await f.request('status')).snapshot.result, null);
    });
    test('idle dedicated logout is matched by account/read, no account-control reuse', async t => {
        const f = createProductFixture(t); await f.connected(); const response = await f.request('logout');
        assert.equal(response.snapshot.receipt.remoteLogout, 'confirmed'); assert.equal(response.snapshot.receipt.localAuthorityWithdrawn, true);
        assert.equal(response.snapshot.authenticatedProcess, 'none'); assert.equal(f.transport.closed, true);
    });
    test('cleanup failure is visible and blocks re-consent', async t => {
        const f = createProductFixture(t); await f.connected(); f.transport.cleanup = false;
        const state = (await f.request('cancel')).snapshot; assert.equal(state.receipt.cleanup, 'unconfirmed');
        assert.equal((await f.call('consent', { operation: PRODUCT_OPERATION, dataClass: PRODUCT_DATA_CLASS, expectedDisclosureRevision: state.disclosure.revision })).status, 409);
    });
    for (const phase of ['start', 'completed'] as const) test(`foreign login completion ${phase} cannot authenticate product`, async t => {
        const f = createProductFixture(t); await f.consent(); await f.request('login/start');
        if (phase === 'completed') { f.transport.login(); await f.request('login/complete'); }
        f.transport.login('foreign-login'); const state = (await f.request('status')).snapshot;
        assert.equal(state.state, 'error'); assert.equal(state.authenticatedProcess, 'none'); assert.equal(state.catalog, null);
    });
    test('version/config/auth state readback fails closed before binding', async t => {
        for (const phase of ['initialize', 'config/read', 'account/read'] as const) {
            const f = createProductFixture(t); f.transport.override = method => method === phase ? phase === 'initialize' ? { userAgent: 'wrong-version' }
                : phase === 'config/read' ? { config: { features: {} } } : { requiresOpenaiAuth: true, account: { type: 'chatgpt', planType: 'plus', email: 'preexisting@example.invalid' } } : undefined;
            await f.consent(); assert.equal((await f.call('login/start')).status, 503);
            assert.equal(f.transport.calls.filter(x => x.method === 'account/login/start').length, 0);
        }
    });
}
