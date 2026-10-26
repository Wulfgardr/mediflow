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
    athenaLifecycle: { status: 'denied', reason: 'missing' }, athenaIdentity: 'synthetic', athenaAvailable: false };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(t: TestContext, id: 'patient_insight' | 'smart_import') {
    const previous = globalThis.fetch, entered = deferred<void>();
    const model = { name: 'synthetic-clinical:1', model: 'synthetic-clinical:1', size: 1234, digest: 'a'.repeat(64), details: { family: 'synthetic' } };
    let signal: AbortSignal | undefined, aborts = 0, chats = 0, released = false;
    let releaseChat = () => {};
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
        const url = new URL(String(input)); assert.equal(url.origin, 'http://127.0.0.1:11434');
        calls.push(url.pathname);
        if (url.pathname === '/api/version') return Response.json({ version: '0.40.6' });
        if (url.pathname === '/api/tags' || url.pathname === '/api/ps') return Response.json({ models: [model] });
        if (url.pathname === '/api/show') return Response.json({ details: model.details });
        if (url.pathname === '/api/generate') return Response.json({ model: model.model });
        assert.equal(url.pathname, '/api/chat'); chats++;
        const payload = JSON.parse(String(init?.body)); assert.equal(payload.model, model.model);
        assert.equal(payload.options.num_predict, id === 'patient_insight' ? 900 : 1100);
        signal = init?.signal ?? undefined;
        return new Promise<Response>((done, reject) => {
            const stop = () => { aborts++; signal?.removeEventListener('abort', stop); reject(new DOMException('Synthetic aborted fetch', 'AbortError')); };
            releaseChat = () => { released = true; signal?.removeEventListener('abort', stop); done(Response.json({ model: model.model, message: { content: response(id) }, prompt_eval_count: 3, eval_count: 4 })); };
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
    const common = { killSwitch: { read: async () => ({ status: 'enabled' as const }) }, lifecycle: { read: () => lifecycle }, binding,
        readiness: { observeClinical: async () => ({ status: 'available' as const, code: null, observation: { venue: 'local_process' as const, state: 'available' as const, reason: null } }) },
        route: routeHostResolvedCandidateCapability, sources: { clock: () => at, entropy: () => new Uint8Array(16).fill(7) } };
    const pi = createPatientInsightHostCapability({ ...common, currentness: { verify: () => true } });
    const si = createPatientSmartImportHostCapability({ ...common, broker: { consume: () => siProjection } });
    const invoke = (extra: object = {}) => id === 'patient_insight'
        ? pi.preview({ requestId: 'request.synthetic.cancel.0001', projection: piProjection, currentness, ...extra })
        : si.preview({ handle: `prj_${'1'.repeat(32)}`, requestId: 'request.synthetic.cancel.0001', ...extra });
    const handler = createFunctionModelDispatch({ readSources: () => settings, authenticate: async () => 'synthetic-session' })(id,
        async () => Response.json(await invoke()));
    const run = (controller: AbortController) => handler(new Request('http://localhost/api/ai/' + id + '/preview', { method: 'POST', signal: controller.signal }));
    return { entered: entered.promise, run, invoke, release: () => releaseChat(), calls,
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
