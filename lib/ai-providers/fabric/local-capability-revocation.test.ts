import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import type { SmartImportProjection } from '../../smart-import-projection';
import type { ProviderLifecycleRead } from './provider-lifecycle-service';
import { createPatientInsightHostCapability } from './patient-insight-host-capability';
import { createPatientSmartImportHostCapability } from '../../domain/documents/patient-smart-import-host-capability';
import { routeHostResolvedCandidateCapability } from './candidate-router';
import { localProviderRegistry } from '../registry';
import { createFunctionModelDispatch, functionModelBindingSettings, guardFunctionModelResolution, holdFunctionModelSession } from './function-model-dispatch';
import { FUNCTION_SWITCH_KEYS, functionModelDigest, type FunctionModelId, type FunctionModelSources } from './function-model-preferences';

import * as owner from '@mediflow/web-auth-lifecycle-owner';

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
const answer = (id: FunctionModelId) => JSON.stringify({ schemaVersion: 'mediflow.ai.extract.v1', task: id, summary: 'Synthetic technical result [S1]',
    data: id === 'patient_insight' ? { currentState: ['Technical source [S1]'], alerts: [], nextSteps: [], gaps: [] } : { diagnoses: [], therapies: [], servicePrescriptions: [] } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function within<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([promise, new Promise<'timeout'>(done => { timer = setTimeout(() => done('timeout'), ms); })]).finally(() => clearTimeout(timer));
}

type ChatObservation = { started: number; disconnectedBeforeAnswer: boolean; answered: boolean };
async function syntheticOllama(t: TestContext, id: FunctionModelId) {
    const model = { name: 'synthetic-clinical:1', model: 'synthetic-clinical:1', size: 1234, digest: 'a'.repeat(64), details: { family: 'synthetic' } };
    const chats: ChatObservation[] = [];
    const entered = deferred<void>(), disconnected = deferred<void>();
    const pending: (() => void)[] = [];
    const server = http.createServer((request, response) => {
        const json = (value: unknown) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname === '/api/version') return json({ version: '0.40.6' });
        if (url.pathname === '/api/tags' || url.pathname === '/api/ps') return json({ models: [model] });
        if (url.pathname === '/api/show') return json({ details: model.details });
        if (url.pathname === '/api/generate') return json({ model: model.model });
        assert.equal(url.pathname, '/api/chat');
        const chat: ChatObservation = { started: Date.now(), disconnectedBeforeAnswer: false, answered: false };
        chats.push(chat);
        response.on('close', () => {
            if (!chat.answered) { chat.disconnectedBeforeAnswer = true; disconnected.resolve(); }
        });
        request.resume();
        request.on('end', () => {
            pending.push(() => {
                if (response.destroyed || response.writableEnded) return;
                chat.answered = true;
                json({ model: model.model, message: { content: answer(id) }, done_reason: 'stop', prompt_eval_count: 3, eval_count: 4 });
            });
            entered.resolve();
        });
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    t.after(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { endpoint, chats, entered: entered.promise, disconnected: disconnected.promise, release: () => { for (const answerNow of pending.splice(0)) answerNow(); } };
}

function session() {
    const control = owner.bootstrapControl();
    assert.ok(control);
    const attempt = owner.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: 'synthetic-idempotency-login-revocation' });
    const issued = owner.issue(attempt, { id: 'user.synthetic.revocation', username: ['clinician', 'synthetic', 'revocation'].join('.'), role: 'clinician' });
    assert.ok(issued);
    const active = () => {
        const resolution = owner.resolve(issued.sessionId, control.controlId);
        return resolution.status === 'active' ? resolution.projection : null;
    };
    const projection = active();
    assert.ok(projection);
    const digest = functionModelDigest(projection);
    return {
        owner, projection,
        authenticate: async () => active() ? digest : null,
        holdSession: async () => { const current = active(); return current ? holdFunctionModelSession(owner, current, digest) : null; },
        lock: () => owner.retire(projection, 'lock', { controlId: control.controlId, ifMatch: issued.etag, idempotencyKey: 'synthetic-idempotency-lock-revocation' }),
    };
}

async function fixture(t: TestContext, id: 'patient_insight' | 'smart_import') {
    const ollama = await syntheticOllama(t, id);
    const web = session();
    const settings: FunctionModelSources = { settings: { aiProvider: 'ollama', aiUrl: ollama.endpoint, aiModel_clinical: 'synthetic-clinical:1', aiModel_reasoning: 'synthetic-reasoning:1',
        ...Object.fromEntries(Object.values(FUNCTION_SWITCH_KEYS).map(key => [key, 'enabled'])) },
    ollamaLifecycle: { status: 'available', record: { version: 1, lifecycle: { provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' } } } };
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
    const results: unknown[] = [];
    const handler = createFunctionModelDispatch({ readSources: () => settings, authenticate: web.authenticate, holdSession: web.holdSession })(id, async () => {
        const result = id === 'patient_insight'
            ? await pi.preview({ requestId: 'request.synthetic.revoke.0001', projection: piProjection, currentness })
            : await si.preview({ handle: `prj_${'1'.repeat(32)}`, requestId: 'request.synthetic.revoke.0001' });
        results.push(result);
        return Response.json(result);
    });
    const run = () => handler(new Request(`http://localhost/api/ai/${id}/preview`, { method: 'POST' }));
    return { ollama, web, run, results };
}

for (const id of ['patient_insight', 'smart_import'] as const) {
    test(`${id}: an application lock during local inference closes the model connection and publishes nothing`, async t => {
        const f = await fixture(t, id);
        const work = f.run();
        await f.ollama.entered;
        assert.equal(f.web.lock().outcome, 'completed');
        const closed = await within(f.ollama.disconnected, 2000);
        f.ollama.release();
        const response = await work;
        assert.notEqual(closed, 'timeout', 'the lock must close the HTTP connection to the local model, not only deny publication');
        assert.equal(response.status, 401);
        assert.equal((await response.json()).code, 'session_stale');
        assert.deepEqual(f.ollama.chats.map(chat => ({ disconnectedBeforeAnswer: chat.disconnectedBeforeAnswer, answered: chat.answered })),
            [{ disconnectedBeforeAnswer: true, answered: false }]);
        assert.equal(f.results.some(result => (result as { status?: unknown }).status === 'available'), false);
        assert.equal(f.web.owner.mintResourcePort(f.web.projection), null);
    });
    test(`${id}: without a lock the same local inference completes and releases the session hold`, async t => {
        const f = await fixture(t, id);
        const work = f.run();
        await f.ollama.entered;
        f.ollama.release();
        const response = await work;
        assert.equal(response.status, 200);
        const value = await response.json();
        assert.equal(value.status, 'available'); assert.equal(value.writesPerformed, 0); assert.equal(value.apply, 'denied');
        assert.deepEqual(f.ollama.chats.map(chat => chat.answered), [true]);
        assert.equal(f.web.lock().outcome, 'completed');
    });
}

test('a session hold refuses a retired projection and aborts exactly once on lock', () => {
    const web = session();
    const hold = holdFunctionModelSession(web.owner, web.projection, 'digest.synthetic');
    assert.ok(hold);
    assert.equal(hold.revoked.aborted, false);
    assert.equal(web.lock().outcome, 'completed');
    assert.equal(hold.revoked.aborted, true);
    hold.release(); hold.release();
    assert.equal(holdFunctionModelSession(web.owner, web.projection, 'digest.synthetic'), null);
});
