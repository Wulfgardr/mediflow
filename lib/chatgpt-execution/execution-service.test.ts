/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ExecutionCode, ExecutionMethod, ExecutionTransport } from './execution-contract';

// Set the synthetic directory before importing any application module (ADR 0130).
const dataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(dataDir && isAbsolute(dataDir), 'An absolute synthetic MEDIFLOW_DATA_DIR is required');
mkdirSync(dataDir, { recursive: true });
const { createSynthesisExecutionService } = await import('./execution-service');
const { ExecutionError } = await import('./execution-contract');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const source = { id: 'source-a', title: 'Synthetic schedule', text: 'The synthetic clinic opens on Monday.', sha256: sha('The synthetic clinic opens on Monday.') };
const input = { fixtureId: 'synthetic-schedule-v1', sources: [source] };
const cwd = join(dataDir, 'isolated-cwd');
const model = { model: 'exact-model', hidden: false, inputModalities: ['text'], supportedReasoningEfforts: [{ reasoningEffort: 'max' }, { reasoningEffort: 'ultra' }] };
const output = { summary: 'Monday opening.', explanation: 'The provided schedule states the opening day.', citations: [{ sourceId: source.id, quote: 'opens on Monday' }] };
const quota = () => ({ rateLimitsByLimitId: { codex: { primary: { usedPercent: 1 }, secondary: { usedPercent: 2 }, rateLimitReachedType: null } } });
const errorCode = (code: ExecutionCode) => (error: unknown) => error instanceof ExecutionError && error.code === code && error.message === code;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

class FakeTransport implements ExecutionTransport {
    calls: { method: ExecutionMethod; params: Record<string, unknown> }[] = [];
    closed = 0;
    listener: (method: string, params: unknown) => void = () => {};
    failure: (code: ExecutionCode) => void = () => {};
    override?: (method: ExecutionMethod, params: Record<string, unknown>) => unknown;
    onTurn?: () => void;
    initialized() { throw new Error('The host owns initialization'); }
    subscribe(listener: typeof this.listener, failure: typeof this.failure) { this.listener = listener; this.failure = failure; return () => { this.listener = () => {}; }; }
    async close() { this.closed++; return true; }
    async request(method: ExecutionMethod, raw?: unknown): Promise<unknown> {
        const params = (raw ?? {}) as Record<string, unknown>;
        this.calls.push({ method, params });
        const custom = this.override?.(method, params);
        if (custom !== undefined) return custom;
        if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus', email: 'fixture-account@example.invalid' } };
        if (method === 'model/list') return { data: [model], nextCursor: null };
        if (method === 'account/rateLimits/read') return quota();
        if (method === 'thread/start') return this.thread(params);
        if (method === 'turn/start') { this.onTurn?.(); return { turn: { id: 'turn-1', items: [], status: 'inProgress' } }; }
        if (method === 'turn/interrupt') return {};
        throw new Error('Unexpected RPC');
    }
    thread(params: Record<string, unknown>) {
        const effort = (params.config as Record<string, unknown>).model_reasoning_effort;
        return { thread: { id: 'thread-1', ephemeral: true, cwd, modelProvider: 'openai', model: params.model, reasoningEffort: effort, turns: [] },
            model: params.model, modelProvider: 'openai', cwd, reasoningEffort: effort, approvalPolicy: 'never',
            instructionSources: [], sandbox: { type: 'readOnly', networkAccess: false }, serviceTier: 'priority' };
    }
    final(value: unknown = output, threadId = 'thread-1', turnId = 'turn-1') {
        this.listener('item/completed', { threadId, turnId, item: { type: 'agentMessage', phase: 'final_answer', text: typeof value === 'string' ? value : JSON.stringify(value) } });
    }
    complete(threadId = 'thread-1', id = 'turn-1', items: unknown[] = []) { this.listener('turn/completed', { threadId, turn: { id, status: 'completed', items } }); }
}
function setup(extra: Partial<Parameters<typeof createSynthesisExecutionService>[0]> = {}) {
    const transport = new FakeTransport();
    const service = createSynthesisExecutionService({ transport, input, cwd, isCurrent: () => true, boundaryQualified: () => true, timeoutMs: 2000, ...extra });
    return { transport, service };
}
async function selection(service: ReturnType<typeof createSynthesisExecutionService>) {
    const catalog = await service.readCatalog();
    return { modelOptionId: catalog.choices[0].optionId, expectedCatalogRevision: catalog.revision };
}
async function started(transport: FakeTransport) {
    for (let attempt = 0; attempt < 30; attempt++) { if (transport.calls.some(call => call.method === 'turn/start')) { await tick(); return; } await tick(); }
    assert.fail('turn/start not reached');
}

test('success keeps exact model/effort/priority, verified source hashes, one turn, and closes', async () => {
    const { service, transport } = setup();
    const request = await selection(service);
    transport.onTurn = () => { transport.final(); transport.complete(); }; // Notifications precede RPC response.
    const result = await service.generate(request);
    assert.equal(result.summary, output.summary);
    assert.equal(result.citations[0].sourceSha256, source.sha256);
    assert.equal(result.provenance.inputSha256, sha(JSON.stringify(input)));
    assert.equal(result.provenance.outputSha256, sha(JSON.stringify(output)));
    assert.equal(result.provenance.observedServiceTier, null);
    assert.equal(result.provenance.fallback, 'none');
    assert.equal(result.clinicalWrites, 0);
    assert.ok(!JSON.stringify(result).includes('thread-1'));
    const thread = transport.calls.find(call => call.method === 'thread/start')!.params;
    const turn = transport.calls.find(call => call.method === 'turn/start')!.params;
    assert.equal(thread.ephemeral, true); assert.equal(thread.model, 'exact-model'); assert.equal(thread.sandbox, 'read-only');
    assert.deepEqual(thread.config, { model_reasoning_effort: 'max', model_reasoning_summary: 'none' });
    assert.equal(thread.approvalPolicy, 'never'); assert.equal(thread.modelProvider, 'openai');
    assert.equal(turn.model, 'exact-model'); assert.equal(turn.effort, 'max');
    assert.equal(thread.serviceTier, 'priority'); assert.equal(turn.serviceTier, 'priority'); assert.equal(turn.summary, 'none');
    assert.equal((turn.outputSchema as { additionalProperties: boolean }).additionalProperties, false);
    assert.equal(transport.closed, 1);
    await assert.rejects(service.generate(request), errorCode('session_expired'));
    assert.deepEqual(transport.calls.map(call => call.method), ['account/read', 'model/list', 'account/read', 'account/rateLimits/read', 'thread/start', 'turn/start']);
});

test('catalog rotates opaque choices and excludes hidden/nontext models', async () => {
    const { service, transport } = setup();
    transport.override = method => method === 'model/list' ? { data: [model, { ...model, hidden: true }, { ...model, inputModalities: ['image'] }] } : undefined;
    const first = await service.readCatalog(); const second = await service.readCatalog();
    assert.deepEqual(second.choices.map(choice => choice.effort), ['max', 'ultra']);
    assert.notEqual(first.revision, second.revision);
    assert.notEqual(first.choices[0].optionId, second.choices[0].optionId);
    assert.match(second.choices[0].optionId, /^[a-f0-9-]{36}$/);
    await assert.rejects(service.generate({ modelOptionId: first.choices[0].optionId, expectedCatalogRevision: first.revision }), errorCode('catalog_stale'));
    assert.equal(transport.calls.filter(call => call.method === 'thread/start').length, 0);
});

for (const kind of ['boundary', 'owner'] as const) test(`no RPC without ${kind} qualification`, async () => {
    const { service, transport } = setup(kind === 'boundary' ? { boundaryQualified: () => false } : { isCurrent: () => false });
    await assert.rejects(service.readCatalog(), errorCode(kind === 'boundary' ? 'unqualified_boundary' : 'revoked'));
    assert.equal(transport.calls.length, 0); await service.dispose();
});

for (const account of [null, { type: 'apiKey' }, { type: 'chatgptAuthTokens', planType: 'plus' }, { type: 'chatgpt', planType: 'free' }]) test(`reject account ${JSON.stringify(account)}`, async () => {
    const { service, transport } = setup();
    transport.override = method => method === 'account/read' ? { account } : undefined;
    await assert.rejects(service.readCatalog(), errorCode(account === null ? 'not_connected' : 'unsupported_account'));
    assert.deepEqual(transport.calls.map(call => call.method), ['account/read']);
});

for (const [name, limits, code] of [
    ['primary exhausted', { rateLimitsByLimitId: { codex: { primary: { usedPercent: 100 }, secondary: { usedPercent: 0 } } } }, 'quota_exhausted'],
    ['secondary exhausted', { rateLimitsByLimitId: { codex: { primary: { usedPercent: 0 }, secondary: { usedPercent: 101 } } } }, 'quota_exhausted'],
    ['reached type', { rateLimitsByLimitId: { codex: { ...quota().rateLimitsByLimitId.codex, rateLimitReachedType: 'credits' } } }, 'quota_exhausted'],
    ['unknown', {}, 'limits_unavailable'],
    ['missing codex never uses legacy', { rateLimitsByLimitId: {}, rateLimits: quota().rateLimitsByLimitId.codex }, 'limits_unavailable'],
    ['no known window', { rateLimits: { primary: null, secondary: null } }, 'limits_unavailable'],
    ['invalid percent', { rateLimits: { primary: { usedPercent: '0' }, secondary: { usedPercent: 0 } } }, 'limits_unavailable'],
] as const) test(`quota: ${name}; no turn, reset, purchase or fallback`, async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.override = method => method === 'account/rateLimits/read' ? limits : undefined;
    await assert.rejects(service.generate(request), errorCode(code));
    assert.deepEqual(transport.calls.map(call => call.method), ['account/read', 'model/list', 'account/read', 'account/rateLimits/read']);
});

test('legacy quota only when map absent, external restricted sandbox allowed', async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.override = (method, params) => method === 'account/rateLimits/read' ? { rateLimits: quota().rateLimitsByLimitId.codex }
        : method === 'thread/start' ? { ...transport.thread(params), sandbox: { type: 'externalSandbox', networkAccess: 'restricted' } } : undefined;
    transport.onTurn = () => { transport.final(); transport.complete(); };
    assert.equal((await service.generate(request)).status, 'completed');
});

for (const update of [
    { limitId: 'codex', primary: { usedPercent: 100 } },
    { limitId: 'codex', secondary: { usedPercent: 101 } },
    { limitId: 'codex', spendControlReached: true },
    { limitId: null, rateLimitReachedType: 'rate_limit_reached' },
]) test('rolling quota exhaustion denies an in-flight result without recovery', async () => {
    const { service, transport } = setup();
    const request = await selection(service);
    const generated = service.generate(request);
    const rejected = assert.rejects(generated, errorCode('quota_exhausted'));
    await started(transport);
    transport.listener('account/rateLimits/updated', { rateLimits: update });
    transport.listener('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: null, secondary: null } });
    transport.final(); transport.complete();
    await rejected;
    assert.equal(transport.closed, 1);
});

test('sparse quota metadata and another bucket do not erase a valid snapshot', async () => {
    const { service, transport } = setup();
    const request = await selection(service);
    transport.onTurn = () => {
        transport.listener('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: null, secondary: null } });
        transport.listener('account/rateLimits/updated', { rateLimits: { limitId: 'other', primary: { usedPercent: 100 } } });
        transport.final(); transport.complete();
    };
    assert.equal((await service.generate(request)).status, 'completed');
});

for (const mismatch of ['model', 'effort', 'provider', 'cwd', 'ephemeral', 'instructions', 'sandbox'] as const) test(`thread ${mismatch} mismatch denies before turn`, async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.override = (method, params) => {
        if (method !== 'thread/start') return;
        const response = transport.thread(params);
        if (mismatch === 'model') response.model = 'substituted';
        if (mismatch === 'effort') response.reasoningEffort = 'low';
        if (mismatch === 'provider') response.modelProvider = 'other';
        if (mismatch === 'cwd') response.cwd = '/unexpected';
        if (mismatch === 'ephemeral') response.thread.ephemeral = false;
        if (mismatch === 'instructions') return { ...response, instructionSources: ['unexpected'] };
        if (mismatch === 'sandbox') response.sandbox.networkAccess = true;
        return response;
    };
    await assert.rejects(service.generate(request), errorCode('model_mismatch'));
    assert.equal(transport.calls.some(call => call.method === 'turn/start'), false); assert.equal(transport.closed, 1);
});

for (const mode of ['cancel', 'signal', 'owner', 'account', 'dispose', 'boundary'] as const) test(`${mode} invalidates late output`, async () => {
    let current = true; let boundary = true;
    const { service, transport } = setup({ isCurrent: () => current, boundaryQualified: () => boundary });
    const request = await selection(service); const controller = new AbortController();
    const pending = service.generate(request, controller.signal);
    const expected = mode === 'cancel' || mode === 'signal' ? 'canceled' : mode === 'boundary' ? 'unqualified_boundary' : 'revoked';
    const rejected = assert.rejects(pending, errorCode(expected));
    await started(transport);
    if (mode === 'cancel') void service.cancel();
    if (mode === 'signal') controller.abort();
    if (mode === 'owner') current = false;
    if (mode === 'boundary') boundary = false;
    if (mode === 'account') transport.listener('account/updated', { authMode: null });
    if (mode === 'dispose') void service.dispose();
    if (mode === 'owner' || mode === 'boundary') await new Promise(resolve => setTimeout(resolve, 70));
    transport.final(); transport.complete(); await rejected;
    assert.equal(transport.closed, 1);
    assert.equal(transport.calls.filter(call => call.method === 'turn/start').length, 1);
    if (mode === 'owner' || mode === 'boundary') assert.equal(transport.calls.some(call => call.method === 'turn/interrupt'), false);
    else assert.equal(transport.calls.filter(call => call.method === 'turn/interrupt').length, 1);
});

test('cancel while turn/start unresolved discards response and early final', async () => {
    const { service, transport } = setup(); const request = await selection(service); const hold = deferred<unknown>();
    transport.override = method => method === 'turn/start' ? hold.promise : undefined;
    const pending = service.generate(request); const rejected = assert.rejects(pending, errorCode('canceled'));
    await started(transport); transport.final(); await service.cancel();
    hold.resolve({ turn: { id: 'turn-1', items: [] } }); transport.complete(); await rejected;
    assert.equal(transport.closed, 1);
});

test('hanging request times out without retry', async () => {
    const { service, transport } = setup({ timeoutMs: 30 });
    transport.override = () => new Promise(() => {});
    await assert.rejects(service.readCatalog(), errorCode('timeout'));
    assert.equal(transport.calls.length, 1); assert.equal(transport.closed, 1);
});

test('busy operation does not invalidate the existing operation', async () => {
    const { service, transport } = setup(); const request = await selection(service);
    const pending = service.generate(request); await started(transport);
    await assert.rejects(service.readCatalog(), errorCode('busy'));
    transport.final(); transport.complete(); assert.equal((await pending).status, 'completed');
});

for (const type of ['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'collabAgentToolCall', 'functionCallOutput']) test(`deny ${type} and interrupt`, async () => {
    const { service, transport } = setup(); const request = await selection(service);
    const pending = service.generate(request); const rejected = assert.rejects(pending, errorCode('tool_use_denied'));
    await started(transport);
    transport.listener('item/started', { threadId: 'thread-1', turnId: 'turn-1', item: { type } });
    await rejected; assert.equal(transport.closed, 1);
    assert.equal(transport.calls.filter(call => call.method === 'turn/interrupt').length, 1);
});

for (const malformed of ['not json', { ...output, hidden: true }, { ...output, summary: 'x'.repeat(4001) }, { ...output, explanation: '' }, { ...output, citations: [{ sourceId: 'unknown', quote: 'Monday' }] }, { ...output, citations: [{ sourceId: source.id, quote: 'Tuesday' }] }, { ...output, citations: [] }, { ...output, citations: [output.citations[0], output.citations[0]] }]) test('malformed or unsupported output is minimized', async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.onTurn = () => { transport.final(malformed); transport.complete(); };
    await assert.rejects(service.generate(request), errorCode('invalid_output'));
});

test('reasoning bodies are never read and commentary/deltas are never output', async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.onTurn = () => {
        transport.listener('item/reasoning/textDelta', new Proxy({}, { get() { assert.fail('Reasoning body read'); } }));
        transport.listener('item/completed', { item: { type: 'reasoning', get content() { return assert.fail('Reasoning content read'); } } });
        transport.listener('item/completed', { item: { type: 'agentMessage', phase: 'commentary', text: 'Not final' } });
        transport.listener('item/agentMessage/delta', { delta: 'Not final' });
        transport.final(); transport.complete();
    };
    assert.equal((await service.generate(request)).summary, output.summary);
});

for (const mismatch of ['thread', 'turn'] as const) test(`early ${mismatch} mismatch rejects cross-session output`, async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.onTurn = () => { transport.final(output, mismatch === 'thread' ? 'foreign' : 'thread-1', mismatch === 'turn' ? 'foreign' : 'turn-1'); transport.complete(); };
    await assert.rejects(service.generate(request), errorCode('protocol_error'));
});

test('final in completion payload alone is never accepted', async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.onTurn = () => transport.complete('thread-1', 'turn-1', [{ type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(output) }]);
    await assert.rejects(service.generate(request), errorCode('invalid_output'));
});

for (const bound of ['pages', 'rows', 'cursor'] as const) test(`catalog ${bound} bounded`, async () => {
    const { service, transport } = setup(); let page = 0;
    transport.override = method => method === 'model/list' ? { data: bound === 'rows' ? Array.from({ length: 101 }, () => model) : [model], nextCursor: bound === 'cursor' ? 'repeat' : String(++page) } : undefined;
    await assert.rejects(service.readCatalog(), errorCode('protocol_error'));
    assert.ok(transport.calls.filter(call => call.method === 'model/list').length <= 10);
});

test('source identity and hashes validated before transport', () => {
    const transport = new FakeTransport();
    for (const sources of [[source, source], [{ ...source, sha256: 'bad' }]]) assert.throws(() => createSynthesisExecutionService({ transport, input: { ...input, sources }, cwd, isCurrent: () => true, boundaryQualified: () => true }), errorCode('invalid_request'));
    assert.equal(transport.calls.length, 0);
});

test('service has no clinical writer, filesystem, shell or transitive application runtime imports', () => {
    const code = readFileSync(new URL('./execution-service.ts', import.meta.url), 'utf8');
    const imports = [...code.matchAll(/^import\s+(?!type\b).*?from\s+'([^']+)'/gm)].map(match => match[1]);
    assert.deepEqual(imports, ['node:crypto', 'node:path', './execution-contract']);
    assert.match(code, /^import 'server-only';/m);
    assert.doesNotMatch(code, /\b(?:require|eval)\s*\(|import\s*\(|\bprocess\.|node:(?:fs|child_process|net|http)/);
    const contract = readFileSync(new URL('./execution-contract.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(contract, /^import\s+(?!type\b)/m);
});

test('account is re-read before generation and changed plan blocks the turn', async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.override = method => method === 'account/read' ? { account: { type: 'chatgpt', planType: 'free' } } : undefined;
    await assert.rejects(service.generate(request), errorCode('unsupported_account'));
    assert.equal(transport.calls.filter(call => call.method === 'account/read').length, 2);
    assert.equal(transport.calls.some(call => call.method === 'thread/start'), false);
});

test('pro account preserves ultra without remapping', async () => {
    const { service, transport } = setup();
    transport.override = method => method === 'account/read' ? { account: { type: 'chatgpt', planType: 'pro', email: 'fixture-account@example.invalid' } } : undefined;
    const catalog = await service.readCatalog(); const choice = catalog.choices.find(choice => choice.effort === 'ultra')!;
    transport.onTurn = () => { transport.final(); transport.complete(); };
    const result = await service.generate({ modelOptionId: choice.optionId, expectedCatalogRevision: catalog.revision });
    assert.equal(result.provenance.effort, 'ultra');
    assert.equal(transport.calls.find(call => call.method === 'turn/start')!.params.effort, 'ultra');
});

test('owner revoked inside an awaited RPC cannot cause another RPC', async () => {
    let current = true;
    const { service, transport } = setup({ isCurrent: () => current });
    transport.override = method => {
        if (method === 'account/read') { current = false; return { account: { type: 'chatgpt', planType: 'plus', email: 'fixture-account@example.invalid' } }; }
    };
    await assert.rejects(service.readCatalog(), errorCode('revoked'));
    assert.deepEqual(transport.calls.map(call => call.method), ['account/read']);
});

test('owner input is snapshotted, not mutable while awaiting generation', async () => {
    const mutableInput = { fixtureId: input.fixtureId, sources: [{ ...source }] };
    const { service, transport } = setup({ input: mutableInput });
    const request = await selection(service); mutableInput.sources[0].text = 'Changed after construction';
    transport.onTurn = () => { transport.final(); transport.complete(); };
    const result = await service.generate(request);
    assert.equal(result.sources[0].text, source.text);
    assert.equal(result.provenance.inputSha256, sha(JSON.stringify(input)));
});

test('account update during awaited process close still revokes output', async () => {
    const { service, transport } = setup(); const request = await selection(service); const hold = deferred<boolean>();
    transport.close = () => { transport.closed++; return hold.promise; };
    transport.onTurn = () => { transport.final(); transport.complete(); };
    const pending = service.generate(request); const rejected = assert.rejects(pending, errorCode('revoked'));
    await started(transport); assert.equal(transport.closed, 1);
    transport.listener('account/updated', {}); hold.resolve(true);
    await rejected;
});

test('hanging interrupt is bounded and always followed by process close', async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.override = method => method === 'turn/interrupt' ? new Promise(() => {}) : undefined;
    const pending = service.generate(request); const rejected = assert.rejects(pending, errorCode('canceled'));
    await started(transport); const began = Date.now(); await service.cancel(); await rejected;
    assert.ok(Date.now() - began < 1500); assert.equal(transport.closed, 1);
});

test('transport failures expose only the minimized code with no retry', async () => {
    const { service, transport } = setup();
    transport.override = () => Promise.reject(new Error('Provider text must not escape'));
    await assert.rejects(service.readCatalog(), errorCode('upstream_error'));
    assert.equal(transport.calls.length, 1); assert.equal(transport.closed, 1);
});

test('early notification buffer is bounded even before turn/start response', async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.onTurn = () => { for (let index = 0; index < 65; index++) transport.complete(); };
    await assert.rejects(service.generate(request), errorCode('protocol_error'));
    assert.equal(transport.closed, 1);
});

test('completed event must match selected thread and turn', async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.onTurn = () => { transport.final(); transport.complete('thread-1', 'foreign'); };
    await assert.rejects(service.generate(request), errorCode('protocol_error'));
});

test('a tool embedded in completed turn denies output', async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.onTurn = () => { transport.final(); transport.complete('thread-1', 'turn-1', [{ type: 'fileChange' }]); };
    await assert.rejects(service.generate(request), errorCode('tool_use_denied'));
});

test('caller cannot add source text or override model/provider', async () => {
    const { service, transport } = setup(); const request = await selection(service);
    await assert.rejects(service.generate({ ...request, text: 'Untrusted caller source' } as typeof request), errorCode('invalid_request'));
    assert.equal(transport.calls.some(call => call.method === 'thread/start'), false);
});

for (const primaryOnly of [true, false]) test(`valid ${primaryOnly ? 'primary' : 'secondary'}-only quota window is sufficient`, async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.override = method => method === 'account/rateLimits/read' ? { rateLimits: {
        primary: primaryOnly ? { usedPercent: 20, windowDurationMins: 300, resetsAt: null } : null,
        secondary: primaryOnly ? null : { usedPercent: 40, windowDurationMins: 10080, resetsAt: null },
    } } : undefined;
    transport.onTurn = () => { transport.final(); transport.complete(); };
    assert.equal((await service.generate(request)).status, 'completed');
});

for (const malformed of [{}, false, 'unknown', { usedPercent: null }, { usedPercent: NaN }]) test('a malformed supplied second window is not ignored', async () => {
    const { service, transport } = setup(); const request = await selection(service);
    transport.override = method => method === 'account/rateLimits/read' ? { rateLimits: { primary: { usedPercent: 10 }, secondary: malformed } } : undefined;
    await assert.rejects(service.generate(request), errorCode('limits_unavailable'));
});

for (const field of ['model', 'reasoningEffort']) test(`nullable Thread.${field} fails closed for a loaded thread`, async () => {
    const { service, transport } = setup(); const request = await selection(service);
    // Local 0.153.4 Thread.ts exports both nullable fields; top-level readback is concrete.
    transport.override = (method, params) => method === 'thread/start' ? { ...transport.thread(params), thread: { ...transport.thread(params).thread, [field]: null } } : undefined;
    await assert.rejects(service.generate(request), errorCode('model_mismatch'));
    assert.equal(transport.calls.some(call => call.method === 'turn/start'), false);
});

for (const scenario of ['same', 'changed', 'unknown', 'null-auth', 'external-auth', 'bad-plan'] as const) test(`account notice ${scenario} requires matching identity readback`, async () => {
    const { service, transport } = setup();
    let email: string | null = 'fixture-account@example.invalid';
    transport.override = method => method === 'account/read' ? { account: { type: 'chatgpt', planType: 'plus', email }, requiresOpenaiAuth: true } : undefined;
    const request = await selection(service);
    const pending = service.generate(request);
    const rejection = scenario === 'same' ? undefined : assert.rejects(pending, errorCode('revoked'));
    await started(transport);
    if (scenario === 'changed') email = 'other-fixture@example.invalid';
    if (scenario === 'unknown') email = null;
    transport.listener('account/updated', { authMode: scenario === 'null-auth' ? null : scenario === 'external-auth' ? 'chatgptAuthTokens' : 'chatgpt', planType: scenario === 'bad-plan' ? 'free' : 'plus' });
    transport.final(); transport.complete();
    if (rejection) await rejection;
    else {
        const result = await pending;
        assert.equal(result.status, 'completed');
        assert.equal(transport.calls.filter(call => call.method === 'account/read').length, 3);
        assert.ok(!JSON.stringify(result).includes('fixture-account'));
    }
    assert.ok(transport.calls.filter(call => call.method === 'account/read').every(call => call.params.refreshToken === false));
});

test('account notice with missing readback identity denies', async () => {
    const { service, transport } = setup(); const request = await selection(service);
    const pending = service.generate(request); const rejected = assert.rejects(pending, errorCode('revoked'));
    await started(transport);
    transport.override = method => method === 'account/read' ? { account: { type: 'chatgpt', planType: 'plus', email: null } } : undefined;
    transport.listener('account/updated', { authMode: 'chatgpt', planType: 'plus' });
    await rejected;
});

test('account change during readback is ambiguous and never retried', async () => {
    const { service, transport } = setup();
    transport.override = method => method === 'account/read' ? { account: { type: 'chatgpt', planType: 'plus', email: 'fixture@example.invalid' } } : undefined;
    const request = await selection(service);
    transport.override = method => {
        if (method !== 'account/read') return;
        transport.listener('account/updated', { authMode: 'chatgpt', planType: 'plus' });
        return { account: { type: 'chatgpt', planType: 'plus', email: 'fixture@example.invalid' } };
    };
    await assert.rejects(service.generate(request), errorCode('revoked'));
    assert.equal(transport.calls.filter(call => call.method === 'account/read').length, 2);
});

/* @Codex: ordinary malformed-readback regression, no real account or transport. */
for (const email of [undefined, null, '', '   ', 12, 'not-an-address', 'a@b\n', 'a b@example.invalid', 'x'.repeat(321) + '@example.invalid']) test('initial identity must be valid before catalog or turn', async () => {
    const { service, transport } = setup();
    transport.override = method => method === 'account/read' ? { account: { type: 'chatgpt', planType: 'plus', email } } : undefined;
    await assert.rejects(service.readCatalog(), errorCode('unsupported_account'));
    assert.deepEqual(transport.calls.map(call => call.method), ['account/read']);
    assert.equal(transport.closed, 1);
});

test('valid initial identity never appears in catalog or result', async () => {
    const { service, transport } = setup();
    const catalog = await service.readCatalog();
    transport.onTurn = () => { transport.final(); transport.complete(); };
    const result = await service.generate({ modelOptionId: catalog.choices[0].optionId, expectedCatalogRevision: catalog.revision });
    assert.ok(!JSON.stringify({ catalog, result }).includes('fixture-account@example.invalid'));
});

// The publication witness is service-local; an owner-bound caller still commits its resource use.
test('publication witness accepts only the exact current catalog, never clones or another service result', async () => {
    const first = setup(); const second = setup();
    try {
        const catalog = await first.service.readCatalog(); const foreign = await second.service.readCatalog();
        assert.equal(first.service.isCurrent(catalog), true);
        assert.equal(first.service.isCurrent({ ...catalog }), false);
        assert.equal(first.service.isCurrent(foreign), false);
        const next = await first.service.readCatalog();
        assert.equal(first.service.isCurrent(catalog), false); assert.equal(first.service.isCurrent(next), true);
    } finally { await first.service.dispose(); await second.service.dispose(); }
});

for (const action of ['cancel', 'dispose'] as const) test(`resolved catalog is not publishable after ${action}`, async () => {
    const { service } = setup();
    try {
        const catalog = await service.readCatalog();
        await service[action]();
        assert.equal(service.isCurrent(catalog), false);
    } finally { await service.dispose(); }
});

test('account notification invalidates a catalog witness until a fresh verified catalog is produced', async () => {
    const { service, transport } = setup();
    try {
        const catalog = await service.readCatalog();
        transport.listener('account/updated', { authMode: 'chatgpt', planType: 'plus' });
        assert.equal(service.isCurrent(catalog), false);
        const next = await service.readCatalog();
        assert.equal(service.isCurrent(catalog), false); assert.equal(service.isCurrent(next), true);
    } finally { await service.dispose(); }
});

for (const guard of ['false', 'throws'] as const) test(`publication witness fails closed when boundary qualification ${guard}`, async () => {
    let qualified = true;
    const { service } = setup({ boundaryQualified: () => { if (!qualified && guard === 'throws') throw new Error('synthetic-boundary-error'); return qualified; } });
    try {
        const catalog = await service.readCatalog(); qualified = false;
        assert.equal(service.isCurrent(catalog), false);
    } finally { await service.dispose(); }
});

for (const action of ['cancel', 'dispose', 'signal'] as const) test(`completed result remains locally valid after intentional transport close, but not after ${action}`, async () => {
    const { service, transport } = setup(); const controller = new AbortController();
    try {
        const catalog = await service.readCatalog();
        const request = { modelOptionId: catalog.choices[0].optionId, expectedCatalogRevision: catalog.revision };
        transport.onTurn = () => { transport.final(); transport.complete(); };
        const result = await service.generate(request, controller.signal);
        assert.equal(transport.closed, 1); assert.equal(service.isCurrent(result), true);
        assert.equal(service.isCurrent({ ...result }), false); assert.equal(service.isCurrent(catalog), false);
        if (action === 'signal') controller.abort(); else await service[action]();
        assert.equal(service.isCurrent(result), false);
    } finally { await service.dispose(); }
});

test('publication witness never re-enters the caller owner callback', async () => {
    let ownerReads = 0;
    const { service } = setup({ isCurrent: () => { ownerReads++; return true; } });
    try {
        const catalog = await service.readCatalog(); const readsAtHandoff = ownerReads;
        assert.equal(service.isCurrent(catalog), true);
        assert.equal(ownerReads, readsAtHandoff);
    } finally { await service.dispose(); }
});
