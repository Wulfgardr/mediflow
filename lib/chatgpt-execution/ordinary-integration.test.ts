void import.meta.url; // @Codex: explicit ESM for top-level mock setup.
/* @Codex — synthetic integration only. NER + external owner are TEST DOUBLES.
 * Positive transport tests additionally replace the CLOSED egress module using
 * the process-local synchronous test loader. This is not production admission or Mac/runtime proof. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockOrdinaryModule } from './ordinary-module.test-support.ts';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { syntheticOwner } from './ordinary-owner.test-support.ts';
import { profiles, outputs, configuration, tokenFrom } from './ordinary-content.test-support.ts';
import { readOrdinaryTaskProfile } from './ordinary-task-profile';
import type { ExecutionMethod, ExecutionCode, ExecutionTransport } from './execution-contract';
const directory = process.env.MEDIFLOW_DATA_DIR;
assert.ok(directory && isAbsolute(directory), 'Explicit synthetic MEDIFLOW_DATA_DIR required');
mkdirSync(directory, { recursive: true });
const owner = syntheticOwner();
mockOrdinaryModule(import.meta.url, '../security/web-auth-lifecycle-owner-adapter', { namedExports: owner.api });
let releaseNer: (() => void) | undefined, holdNer = false, nerClosed = 0;
mockOrdinaryModule(import.meta.url, '../gliner-redaction-runner', { namedExports: { readGlinerRuntimeObservation: () => null, createGlinerRedactionRunner: () => ({
    async extract(text: string) {
        if (holdNer) await new Promise<void>(resolve => { releaseNer = resolve; });
        return [...text.matchAll(/Bea Riva/gu)].map(match => ({ type: 'person', start: match.index, end: match.index + match[0].length, text: match[0], confidence: 1 }));
    }, async close() { nerClosed++; },
}) } });
const prep = await import('./ordinary-preparation');
const consents = await import('../chatgpt-product/product-consent');
const realGate = await import('./ordinary-egress-chokepoint');
const audit = await import('../ai-egress-audit');
const { ExecutionError } = await import('./execution-contract');
const { ProductError } = await import('../chatgpt-product/product-contract');
let testOnlyAllowContent = false;
let contentChecks = 0;
mockOrdinaryModule(import.meta.url, './ordinary-egress-chokepoint', { namedExports: {
    assertOrdinaryEgress(preparation: object, consent: object) {
        if (!testOnlyAllowContent) return realGate.assertOrdinaryEgress(preparation, consent);
        // Explicit test-only replacement. There is NO corresponding runtime switch.
        consents.assertOrdinaryProductConsent(consent, preparation);
        const read = prep.readPreparedOrdinaryProfile(preparation); contentChecks++;
        audit.appendChatGptEgressAudit({ payload: read.payload, lane: read.functionId, entityCounts: read.entityCounts, status: 'allowed' });
    },
} });
const { createOrdinaryExecutionService } = await import('./execution-service');
const { createOrdinaryProductAttempt } = await import('./ordinary-product-attempt');
const { expectedExecutionEnvironment, expectedExecutionConfig } = await import('./execution-login');
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const cwd = join(directory, 'ordinary-fixture', 'work');
const model = { model: 'exact-synthetic-model', hidden: false, inputModalities: ['text'], supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] };
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const rows = () => existsSync(audit.getEgressGateAuditPath()) ? readFileSync(audit.getEgressGateAuditPath(), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
class Peer implements ExecutionTransport {
    calls: { method: ExecutionMethod; params: Record<string, unknown> }[] = [];
    callbacks = new Set<(method: string, value: unknown) => void>();
    closed = 0; connected = true; pendingOutput = ''; modelsAvailable = true; quota = 1;
    onRequest?: (method: ExecutionMethod, params: Record<string, unknown>) => void | Promise<void>;
    closeHook?: () => Promise<void>;
    initialized() { /* fake peer protocol only */ }
    subscribe(callback: (method: string, value: unknown) => void, _failure: (code: ExecutionCode) => void) { this.callbacks.add(callback); return () => { this.callbacks.delete(callback); }; }
    emit(method: string, value: unknown) { for (const callback of [...this.callbacks]) callback(method, value); }
    async close() { this.closed++; await this.closeHook?.(); return true; }
    async request(method: ExecutionMethod, raw?: unknown): Promise<unknown> {
        const params = (raw ?? {}) as Record<string, unknown>; this.calls.push({ method, params });
        await this.onRequest?.(method, params);
        if (method === 'initialize') return { ...expectedExecutionEnvironment(cwd), userAgent: 'fixture_codex/0.153.4 (SYNTHETIC)' };
        if (method === 'config/read') return { config: expectedExecutionConfig(), origins: {}, layers: null };
        if (method === 'account/read') return { account: this.connected ? { type: 'chatgpt', email: 'fixture-only@example.invalid', planType: 'plus' } : null, requiresOpenaiAuth: !this.connected };
        if (method === 'account/login/start') return { type: 'chatgptDeviceCode', loginId: 'fixture-login', userCode: 'FAKE-ONLY', verificationUrl: 'https://auth.openai.com/fixture-never-navigate' };
        if (method === 'model/list') return { data: this.modelsAvailable ? [model] : [], nextCursor: null };
        if (method === 'account/rateLimits/read') return { rateLimitsByLimitId: { codex: { primary: { usedPercent: this.quota } } } };
        if (method === 'thread/start') return { thread: { id: 'thread-fixture', ephemeral: true, cwd, modelProvider: 'openai', model: params.model, reasoningEffort: 'medium', turns: [] }, model: params.model, modelProvider: 'openai', cwd, reasoningEffort: 'medium', approvalPolicy: 'never', instructionSources: [], sandbox: { type: 'readOnly', networkAccess: false }, serviceTier: 'priority' };
        if (method === 'turn/start') {
            if (this.pendingOutput) this.finish(this.pendingOutput);
            return { turn: { id: 'turn-fixture', items: [], status: 'inProgress' } };
        }
        if (method === 'turn/interrupt') return {};
        throw new Error(`Unexpected SYNTHETIC method ${method}`);
    }
    login() { this.connected = true; this.emit('account/login/completed', { loginId: 'fixture-login', success: true }); }
    finish(text: string) {
        this.emit('item/completed', { threadId: 'thread-fixture', turnId: 'turn-fixture', item: { type: 'agentMessage', phase: 'final_answer', text } });
        this.emit('turn/completed', { threadId: 'thread-fixture', turn: { id: 'turn-fixture', status: 'completed', items: [] } });
    }
}
async function context(index = 0, grant = true) {
    const profile = profiles()[index], session = owner.issue(), job = prep.createOrdinaryPreparation(profile, configuration);
    const handle = await job.ready, read = prep.readPreparedOrdinaryProfile(handle);
    const consent = await consents.createOrdinaryProductConsent(session as never, handle, { contextRevision: 'synthetic-original-owner-revision', attemptRevision: 'synthetic-attempt', qualificationRevision: 'synthetic-qualification', remainingMs: 50_000 });
    if (grant) consent.grant({ operation: read.functionId, expectedDisclosureRevision: consent.disclosure().revision });
    return { profile, session, job, handle, read, consent };
}
async function selection(service: ReturnType<typeof createOrdinaryExecutionService>) {
    const catalog = await service.readCatalog(); return { modelOptionId: catalog.choices[0].optionId, expectedCatalogRevision: catalog.revision };
}
function engine(value: Awaited<ReturnType<typeof context>>, peer = new Peer()) {
    const service = createOrdinaryExecutionService({ preparation: value.handle, consent: value.consent.token, transport: peer, cwd, isCurrent: () => true, boundaryQualified: () => true, timeoutMs: 3000 });
    return { service, peer };
}

test('real unchanged gate denies ordinary content before thread/turn and audits exact payload hash only', async () => {
    testOnlyAllowContent = false; const value = await context(), { service, peer } = engine(value);
    const count = rows().length;
    try {
        const request = await selection(service);
        await assert.rejects(service.generate(request), (error: unknown) => error instanceof ExecutionError && error.code === 'unqualified_boundary');
        assert.equal(peer.calls.some(call => ['thread/start', 'turn/start'].includes(call.method)), false);
        const row = rows().slice(count).find(row => row.payloadSha256 === value.read.payloadSha256);
        assert.equal(row.status, 'closed_pending_redaction_lane');
        assert.deepEqual(Object.keys(row).sort(), ['timestamp', 'payloadSha256', 'provider', 'lane', 'status', 'entityCounts'].sort());
        assert.ok(!JSON.stringify(row).includes('Bea Riva') && !JSON.stringify(row).includes('MF_PII'));
        assert.equal(peer.closed, 1); assert.equal(prep.isPreparedOrdinaryProfileCurrent(value.handle), false);
    } finally { await service.dispose(); await value.job.close(); }
});
for (const index of [0, 1, 2, 3]) test(`TEST-ONLY admitted peer roundtrip profile ${index}; exact disclosure/audit/transport, original parser and final binding`, async () => {
    testOnlyAllowContent = true; const value = await context(index), { service, peer } = engine(value);
    const count = contentChecks, offset = rows().length;
    try {
        const request = await selection(service), token = tokenFrom(value.read.content.input[0].text);
        const expected = JSON.stringify(outputs()[index]); peer.pendingOutput = expected.replaceAll('Bea Riva', token);
        const result = await service.generate(request);
        assert.equal(contentChecks - count, 2); // pre-thread AND exact turn/start
        const turn = peer.calls.find(call => call.method === 'turn/start')!.params;
        const wire = JSON.stringify({ input: turn.input, outputSchema: turn.outputSchema });
        assert.equal(wire, value.read.payload); assert.equal(sha(wire), value.consent.disclosure().payloadSha256);
        assert.equal(Buffer.byteLength(wire, 'utf8'), value.consent.disclosure().payloadBytes);
        for (const row of rows().slice(offset)) assert.equal(row.payloadSha256, sha(wire));
        assert.deepEqual(result.output, readOrdinaryTaskProfile(value.profile).parseOutput(expected));
        assert.equal(result.provenance.model, model.model); assert.equal(result.provenance.effort, 'medium');
        assert.equal(result.provenance.fallback, 'none'); assert.equal(result.clinicalWrites, 0);
        assert.ok(Object.isFrozen(result.output));
        assert.throws(() => { (result.output as unknown as Record<string, unknown>).summary = 'altered-after-decode'; });
        assert.ok(Object.isFrozen(turn.input) && Object.isFrozen(turn.outputSchema));
        assert.equal(peer.closed, 1); assert.equal(service.isCurrent(result), true);
        // This is a simulated owner commit, not the original clinical owner runtime.
        const port = owner.api.mintResourcePort(value.session)!, use = owner.api.beginResourceUse(port)!;
        let rendered = false;
        assert.equal(owner.api.withCurrentResourceBinding(use, () => { if (service.isCurrent(result)) rendered = true; }), true);
        assert.equal(rendered && owner.api.commitResourceUse(use), true); owner.api.releaseResourcePort(port);
        owner.retire(value.session); assert.equal(service.isCurrent(result), false);
        assert.equal(prep.isPreparedOrdinaryProfileCurrent(value.handle), false);
    } finally { await service.dispose(); await value.job.close(); testOnlyAllowContent = false; }
});

test('consent authenticates before session getters; copied/proxy/native-like sessions and fake grants denied', async () => {
    const value = await context(0, false); let reads = 0;
    const getter = Object.defineProperty({}, 'expiresAt', { get() { reads++; return Date.now() + 300000; } });
    for (const session of [{ ...value.session }, new Proxy(value.session, {}), getter, { type: 'native', expiresAt: Date.now() + 300000 }]) {
        await assert.rejects(consents.createOrdinaryProductConsent(session as never, value.handle, { contextRevision: 'c', attemptRevision: 'a', qualificationRevision: 'q', remainingMs: 1000 }));
    }
    assert.equal(reads, 0);
    assert.throws(() => consents.assertOrdinaryProductConsent({ granted: true, shadowReady: true }, value.handle));
    assert.throws(() => engine(value)); // ungranted authentic token
    value.consent.close(); await value.job.close(); await tick();
});
for (const mutation of ['payload', 'operation', 'revision', 'extra', 'getter', 'proxy', 'commit', 'binding-exception', 'retirement']) test(`ordinary consent denies ${mutation} and never manufactures a grant`, async () => {
    const value = await context(0, false); let reads = 0;
    const good = { operation: value.read.functionId, expectedDisclosureRevision: value.consent.disclosure().revision };
    let request: unknown = good;
    try {
        if (mutation === 'payload') {
            const other = await context(0, false);
            value.consent.grant(good);
            assert.throws(() => consents.assertOrdinaryProductConsent(value.consent.token, other.handle));
            other.consent.close(); await other.job.close(); return;
        }
        if (mutation === 'operation') request = { ...good, operation: 'smart_import' };
        if (mutation === 'revision') request = { ...good, expectedDisclosureRevision: '00000000-0000-0000-0000-000000000000' };
        if (mutation === 'extra') request = { ...good, payloadSha256: value.read.payloadSha256 };
        if (mutation === 'getter') request = { get operation() { reads++; return good.operation; }, expectedDisclosureRevision: good.expectedDisclosureRevision };
        if (mutation === 'proxy') request = new Proxy(good, {});
        if (mutation === 'commit') owner.stats.failCommit = true;
        if (mutation === 'binding-exception') owner.stats.throwBinding = true;
        if (mutation === 'retirement') owner.retire(value.session);
        assert.throws(() => value.consent.grant(request));
        assert.equal(consents.ordinaryConsentIsCurrent(value.consent.token, value.handle), false);
        assert.equal(reads, 0);
    } finally { owner.stats.failCommit = false; owner.stats.throwBinding = false; value.consent.close(); await value.job.close(); await tick(); }
});
for (const at of ['before-thread', 'during-thread', 'during-turn', 'during-close']) test(`source/session revocation ${at} suppresses content or late publication`, async () => {
    testOnlyAllowContent = true; const value = await context(), peer = new Peer(), { service } = engine(value, peer);
    try {
        const request = await selection(service);
        peer.pendingOutput = JSON.stringify(outputs()[0]).replaceAll('Bea Riva', tokenFrom(value.read.content.input[0].text));
        if (at === 'before-thread') value.consent.close();
        if (at === 'during-thread') peer.onRequest = method => { if (method === 'thread/start') owner.retire(value.session); };
        if (at === 'during-turn') peer.onRequest = method => { if (method === 'turn/start') owner.retire(value.session); };
        if (at === 'during-close') peer.closeHook = async () => { owner.retire(value.session); await tick(); };
        await assert.rejects(service.generate(request));
        if (at === 'before-thread' || at === 'during-thread') assert.equal(peer.calls.some(call => call.method === 'turn/start'), false);
        assert.equal(service.isCurrent({} as never), false);
    } finally { await service.dispose(); await value.job.close(); testOnlyAllowContent = false; }
});
for (const reason of ['model-removed', 'quota']) test(`${reason} denies before thread with no fallback`, async () => {
    testOnlyAllowContent = true; const value = await context(), { service, peer } = engine(value);
    try {
        const request = await selection(service); if (reason === 'model-removed') peer.modelsAvailable = false; else peer.quota = 100;
        await assert.rejects(service.generate(request));
        assert.equal(peer.calls.some(call => call.method === 'thread/start'), false);
    } finally { await service.dispose(); await value.job.close(); testOnlyAllowContent = false; }
});
function platform(peer: Peer) {
    let prepared = false, closed = false; const stats = { prepares: 0, transfers: 0 };
    const value = {
        snapshot: () => ({ platform: 'darwin', state: closed ? 'unqualified' : prepared ? 'qualified' : 'unqualified', revision: 'synthetic-qualification', missing: [] }),
        preparation: () => ({ state: closed ? 'closed' : prepared ? 'ready' : 'not_prepared', expiresAt: null }),
        async prepare() { prepared = true; stats.prepares++; },
        async create() { stats.transfers++; return { cwd, transport: peer, boundaryQualified: () => !closed && prepared, cleanupComplete: () => peer.closed > 0, close: () => peer.close() }; },
        async close() { closed = true; },
    };
    return { value, stats };
}

test('ordinary lifecycle uses one prepared host and existing login/catalogue; actual gate still blocks content', async () => {
    testOnlyAllowContent = false; const session = owner.issue(), peer = new Peer(); peer.connected = false;
    const p = platform(peer), attempt = await createOrdinaryProductAttempt(session as never, p.value as never), selection = new AbortController();
    try {
        const disclosure = await attempt.prepare(profiles()[0], 'source-selection-revision', configuration, selection.signal);
        assert.equal(p.stats.prepares, 1); assert.equal(p.stats.transfers, 0); assert.equal(peer.calls.length, 0);
        assert.ok(!JSON.stringify(attempt.snapshot()).includes('Bea Riva'));
        await attempt.consent({ operation: disclosure.operation, expectedDisclosureRevision: disclosure.revision });
        await attempt.loginStart(); assert.equal(p.stats.transfers, 1);
        await assert.rejects(attempt.loginComplete(), (error: unknown) => error instanceof ProductError && error.code === 'login_pending');
        assert.equal(attempt.snapshot().state, 'awaiting_login'); // nonterminal pending
        peer.login(); await attempt.loginComplete(); const catalog = await attempt.models();
        await assert.rejects(attempt.generate({ modelOptionId: catalog.choices[0].optionId, expectedCatalogRevision: catalog.revision }), (error: unknown) => error instanceof ExecutionError && error.code === 'unqualified_boundary');
        assert.equal(peer.calls.filter(call => call.method === 'initialize').length, 1);
        assert.equal(peer.calls.some(call => call.method === 'thread/start'), false);
        assert.equal((await attempt.dispose()).cleanupConfirmed, true);
    } finally { await attempt.dispose(); }
});

test('generic local preparation failure is bounded without changing typed execution failures', async () => {
    const session = owner.issue(), peer = new Peer(), p = platform(peer), attempt = await createOrdinaryProductAttempt(session as never, p.value as never);
    p.value.prepare = async () => { throw new Error('PRIVATE_PLATFORM_FAILURE'); };
    try {
        await assert.rejects(attempt.prepare(profiles()[0], 'owned-revision', configuration, new AbortController().signal),
            (error: unknown) => error instanceof ProductError && error.code === 'preparation_unavailable');
        assert.equal(peer.calls.length, 0);
    } finally { await attempt.dispose(); }
});

test('source switch during local NER invalidates synchronously, closes late work, never prepares native host', async () => {
    const session = owner.issue(), peer = new Peer(), p = platform(peer), attempt = await createOrdinaryProductAttempt(session as never, p.value as never);
    const selection = new AbortController(); holdNer = true; const before = nerClosed;
    const pending = attempt.prepare(profiles()[0], 'owned-revision', configuration, selection.signal);
    void pending.catch(() => {});
    try {
        for (let i = 0; i < 20 && !releaseNer; i++) await tick(); assert.ok(releaseNer);
        selection.abort(); releaseNer!(); await assert.rejects(pending);
        assert.equal(p.stats.prepares, 0); assert.equal(peer.calls.length, 0); assert.ok(nerClosed > before);
        assert.throws(() => attempt.snapshot());
    } finally { releaseNer?.(); holdNer = false; releaseNer = undefined; await attempt.dispose(); }
});

test('one preparation binds one consent owner/attempt; another authentic session cannot adopt or invalidate it', async () => {
    const value = await context(), sessionB = owner.issue();
    let second: Awaited<ReturnType<typeof consents.createOrdinaryProductConsent>> | undefined;
    try {
        await assert.rejects(async () => { second = await consents.createOrdinaryProductConsent(sessionB as never, value.handle,
            { contextRevision: 'other-context', attemptRevision: 'other-attempt', qualificationRevision: 'other-qualification', remainingMs: 5000 }); });
        assert.equal(consents.ordinaryConsentIsCurrent(value.consent.token, value.handle), true);
        consents.assertOrdinaryProductConsent(value.consent.token, value.handle);
    } finally { second?.close(); value.consent.close(); await value.job.close(); await tick(); }
});

test('private registrations are reclaimed in test owner; no callback re-enters owner', async () => {
    await tick(); assert.equal(owner.stats.reentries, 0); assert.equal(owner.stats.mints, owner.stats.releases);
});

// @Codex: the synthetic URL exception must never broaden runtime egress.
test('ordinary fixture URL exception is exact to one inert response line', async () => {
    const { isExternalUrlLiteralAllowed } = await import('../../scripts/check-never-regress.mjs');
    const source = readFileSync(new URL('./ordinary-integration.test.ts', import.meta.url), 'utf8');
    const line = source.split('\n').find(value => value.includes("verificationUrl:") && value.includes('fixture-never-navigate'))!;
    const path = 'lib/chatgpt-execution/ordinary-integration.test.ts';
    const url = 'https:' + '//auth.openai.com/fixture-never-navigate';
    assert.equal(isExternalUrlLiteralAllowed(path, url, line), true);
    assert.equal(isExternalUrlLiteralAllowed('lib/chatgpt-execution/ordinary-product-attempt.ts', url, line), false);
    assert.equal(isExternalUrlLiteralAllowed(path, url + '?changed', line.replace(url, url + '?changed')), false);
    assert.equal(isExternalUrlLiteralAllowed(path, url, line + ' https:' + '//unapproved.invalid'), false);
});
