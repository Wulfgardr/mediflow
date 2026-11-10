/* Actual local host capabilities, dispatch and Ollama adapter; fetch/auth seams
 * are synthetic. No daemon, model, provider network or clinical writer. */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { SmartImportProjection } from '../../smart-import-projection';
import type { ProviderLifecycleRead } from './provider-lifecycle-service';
import { createPatientInsightHostCapability } from './patient-insight-host-capability';
import { createPatientSmartImportHostCapability } from '../../domain/documents/patient-smart-import-host-capability';
import { routeHostResolvedCandidateCapability } from './candidate-router';
import { localProviderRegistry } from '../registry';
import { createFunctionModelDispatch, functionModelBindingSettings, guardFunctionModelResolution } from './function-model-dispatch';
import { FUNCTION_SWITCH_KEYS, type FunctionModelId, type FunctionModelSources } from './function-model-preferences';

const at = '2026-10-26T10:00:00.000Z';
const currentness = { selectionEpoch: 1, patientRevision: 1, projectionDigest: `sha256_${'a'.repeat(64)}`, capturedAt: at, verifiedAt: at };
const piProjection = { schemaVersion: 'mediflow.patient-insight.projection.v1' as const, clinicalFocus: 'Synthetic technical record', activeConditions: [], currentTherapies: [], recentClinicalEvents: [] };
const siProjection: SmartImportProjection = { schemaVersion: 'mediflow.smart-import.projection.v1', capability: 'smart_import',
    patientRef: 'patient.synthetic.0001', selectionEpoch: 1, patientRevision: 1, sourceRevision: 1, capturedAt: at,
    currentDiagnoses: [], currentActiveTherapies: [], therapyCandidateHints: [],
    sources: [{ id: 'source.synthetic.0001', kind: 'clinical-entry', label: 'Synthetic technical source', date: null, content: 'Technical fixture only' }] };
const lifecycle: Extract<ProviderLifecycleRead, { status: 'available' }> = { status: 'available', record: {
    schemaVersion: 'mediflow.ai.provider-lifecycle-record.v1', lifecycle: { schemaVersion: 'mediflow.ai.provider-lifecycle.v1', provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' },
    actorClass: 'host_service', actorRef: `actor_${'a'.repeat(32)}`, version: 1, hostTimestamp: at, receiptRef: `receipt_${'b'.repeat(32)}` } };
const response = (id: FunctionModelId) => JSON.stringify({ schemaVersion: 'mediflow.ai.extract.v1', task: id, summary: 'Synthetic technical result [S1]',
    data: id === 'patient_insight' ? { currentState: ['Technical source [S1]'], alerts: [], nextSteps: [], gaps: [] } : { diagnoses: [], therapies: [], servicePrescriptions: [] } });
function sources(): FunctionModelSources {
    return { settings: { aiProvider: 'ollama', aiUrl: 'http://127.0.0.1:11434', aiModel_clinical: 'synthetic-clinical:1', aiModel_reasoning: 'synthetic-reasoning:1',
        ...Object.fromEntries(Object.values(FUNCTION_SWITCH_KEYS).map(key => [key, 'enabled'])) },
    ollamaLifecycle: { status: 'available', record: { version: 1, lifecycle: { provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' } } },
    };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
type ChatBody = Readonly<{ content: string; done_reason?: 'stop' | 'length' }>;
function fixture(t: TestContext, id: 'patient_insight' | 'smart_import', mode: 'valid' | 'malformed' | 'unavailable' = 'valid',
    script: Readonly<{ bodies?: readonly ChatBody[]; onKillRead?: (read: number) => void }> = {}) {
    const previous = globalThis.fetch, entered = deferred<void>();
    const model = { name: 'synthetic-clinical:1', model: 'synthetic-clinical:1', size: 1234, digest: 'a'.repeat(64), details: { family: 'synthetic' } };
    let enabled = true, authenticated = true;
    let signal: AbortSignal | undefined, aborts = 0, chats = 0, released = false;
    let releaseChat = () => {};
    const calls: string[] = [], bodies: string[] = [];
    let killReads = 0;
    globalThis.fetch = async (input, init) => {
        const url = new URL(String(input)); assert.equal(url.origin, 'http://127.0.0.1:11434');
        calls.push(url.pathname);
        if (url.pathname === '/api/version') return Response.json({ version: '0.40.6' });
        if (url.pathname === '/api/tags' || url.pathname === '/api/ps') return Response.json({ models: mode === 'unavailable' ? [] : [model] });
        if (url.pathname === '/api/show') return Response.json({ details: model.details });
        if (url.pathname === '/api/generate') return Response.json({ model: model.model });
        assert.equal(url.pathname, '/api/chat'); const index = chats++;
        const payload = JSON.parse(String(init?.body)); assert.equal(payload.model, model.model);
        assert.equal(payload.options.num_predict, id === 'patient_insight' ? 900 : 1100);
        bodies.push(String(init?.body));
        signal = init?.signal ?? undefined;
        const scripted = script.bodies?.[Math.min(index, script.bodies.length - 1)];
        const body = scripted ?? { content: mode === 'malformed' ? '{malformed' : response(id), done_reason: 'stop' as const };
        const answer = () => Response.json({ model: model.model, message: { content: body.content }, done_reason: body.done_reason ?? 'stop', prompt_eval_count: 3, eval_count: body.done_reason === 'length' ? 900 : 4 });
        // Only the first chat waits for the test to release it; a second attempt answers at once.
        if (index > 0) return signal?.aborted ? Promise.reject(new DOMException('Synthetic aborted fetch', 'AbortError')) : answer();
        return new Promise<Response>((done, reject) => {
            const stop = () => { aborts++; signal?.removeEventListener('abort', stop); reject(new DOMException('Synthetic aborted fetch', 'AbortError')); };
            releaseChat = () => { released = true; signal?.removeEventListener('abort', stop); done(answer()); };
            signal?.addEventListener('abort', stop, { once: true });
            entered.resolve(); if (signal?.aborted) stop();
        });
    };
    t.after(() => { releaseChat(); globalThis.fetch = previous; });
    const settings = sources();
    const binding = { async readClinical() {
        const selected = await functionModelBindingSettings(settings.settings, 'clinical');
        const resolution = localProviderRegistry.resolve({ task: 'clinical', provider: 'ollama', models: { clinical: selected.aiModel_clinical! }, endpoint: selected.aiUrl!, chatTimeoutMs: 10000, disableThinking: true });
        return { status: 'available' as const, resolution: guardFunctionModelResolution(resolution) };
    } };
    const common = { killSwitch: { read: async () => { killReads++; script.onKillRead?.(killReads); return enabled ? { status: 'enabled' as const } : { status: 'denied' as const, code: 'disabled' as const }; } }, lifecycle: { read: () => lifecycle }, binding,
        readiness: { observeClinical: async () => ({ status: 'available' as const, code: null, observation: { venue: 'local_process' as const, state: 'available' as const, reason: null } }) },
        route: routeHostResolvedCandidateCapability, sources: { clock: () => at, entropy: () => new Uint8Array(16).fill(7) } };
    const pi = createPatientInsightHostCapability({ ...common, currentness: { verify: () => true } });
    const si = createPatientSmartImportHostCapability({ ...common, broker: { consume: () => siProjection } });
    const invoke = (extra: object = {}) => id === 'patient_insight'
        ? pi.preview({ requestId: 'request.synthetic.cancel.0001', projection: piProjection, currentness, ...extra })
        : si.preview({ handle: `prj_${'1'.repeat(32)}`, requestId: 'request.synthetic.cancel.0001', ...extra });
    const handler = createFunctionModelDispatch({ readSources: () => settings, authenticate: async () => authenticated ? 'synthetic-session' : null })(id,
        async () => Response.json(await invoke()));
    const run = (controller: AbortController) => handler(new Request('http://localhost/api/ai/' + id + '/preview', { method: 'POST', signal: controller.signal }));
    return { disable: () => { enabled = false; }, revoke: () => { authenticated = false; }, entered: entered.promise, run, invoke, release: () => releaseChat(), calls, bodies,
        observation: () => ({ fetchAborted: signal?.aborted === true, aborts, chats, released }) };
}
for (const id of ['patient_insight', 'smart_import'] as const) {
    test(`${id}: cancel reaches the actual adapter fetch before publication denial`, async t => {
        const f = fixture(t, id), controller = new AbortController();
        const work = f.run(controller); await f.entered;
        controller.abort();
        const cancellation = f.observation();
        if (!cancellation.fetchAborted) f.release(); // Reproduce the old lack of cancellation without waiting for a timeout.
        const result = await work;
        assert.equal(result.status, 401); assert.doesNotMatch(await result.text(), /Synthetic technical result/u);
        assert.equal(cancellation.fetchAborted, true, 'publication denial alone must not count as fetch cancellation');
        assert.equal(cancellation.aborts, 1); assert.equal(cancellation.chats, 1); assert.equal(cancellation.released, false);
        assert.equal(f.calls.filter(path => path === '/api/chat').length, 1);
    });
    test(`${id}: a current request keeps the exact adapter/model contract and publishes one review-only proposal`, async t => {
        const f = fixture(t, id), work = f.run(new AbortController()); await f.entered; f.release();
        const result = await work; assert.equal(result.status, 200);
        const value = await result.json(); assert.equal(value.status, 'available'); assert.equal(value.writesPerformed, 0); assert.equal(value.apply, 'denied');
        assert.equal(f.observation().aborts, 0); assert.equal(f.observation().chats, 1);
    });
    test(`${id}: an already-aborted request does not enter host/provider work`, async t => {
        const f = fixture(t, id), controller = new AbortController(); controller.abort();
        assert.equal((await f.run(controller)).status, 401); assert.deepEqual(f.calls, []);
    });
    test(`${id}: a caller cannot add a signal or authority field to the closed capability body`, async t => {
        const f = fixture(t, id);
        const result = await f.invoke({ signal: new AbortController().signal });
        assert.equal(result.status, 'denied'); assert.equal(result.code, 'input_invalid'); assert.deepEqual(f.calls, []);
    });
}

for (const id of ['patient_insight', 'smart_import'] as const) {
    test(`${id}/ollama: malformed output publishes no proposal and performs no writes`, async t => {
        const f = fixture(t, id, 'malformed'), work = f.run(new AbortController());
        await f.entered; f.release();
        const value = await (await work).json();
        assert.equal(value.code, 'proposal_invalid'); assert.equal(value.proposal, null);
        assert.equal(value.writesPerformed, 0); assert.equal(value.apply, 'denied');
    });
    test(`${id}/ollama: revoking the function during transport suppresses a valid proposal`, async t => {
        const f = fixture(t, id), work = f.run(new AbortController());
        await f.entered; f.disable(); f.release();
        const value = await (await work).json();
        assert.equal(value.code, 'kill_switch_disabled'); assert.equal(value.proposal, null);
        assert.equal(value.writesPerformed, 0); assert.equal(f.observation().chats, 1);
    });
    test(`${id}/ollama: missing permission denies before transport`, async t => {
        const f = fixture(t, id); f.revoke();
        assert.equal((await f.run(new AbortController())).status, 401); assert.deepEqual(f.calls, []);
    });
    test(`${id}/ollama: unavailable model is explicit and has no fallback`, async t => {
        const f = fixture(t, id, 'unavailable');
        const value = await (await f.run(new AbortController())).json();
        assert.equal(value.code, 'provider_failed'); assert.equal(value.proposal, null);
        assert.equal(value.writesPerformed, 0); assert.equal(f.observation().chats, 0);
    });
}

// Secondo tentativo del Quadro paziente attraverso l'adapter Ollama vero (fetch sintetico).
const overlong = JSON.stringify({ schemaVersion: 'mediflow.ai.extract.v1', task: 'patient_insight', summary: 'Synthetic technical result [S1]',
    data: { currentState: [`${'Synthetic overlong technical sentence '.repeat(7).slice(0, 225)} [S1]`], alerts: [], nextSteps: [], gaps: [] } });
const cut = Object.freeze({ content: response('patient_insight').slice(0, 90) + '], []], []]', done_reason: 'length' as const });

test('patient_insight/ollama: an overlong sentence then a valid answer publishes after two identical chat requests', async t => {
    const f = fixture(t, 'patient_insight', 'valid', { bodies: [{ content: overlong }, { content: response('patient_insight') }] });
    const work = f.run(new AbortController()); await f.entered; f.release();
    const result = await work; assert.equal(result.status, 200);
    const value = await result.json(); assert.equal(value.status, 'available'); assert.equal(value.writesPerformed, 0);
    assert.equal(f.observation().chats, 2); assert.equal(f.bodies[0], f.bodies[1]);
});
test('patient_insight/ollama: done_reason length then a valid answer publishes after two chat requests', async t => {
    const f = fixture(t, 'patient_insight', 'valid', { bodies: [cut, { content: response('patient_insight') }] });
    const work = f.run(new AbortController()); await f.entered; f.release();
    const value = await (await work).json(); assert.equal(value.status, 'available'); assert.equal(f.observation().chats, 2);
});
test('patient_insight/ollama: two invalid answers keep proposal_invalid and stop at two chat requests', async t => {
    const f = fixture(t, 'patient_insight', 'valid', { bodies: [{ content: overlong }, cut, { content: response('patient_insight') }] });
    const work = f.run(new AbortController()); await f.entered; f.release();
    const value = await (await work).json(); assert.equal(value.code, 'proposal_invalid'); assert.equal(value.proposal, null);
    assert.equal(f.observation().chats, 2);
});
test('patient_insight/ollama: cancelling the request between the attempts sends no second chat and publishes nothing', async t => {
    const controller = new AbortController();
    // Read 1 is the admission check; read 2 happens between the attempts.
    const f = fixture(t, 'patient_insight', 'valid', { bodies: [{ content: overlong }, { content: response('patient_insight') }],
        onKillRead: read => { if (read === 2) controller.abort(); } });
    const work = f.run(controller); await f.entered; f.release();
    const result = await work; assert.equal(result.status, 401); assert.doesNotMatch(await result.text(), /Synthetic technical result/u);
    assert.equal(f.observation().chats, 1);
});
test('smart_import/ollama: a malformed answer is still not retried (correction scoped to Patient Insight)', async t => {
    const f = fixture(t, 'smart_import', 'malformed'), work = f.run(new AbortController());
    await f.entered; f.release();
    const value = await (await work).json(); assert.equal(value.code, 'proposal_invalid'); assert.equal(f.observation().chats, 1);
});
