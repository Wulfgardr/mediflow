/* @Codex */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { after, test, type TestContext } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ExecutionMethod, ExecutionTransport, SynthesisCatalog, SynthesisRequest, SynthesisResult } from '../../chatgpt-execution/execution-contract';
import type { QualifiedExecutionHost } from '../../chatgpt-execution/execution-host';
import type { WebSessionProjection } from '../../security/web-auth-lifecycle-owner-adapter';

// The real owner fixture may only be imported after this synthetic directory exists.
const inheritedDataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(inheritedDataDir && isAbsolute(inheritedDataDir), 'An absolute synthetic MEDIFLOW_DATA_DIR is required');
// @Codex: this file owns an empty directory, even when the suite bootstraps its DB.
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-binding-test-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
after(() => {
    rmSync(dataDir, { recursive: true, force: true });
    process.env.MEDIFLOW_DATA_DIR = inheritedDataDir;
});
const { issueSyntheticWebSessionContext, retireSyntheticWebSession } = await import('../../security/web-auth-lifecycle-owner-test-fixture');
const owner = await import('../../security/web-auth-lifecycle-owner-adapter');
const { bindChatGptSyntheticSynthesis } = await import('./chatgpt-synthetic-synthesis-binding');
const { CHATGPT_SYNTHESIS_FIXTURE } = await import('../../chatgpt-execution/synthetic-synthesis-fixture');
const { ExecutionError } = await import('../../chatgpt-execution/execution-contract');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const denied = (error: unknown) => error instanceof ExecutionError && ['session_expired', 'revoked'].includes(error.code) && error.message === error.code;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let sequence = 0;

class SyntheticTransport implements ExecutionTransport {
    calls: { method: ExecutionMethod; params: Record<string, unknown> }[] = [];
    listener: (method: string, params: unknown) => void = () => {};
    closed = false;
    handler?: (method: ExecutionMethod, params: Record<string, unknown>) => Promise<unknown> | undefined;
    constructor(readonly cwd: string, readonly id: string) {}
    initialized() { assert.fail('Binding must not initialize or log in'); }
    subscribe(listener: typeof this.listener) { this.listener = listener; return () => { this.listener = () => {}; }; }
    async close() { this.closed = true; return true; }
    async request(method: ExecutionMethod, raw?: unknown): Promise<unknown> {
        assert.equal(this.closed, false, 'No RPC after transport close');
        const params = (raw ?? {}) as Record<string, unknown>; this.calls.push({ method, params });
        const custom = this.handler?.(method, params); if (custom !== undefined) return custom;
        if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus', email: 'synthetic-binding@example.invalid' }, requiresOpenaiAuth: true };
        if (method === 'model/list') return { data: [{ model: 'synthetic-model', hidden: false, inputModalities: ['text'], supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], nextCursor: null };
        if (method === 'account/rateLimits/read') return { rateLimitsByLimitId: { codex: { primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: null }, secondary: null, rateLimitReachedType: null } } };
        if (method === 'thread/start') return {
            thread: { id: this.id, ephemeral: true, cwd: this.cwd, modelProvider: 'openai', model: 'synthetic-model', reasoningEffort: 'high', turns: [] },
            model: 'synthetic-model', modelProvider: 'openai', cwd: this.cwd, reasoningEffort: 'high', approvalPolicy: 'never',
            instructionSources: [], sandbox: { type: 'readOnly', networkAccess: false }, serviceTier: 'priority',
        };
        if (method === 'turn/start') {
            const output = { summary: 'Due rilevazioni sintetiche.', explanation: 'La proposta usa soltanto il corpus dimostrativo.', citations: [{ sourceId: 'S1', quote: 'Caso DEMO interamente sintetico.' }] };
            this.listener('item/completed', { threadId: this.id, turnId: 'turn-' + this.id, item: { type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(output) } });
            this.listener('turn/completed', { threadId: this.id, turn: { id: 'turn-' + this.id, items: [], status: 'completed' } });
            return { turn: { id: 'turn-' + this.id, items: [], status: 'inProgress' } };
        }
        if (method === 'turn/interrupt') return {};
        assert.fail('Unexpected RPC ' + method);
    }
}
function fixture(t: TestContext, userId = 'synthetic-binding-user') {
    const id = 'synthetic-binding-' + ++sequence;
    const context = issueSyntheticWebSessionContext({ id: userId, username: 'synthetic', role: 'doctor' }, id);
    const session = context.session as WebSessionProjection;
    const transport = new SyntheticTransport(join(dataDir!, id), id);
    let qualified = true;
    let hostCloseCalls = 0;
    const host: QualifiedExecutionHost = {
        transport, cwd: transport.cwd, boundaryQualified: () => qualified,
        async close() { hostCloseCalls++; qualified = false; return transport.close(); },
        // Fake close is not physical cleanup evidence.
        cleanupComplete: () => false,
    };
    let binding: ReturnType<typeof bindChatGptSyntheticSynthesis> | undefined;
    t.after(() => { binding?.dispose(); retireSyntheticWebSession(context.session); });
    return { context, session, host, transport, hostCloseCalls: () => hostCloseCalls,
        bind() { binding = bindChatGptSyntheticSynthesis(session, host); return binding; },
        disqualify() { qualified = false; },
    };
}
async function select(binding: ReturnType<typeof bindChatGptSyntheticSynthesis>): Promise<SynthesisRequest> {
    const response = await binding.catalog(catalog => Response.json(catalog));
    const catalog = await response.json() as SynthesisCatalog;
    return { modelOptionId: catalog.choices[0].optionId, expectedCatalogRevision: catalog.revision };
}

test('forged, copied and retired owner projections deny before any RPC', async t => {
    const f = fixture(t);
    for (const invalid of [{}, { ...f.session }, { ...f.session, expiresAt: 0 }]) {
        assert.throws(() => bindChatGptSyntheticSynthesis(invalid as WebSessionProjection, f.host), denied);
        assert.equal(f.transport.calls.length, 0);
    }
    retireSyntheticWebSession(f.context.session);
    assert.throws(() => bindChatGptSyntheticSynthesis(f.session, f.host), denied);
    assert.equal(f.transport.calls.length, 0);
});

for (const reason of ['lock', 'dispose'] as const) test(`real owner ${reason} during delayed catalog closes host and prevents render`, async t => {
    const f = fixture(t); const binding = f.bind();
    const response = deferred<unknown>(); const reached = deferred<void>();
    f.transport.handler = method => {
        if (method !== 'model/list') return;
        reached.resolve(); return response.promise;
    };
    let rendered = 0;
    const pending = binding.catalog(() => { rendered++; return Response.json({ forbidden: true }); });
    const rejection = assert.rejects(pending, denied);
    await reached.promise;
    const receipt = owner.retire(f.session, reason, reason === 'lock' ? {
        controlId: f.context.controlId, ifMatch: f.context.etag, idempotencyKey: 'synthetic-binding-lock-' + sequence,
    } : undefined);
    assert.notEqual(receipt.outcome, 'denied');
    response.resolve({ data: [], nextCursor: null }); await rejection;
    assert.equal(rendered, 0); assert.equal(f.transport.closed, true); assert.equal(f.hostCloseCalls(), 1);
    const calls = f.transport.calls.length;
    await assert.rejects(binding.catalog(() => { rendered++; return Response.json({ forbidden: true }); }), denied);
    assert.equal(f.transport.calls.length, calls); assert.equal(rendered, 0);
});

test('explicit binding disposal during catalog also prevents late render', async t => {
    const f = fixture(t); const binding = f.bind();
    const response = deferred<unknown>(); const reached = deferred<void>();
    f.transport.handler = method => { if (method === 'model/list') { reached.resolve(); return response.promise; } };
    let rendered = false;
    const pending = binding.catalog(() => { rendered = true; return Response.json({ forbidden: true }); });
    const rejection = assert.rejects(pending, denied); await reached.promise;
    binding.dispose(); binding.dispose(); response.resolve({ data: [], nextCursor: null }); await rejection;
    assert.equal(rendered, false); assert.equal(f.transport.closed, true); assert.equal(f.hostCloseCalls(), 1);
});

test('two real sessions of the same user remain isolated when one retires', async t => {
    const first = fixture(t); const second = fixture(t);
    const firstBinding = first.bind(); const secondBinding = second.bind();
    const firstRequest = await select(firstBinding); const secondRequest = await select(secondBinding);
    assert.notEqual(firstRequest.modelOptionId, secondRequest.modelOptionId);
    assert.notEqual(firstRequest.expectedCatalogRevision, secondRequest.expectedCatalogRevision);
    retireSyntheticWebSession(first.context.session);
    assert.equal(first.hostCloseCalls(), 1); assert.equal(second.hostCloseCalls(), 0); assert.equal(second.transport.closed, false);
    const response = await secondBinding.generate(secondRequest, result => Response.json(result));
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'completed');
    await assert.rejects(firstBinding.catalog(() => Response.json({ forbidden: true })), denied);
});

test('catalog option from another real session cannot start a turn', async t => {
    const first = fixture(t); const second = fixture(t);
    const foreign = await select(first.bind()); const binding = second.bind(); await select(binding);
    let rendered = false;
    await assert.rejects(binding.generate(foreign, () => { rendered = true; return Response.json({ forbidden: true }); }), (error: unknown) => error instanceof ExecutionError && error.code === 'catalog_stale');
    assert.equal(rendered, false); assert.equal(second.transport.calls.some(call => call.method === 'thread/start'), false);
});

test('real owner-bound generation uses only the fixed corpus and returns proposal provenance', async t => {
    const f = fixture(t); const binding = f.bind(); const request = await select(binding);
    const response = await binding.generate(request, result => Response.json(result));
    const result = await response.json() as SynthesisResult;
    assert.equal(result.status, 'completed'); assert.equal(result.proposalOnly, true); assert.equal(result.clinicalWrites, 0);
    assert.equal(result.provenance.fixtureId, 'mediflow-chatgpt-synthesis-demo-v1');
    assert.deepEqual(result.sources, CHATGPT_SYNTHESIS_FIXTURE.sources);
    assert.equal(result.provenance.inputSha256, sha(JSON.stringify(CHATGPT_SYNTHESIS_FIXTURE)));
    const turn = f.transport.calls.find(call => call.method === 'turn/start')!;
    const supplied = turn.params.input as { type: string; text: string }[];
    assert.equal(supplied.length, 1); assert.equal(supplied[0].type, 'text');
    const corpus = supplied[0].text.split('Sources:\n')[1];
    assert.deepEqual(JSON.parse(corpus), CHATGPT_SYNTHESIS_FIXTURE.sources);
    for (const source of result.sources) assert.equal(source.sha256, sha(source.text));
    assert.deepEqual(f.transport.calls.map(call => call.method), ['account/read', 'model/list', 'account/read', 'account/rateLimits/read', 'thread/start', 'turn/start']);
});

test('extra caller text cannot become synthetic corpus or reach the provider', async t => {
    const f = fixture(t); const binding = f.bind(); const request = await select(binding); let rendered = false;
    await assert.rejects(binding.generate({ ...request, sources: [{ text: 'CALLER_SYNTHETIC_SENTINEL' }] } as SynthesisRequest,
        () => { rendered = true; return Response.json({ forbidden: true }); }), (error: unknown) => error instanceof ExecutionError && error.code === 'invalid_request');
    assert.equal(rendered, false); assert.equal(f.transport.calls.some(call => call.method === 'thread/start'), false);
    assert.ok(!JSON.stringify(f.transport.calls).includes('CALLER_SYNTHETIC_SENTINEL'));
});

test('real owner authority never bypasses an unqualified host', async t => {
    const f = fixture(t); const binding = f.bind(); f.disqualify(); let rendered = false;
    await assert.rejects(binding.catalog(() => { rendered = true; return Response.json({ forbidden: true }); }), (error: unknown) => error instanceof ExecutionError && error.code === 'unqualified_boundary');
    assert.equal(rendered, false); assert.equal(f.transport.calls.length, 0);
});

test('binding and corpus expose no DB, writer, filesystem, shell or arbitrary input dependency', () => {
    const binding = readFileSync(new URL('./chatgpt-synthetic-synthesis-binding.ts', import.meta.url), 'utf8');
    const imports = [...binding.matchAll(/^import\s+(?!type\b).*?from\s+'([^']+)'/gm)].map(match => match[1]);
    assert.deepEqual(imports, ['../../security/web-auth-lifecycle-owner-adapter', '../../chatgpt-execution/execution-contract', '../../chatgpt-execution/execution-service', '../../chatgpt-execution/synthetic-synthesis-fixture']);
    assert.match(binding, /input: CHATGPT_SYNTHESIS_FIXTURE/);
    assert.doesNotMatch(binding, /\b(?:require|eval)\s*\(|import\s*\(|\bprocess\.|node:(?:fs|child_process|net|http)|db-server|clinicalWriter/);
    const corpus = readFileSync(new URL('../../chatgpt-execution/synthetic-synthesis-fixture.ts', import.meta.url), 'utf8');
    assert.deepEqual([...corpus.matchAll(/^import\s+(?!type\b).*?from\s+'([^']+)'/gm)].map(match => match[1]), ['node:crypto']);
    assert.equal(Object.isFrozen(CHATGPT_SYNTHESIS_FIXTURE), true);
    assert.equal(Object.isFrozen(CHATGPT_SYNTHESIS_FIXTURE.sources), true);
    assert.ok(CHATGPT_SYNTHESIS_FIXTURE.sources.every(Object.isFrozen));
    assert.ok(readdirSync(dataDir!).every(name => !/\.(?:db|sqlite|sqlite3)(?:-|$)/i.test(name)), 'No database artifact in synthetic data directory');
});

for (const operation of ['catalog', 'generate'] as const) test(`real owner cannot commit ${operation} canceled by its synchronous renderer`, async t => {
    const f = fixture(t); const binding = f.bind(); let rendered = false;
    const render = () => { rendered = true; void binding.cancel(); return Response.json({ mustNotBePublished: true }); };
    const response = operation === 'catalog' ? binding.catalog(render) : binding.generate(await select(binding), render);
    await assert.rejects(response, (error: unknown) => error instanceof ExecutionError && error.code === 'session_expired');
    assert.equal(rendered, true);
});

test('real owner cannot commit a catalog if its renderer disqualifies the host', async t => {
    const f = fixture(t); const binding = f.bind(); let rendered = false;
    await assert.rejects(binding.catalog(() => {
        rendered = true; f.disqualify(); return Response.json({ mustNotBePublished: true });
    }), (error: unknown) => error instanceof ExecutionError && error.code === 'session_expired');
    assert.equal(rendered, true);
});

test('real owner cannot commit a completed result if its renderer aborts the originating signal', async t => {
    const f = fixture(t); const binding = f.bind(); const request = await select(binding); const controller = new AbortController();
    await assert.rejects(binding.generate(request, () => {
        controller.abort(); return Response.json({ mustNotBePublished: true });
    }, controller.signal), (error: unknown) => error instanceof ExecutionError && error.code === 'session_expired');
});
