/* @Codex */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';
import { buildFunctionModelCatalog, createFunctionModelPreferencesService, FUNCTION_MODEL_IDS, FUNCTION_PREFERENCES_KEY,
    FUNCTION_SWITCH_KEYS, planFunctionModelUpdate, readFunctionModelPreferences, resolveFunctionModelDispatch,
    type FunctionModelCommand, type FunctionModelSources } from './function-model-preferences.ts';
import { createFunctionModelDispatch, FUNCTION_MODEL_CHOICE_HEADER, functionModelBindingSettings,
    guardFunctionModelResolution, captureFunctionModelTransportGuard } from './function-model-dispatch.ts';
import { issueSyntheticWebSession, retireSyntheticWebSession } from '../../security/web-auth-lifecycle-owner-test-fixture.ts';
import { createFunctionModelPreferencesHttp } from './function-model-preferences-http.ts';
import { localProviderRegistry } from '../registry.ts';
import { evaluateSettingsWrite } from '../../security/settings-write-policy.ts';

function fixture(): FunctionModelSources {
    const lifecycle = (provider: string) => ({ status: 'available', record: { version: 1,
        lifecycle: { status: 'available_unqualified', provider, credentialClass: 'local_model' } } });
    return { settings: { aiProvider: 'ollama', aiUrl: 'http://127.0.0.1:11434', aiModel_clinical: 'synthetic-clinical:1',
        aiModel_reasoning: 'synthetic-reasoning:1', ...Object.fromEntries(Object.values(FUNCTION_SWITCH_KEYS).map(key => [key, 'enabled'])) },
    ollamaLifecycle: lifecycle('ollama'), athenaLifecycle: lifecycle('athena_mlx'), athenaIdentity: 'synthetic-local-artifact-v1', athenaAvailable: true };
}
function setCommand(sources: FunctionModelSources, overrides: Partial<FunctionModelCommand> = {}): FunctionModelCommand {
    const view = readFunctionModelPreferences(sources);
    return { schemaVersion: 'mediflow.function-preferences-command.v1', commandId: randomUUID(), expectedRevision: view.revision,
        expectedCatalogRevision: view.catalogRevision, action: 'set', functionId: 'patient_insight', enabled: true,
        defaultModelOptionId: view.functions[0].options[1].modelOptionId, ...overrides } as FunctionModelCommand;
}
function preset(sources: FunctionModelSources, presetId: 'host_defaults' | 'all_off'): FunctionModelCommand {
    const view = readFunctionModelPreferences(sources);
    return { schemaVersion: 'mediflow.function-preferences-command.v1', commandId: randomUUID(), expectedRevision: view.revision,
        expectedCatalogRevision: view.catalogRevision, action: 'preset', presetId };
}
const request = (choice?: unknown, signal?: AbortSignal) => new Request('http://localhost/api/ai/patient-insight/preview', {
    method: 'POST', headers: choice === undefined ? {} : { [FUNCTION_MODEL_CHOICE_HEADER]: JSON.stringify(choice) }, signal });

test('host catalog has four allowed experiences, opaque IDs, no remote admission or endpoint in DTO', () => {
    const sources = fixture(); const catalog = buildFunctionModelCatalog(sources); const view = readFunctionModelPreferences(sources);
    assert.deepEqual(view.functions.map(row => row.id), FUNCTION_MODEL_IDS);
    assert.equal(catalog.bindings.length, 3);
    assert.equal(view.functions[3].options.length, 1);
    assert.match(view.functions[0].options[0].modelOptionId, /^model_option_[0-9a-f]{32}$/);
    assert.doesNotMatch(JSON.stringify(view), /127\.0\.0\.1|endpoint|credential|prompt|policy/);
    assert.equal(view.apply, 'denied');
    const unconfigured = { ...sources, ollamaLifecycle: { status: 'denied', reason: 'missing' } };
    assert.equal(readFunctionModelPreferences(unconfigured).functions[0].options[0].state, 'unavailable');
    assert.throws(() => resolveFunctionModelDispatch(unconfigured, 'patient_insight'), /provider_unavailable/);
    assert.deepEqual(unconfigured.ollamaLifecycle, { status: 'denied', reason: 'missing' });
});

test('persisted per-function default differs from request override, which never changes preferences', () => {
    let sources = fixture(); const original = resolveFunctionModelDispatch(sources, 'patient_insight');
    const plan = planFunctionModelUpdate(sources, setCommand(sources));
    sources = { ...sources, settings: { ...sources.settings, ...plan.writes } };
    const before = JSON.stringify(sources); const saved = resolveFunctionModelDispatch(sources, 'patient_insight');
    assert.equal(saved.binding.model, 'synthetic-reasoning:1'); assert.equal(saved.source, 'saved_preference');
    const override = resolveFunctionModelDispatch(sources, 'patient_insight', {
        expectedCatalogRevision: saved.catalogRevision, modelOptionId: original.binding.modelOptionId });
    assert.equal(override.binding.model, 'synthetic-clinical:1'); assert.equal(override.source, 'request_override');
    assert.equal(JSON.stringify(sources), before);
    assert.equal(resolveFunctionModelDispatch(sources, 'patient_insight').binding.model, 'synthetic-reasoning:1');
    assert.equal(resolveFunctionModelDispatch(sources, 'smart_import').binding.model, 'synthetic-clinical:1');
});

test('unsupported functions, free model IDs, stale catalog, disabled and unavailable providers fail without fallback', () => {
    const sources = fixture(); const view = readFunctionModelPreferences(sources); const option = view.functions[0].options[0].modelOptionId;
    for (const id of FUNCTION_MODEL_IDS) {
        assert.throws(() => resolveFunctionModelDispatch({ ...sources, settings: { ...sources.settings, [FUNCTION_SWITCH_KEYS[id]]: 'disabled' } }, id), /function_disabled/);
    }
    assert.throws(() => resolveFunctionModelDispatch(sources, 'ocr' as never), /unsupported/);
    assert.throws(() => resolveFunctionModelDispatch(sources, 'treatment_reasoning', { modelOptionId: option, expectedCatalogRevision: view.catalogRevision }), /unsupported/);
    assert.throws(() => resolveFunctionModelDispatch(sources, 'patient_insight', { modelOptionId: 'arbitrary-model', expectedCatalogRevision: view.catalogRevision }), /input_invalid/);
    assert.throws(() => resolveFunctionModelDispatch(sources, 'patient_insight', { modelOptionId: `model_option_${'0'.repeat(32)}`, expectedCatalogRevision: view.catalogRevision }), /model_not_cataloged/);
    assert.throws(() => resolveFunctionModelDispatch(sources, 'patient_insight', { modelOptionId: option, expectedCatalogRevision: `sha256_${'0'.repeat(64)}` }), /catalog_stale/);
    assert.throws(() => resolveFunctionModelDispatch({ ...sources, athenaAvailable: false }, 'treatment_reasoning'), /provider_unavailable/);
    for (const status of ['degraded', 'revoked']) {
        const unavailable = { ...sources, ollamaLifecycle: { status: 'available', record: { lifecycle: { provider: 'ollama', credentialClass: 'local_model', status } } } };
        assert.throws(() => resolveFunctionModelDispatch(unavailable, 'smart_import'), /provider_unavailable/);
    }
});

test('saved stale binding is visible and denied after config/lifecycle change, without resetting state', () => {
    const sources = fixture(); const plan = planFunctionModelUpdate(sources, setCommand(sources));
    const changed = { ...sources, settings: { ...sources.settings, ...plan.writes, aiModel_reasoning: 'synthetic-new:2' } };
    const before = JSON.stringify(changed);
    assert.equal(readFunctionModelPreferences(changed).functions[0].bindingState, 'stale');
    assert.throws(() => resolveFunctionModelDispatch(changed, 'patient_insight'), /catalog_stale/);
    assert.equal(JSON.stringify(changed), before);
    assert.throws(() => planFunctionModelUpdate(changed, setCommand(sources)), /catalog_stale/);
});

test('closed commands, stale revision, duplicate command collision and corrupt persisted state are denied', () => {
    const sources = fixture(); const command = setCommand(sources); const plan = planFunctionModelUpdate(sources, command);
    const saved = { ...sources, settings: { ...sources.settings, ...plan.writes } };
    assert.deepEqual(planFunctionModelUpdate(saved, command).writes, {});
    assert.throws(() => planFunctionModelUpdate(saved, { ...command, enabled: false }), /command_conflict/);
    assert.throws(() => planFunctionModelUpdate(saved, { ...command, commandId: randomUUID() }), /revision_conflict/);
    for (const extra of ['provider', 'model', 'endpoint', 'prompt', 'policy', 'apply', 'onboarding']) {
        assert.throws(() => planFunctionModelUpdate(sources, { ...command, [extra]: 'forbidden' }), /input_invalid/);
    }
    assert.throws(() => readFunctionModelPreferences({ ...sources, settings: { ...sources.settings, [FUNCTION_PREFERENCES_KEY]: '{bad' } }), /state_corrupt/);
    // Existing settings cards can change switches, but cannot evade CAS in the new owner.
    const changedSwitch = { ...sources, settings: { ...sources.settings, aiSmartImportKillSwitch: 'disabled' } };
    assert.throws(() => planFunctionModelUpdate(changedSwitch, command), /revision_conflict/);
    for (const authChannel of ['web', 'system', 'native'] as const) assert.equal(evaluateSettingsWrite(FUNCTION_PREFERENCES_KEY,
        { authChannel, role: 'admin' } as never).allowed, false);
});

test('SQLite preset preview/apply/reread is atomic, idempotent and durable across a fresh process', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-function-models-'));
    const file = path.join(directory, 'synthetic.db'); const database = new Database(file); const source = fixture();
    database.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    for (const [key, value] of Object.entries(source.settings)) database.prepare('INSERT INTO settings VALUES (?, ?)').run(key, value);
    const readSources = (): FunctionModelSources => ({ ...source, settings: Object.fromEntries((database.prepare('SELECT key,value FROM settings').all() as {key:string; value:string}[]).map(row => [row.key,row.value])) });
    const service = createFunctionModelPreferencesService({ readSources, immediate: callback => database.transaction(callback).immediate(),
        writeSettings(writes) { for (const [key,value] of Object.entries(writes)) database.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value); } });
    try {
        const before = service.read(); const command = preset(readSources(), 'all_off');
        const preview = service.preview(command); assert.equal(preview.writesPerformed, 0); assert.deepEqual(service.read(), before);
        const applied = service.apply(command); assert.deepEqual(service.read(), applied); assert.deepEqual(service.apply(command), applied);
        assert.ok(applied.functions.every(row => !row.enabled));
        const child = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', '--input-type=module', '-e',
            `import Database from 'better-sqlite3'; import {readFunctionModelPreferences} from './lib/ai-providers/fabric/function-model-preferences.ts';
            const db=new Database(${JSON.stringify(file)},{readonly:true});
            const settings=Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r=>[r.key,r.value]));
            process.stdout.write(JSON.stringify(readFunctionModelPreferences({...${JSON.stringify(source)},settings})));db.close();`], { encoding: 'utf8' });
        assert.equal(child.status, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout), applied);
        const reset = preset(readSources(), 'host_defaults'); service.apply(reset);
        assert.ok(service.read().functions.every(row => row.defaultSource === 'host_configuration' && !row.enabled));
        // A failed reread rolls all writes back inside the same transaction.
        const rollbackService = createFunctionModelPreferencesService({ readSources, immediate: cb => database.transaction(cb).immediate(),
            writeSettings(writes) { for (const [key,value] of Object.entries(writes)) database.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
                database.prepare('UPDATE settings SET value=? WHERE key=?').run('changed-after-plan', 'aiModel_reasoning'); } });
        const baseline = service.read(); assert.throws(() => rollbackService.apply(preset(readSources(), 'all_off')), /binding_stale/); assert.deepEqual(service.read(), baseline);
    } finally { database.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('dispatch isolates simultaneous default and override requests and binds the existing role reader', async () => {
    const sources = fixture(); const catalog = buildFunctionModelCatalog(sources); let calls = 0;
    const wrapper = createFunctionModelDispatch({ authenticate: async () => 'synthetic-session', readSources: () => sources });
    const handler = wrapper('patient_insight', async () => {
        const settings = await functionModelBindingSettings(sources.settings, 'clinical');
        const resolution = localProviderRegistry.resolve({ task: 'clinical', provider: 'ollama', models: { clinical: settings.aiModel_clinical! }, endpoint: sources.settings.aiUrl!, chatTimeoutMs: 1_000 });
        resolution.adapter.chat = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return { content: 'synthetic', stats: { latency: 1, tokensIn: 1, tokensOut: 1 } }; };
        const guarded = guardFunctionModelResolution(resolution); await guarded.adapter.chat([]);
        return Response.json({ model: guarded.adapter.getModel(), apply: 'denied' });
    });
    const responses = await Promise.all([handler(request()), handler(request({ modelOptionId: catalog.bindings[1].modelOptionId, expectedCatalogRevision: catalog.revision }))]);
    assert.deepEqual(await responses[0].json(), { model: 'synthetic-clinical:1', apply: 'denied' });
    assert.deepEqual(await responses[1].json(), { model: 'synthetic-reasoning:1', apply: 'denied' });
    assert.equal(responses[1].headers.get('x-mediflow-model-source'), 'request_override'); assert.equal(calls, 2);
    assert.equal(sources.settings[FUNCTION_PREFERENCES_KEY], undefined);
    assert.equal((await functionModelBindingSettings(sources.settings, 'clinical')).aiModel_clinical, 'synthetic-clinical:1');
});

test('scope rechecks session, revocation, patient cancellation, disabled function and binding before/after transport', async () => {
    for (const event of ['session', 'revoked', 'patient', 'disabled', 'binding']) {
        for (const timing of ['before', 'during']) {
            let sources = fixture(); let session: string | null = 'synthetic-session'; const abort = new AbortController(); let calls = 0;
            const change = () => {
                if (event === 'session') session = null;
                if (event === 'patient') abort.abort(); // Client selection owner aborts a changed-patient request.
                if (event === 'revoked') sources = { ...sources, ollamaLifecycle: { status: 'denied', reason: 'unavailable' } };
                if (event === 'disabled') sources = { ...sources, settings: { ...sources.settings, aiPatientInsightKillSwitch: 'disabled' } };
                if (event === 'binding') sources = { ...sources, settings: { ...sources.settings, aiModel_clinical: 'synthetic-changed:2' } };
            };
            const handler = createFunctionModelDispatch({ authenticate: async () => session, readSources: () => sources })('patient_insight', async () => {
                const verify = captureFunctionModelTransportGuard('ollama', 'synthetic-clinical:1', 'http://127.0.0.1:11434');
                if (timing === 'before') change();
                await verify(); calls++;
                if (timing === 'during') change();
                await verify(); return Response.json({ proposal: 'must not publish' });
            });
            const response = await handler(request(undefined, abort.signal)); assert.notEqual(response.status, 200, `${event}/${timing}`);
            assert.equal(calls, timing === 'before' ? 0 : 1); assert.doesNotMatch(await response.text(), /must not publish/);
        }
    }
});

test('unauthenticated, arbitrary query/header and unsupported requests never enter production handlers', async () => {
    let calls = 0; const sources = fixture(); let session: string | null = null;
    const handler = createFunctionModelDispatch({ authenticate: async () => session, readSources: () => sources })('patient_insight', async () => { calls++; return Response.json({}); });
    assert.equal((await handler(request())).status, 401); session = 'synthetic-session';
    assert.equal((await handler(new Request('http://localhost/api/ai/patient-insight/preview?model=free', { method: 'POST' }))).status, 400);
    assert.equal((await handler(request({ model: 'free' }))).status, 400);
    assert.equal((await handler(request({ modelOptionId: `model_option_${'0'.repeat(32)}`, expectedCatalogRevision: buildFunctionModelCatalog(sources).revision }))).status, 400);
    assert.equal(calls, 0);
});

test('authenticated settings HTTP is bounded, read-only on GET/preview, and rechecks lock before applying', async (t) => {
    const session = issueSyntheticWebSession({ id: 'synthetic-preferences-user', username: 'synthetic', role: 'admin' }, randomUUID());
    t.after(() => retireSyntheticWebSession(session));
    let sources = fixture(); let writes = 0; let authenticated = true;
    const service = createFunctionModelPreferencesService({ readSources: () => sources, immediate: cb => cb(), writeSettings(next) {
        writes += Object.keys(next).length; sources = { ...sources, settings: { ...sources.settings, ...next } };
    } });
    const handlers = createFunctionModelPreferencesHttp({ authenticate: async () => authenticated ? session : null, service });
    const post = (body: unknown) => new Request('http://localhost/api/settings/ai/functions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const command = preset(sources, 'all_off');
    assert.equal((await handlers.GET(new Request('http://localhost/api/settings/ai/functions'))).status, 200);
    assert.equal((await handlers.PREVIEW(post(command))).status, 200); assert.equal(writes, 0);
    assert.equal((await handlers.POST(post({ ...command, arbitrary: true }))).status, 400); assert.equal(writes, 0);
    assert.equal((await handlers.POST(post('x'.repeat(5000)))).status, 400); assert.equal(writes, 0);
    let authCalls = 0;
    const locked = createFunctionModelPreferencesHttp({ authenticate: async () => ++authCalls === 1 ? session : null, service });
    assert.equal((await locked.POST(post(command))).status, 401); assert.equal(writes, 0);
    assert.equal((await handlers.POST(post(command))).status, 200); assert.equal(writes, 5);
    const reread = await handlers.GET(new Request('http://localhost/api/settings/ai/functions'));
    assert.deepEqual(await reread.json(), service.read());
    assert.equal((await handlers.POST(post(command))).status, 200); assert.equal(writes, 5);
    authenticated = false; assert.equal((await handlers.GET(new Request('http://localhost/api/settings/ai/functions'))).status, 401);
});

/* @Codex */
test('invalid explicit model roles and remote provider configuration do not fall back to another configured role', () => {
    const sources = fixture();
    for (const aiModel_clinical of ['', '  ', 'synthetic:cloud']) {
        const invalid = { ...sources, settings: { ...sources.settings, aiModel_clinical } };
        assert.equal(buildFunctionModelCatalog(invalid).hostDefaults.patient_insight, null);
        assert.throws(() => resolveFunctionModelDispatch(invalid, 'patient_insight'), /model_not_cataloged/);
        assert.equal(resolveFunctionModelDispatch(invalid, 'document_synthesis').binding.model, 'synthetic-reasoning:1');
    }
    const remote = { ...sources, settings: { ...sources.settings, aiProvider: 'chatgpt' } };
    assert.equal(buildFunctionModelCatalog(remote).bindings.length, 1);
    assert.throws(() => resolveFunctionModelDispatch(remote, 'patient_insight'), /model_not_cataloged/);
});

/* @Codex */
test('all four functions can persist their admitted binding and disable independently', () => {
    let sources = fixture();
    for (const functionId of FUNCTION_MODEL_IDS) {
        const row = readFunctionModelPreferences(sources).functions.find(item => item.id === functionId)!;
        const enabled = planFunctionModelUpdate(sources, setCommand(sources, { functionId, enabled: true, defaultModelOptionId: row.options[0].modelOptionId }));
        sources = { ...sources, settings: { ...sources.settings, ...enabled.writes } };
        assert.equal(resolveFunctionModelDispatch(sources, functionId).source, 'saved_preference');
        const disabled = planFunctionModelUpdate(sources, setCommand(sources, { functionId, enabled: false, defaultModelOptionId: row.options[0].modelOptionId }));
        sources = { ...sources, settings: { ...sources.settings, ...disabled.writes } };
        assert.throws(() => resolveFunctionModelDispatch(sources, functionId), /function_disabled/);
    }
});

test('ATHENA named dispatch accepts only its dedicated binding and preserves terminal checks', async () => {
    const sources = fixture(); let calls = 0;
    const handler = createFunctionModelDispatch({ authenticate: async () => 'synthetic-session', readSources: () => sources })('treatment_reasoning', async () => {
        const verify = captureFunctionModelTransportGuard('athena_mlx'); await verify(); calls++; await verify();
        return Response.json({ apply: 'denied' });
    });
    const result = await handler(request()); assert.equal(result.status, 200); assert.equal(calls, 1);
    assert.equal(result.headers.get('x-mediflow-model-source'), 'host_configuration');
});

/* @Codex: ordinary request streams; all session state is synthetic and process-local. */
function httpFixture(t: { after(callback: () => void): void }) {
    const session = issueSyntheticWebSession({ id: `synthetic-${randomUUID()}`, username: 'synthetic', role: 'admin' }, randomUUID());
    t.after(() => retireSyntheticWebSession(session));
    let sources = fixture(); let writes = 0;
    const service = createFunctionModelPreferencesService({ readSources: () => sources, immediate: callback => callback(), writeSettings(next) {
        writes++; sources = { ...sources, settings: { ...sources.settings, ...next } };
    } });
    return { session, service, command: preset(sources, 'all_off'), writes: () => writes };
}

function streamedRequest(signal?: AbortSignal) {
    let cancelled = 0;
    let opened!: () => void;
    const reading = new Promise<void>(resolve => { opened = resolve; });
    const stream = new ReadableStream<Uint8Array>({
        pull() { opened(); return new Promise<void>(() => {}); },
        cancel() { cancelled++; },
    }, { highWaterMark: 0 });
    const request = new Request('http://localhost/api/settings/ai/functions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, signal,
        duplex: 'half',
    } as RequestInit);
    return { request, reading, cancelled: () => cancelled };
}

test('HTTP pending body times out, cancels the reader and never writes', async (t) => {
    const f = httpFixture(t); const stream = streamedRequest();
    const handlers = createFunctionModelPreferencesHttp({ authenticate: async () => f.session, service: f.service });
    const response = await handlers.POST(stream.request);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'input_invalid');
    assert.equal(stream.cancelled(), 1); assert.equal(f.writes(), 0);
    assert.equal(stream.request.body!.locked, false);
});

for (const interrupt of ['request', 'owner'] as const) {
    test(`HTTP pending body cancels on ${interrupt} retirement without writes`, async (t) => {
        const f = httpFixture(t); const controller = new AbortController(); const stream = streamedRequest(controller.signal);
        const handlers = createFunctionModelPreferencesHttp({ authenticate: async () => f.session, service: f.service });
        const pending = handlers.POST(stream.request);
        await stream.reading;
        if (interrupt === 'request') controller.abort(); else retireSyntheticWebSession(f.session);
        const response = await pending;
        assert.equal(response.status, 401); assert.equal((await response.json()).code, 'session_stale');
        assert.equal(stream.cancelled(), 1); assert.equal(f.writes(), 0);
        assert.equal(stream.request.body!.locked, false);
    });
}

test('HTTP strict reader accepts 4096 bytes and rejects overflow and duplicate keys', async (t) => {
    const f = httpFixture(t);
    const handlers = createFunctionModelPreferencesHttp({ authenticate: async () => f.session, service: f.service });
    const json = JSON.stringify(f.command);
    const body = json + ' '.repeat(4096 - new TextEncoder().encode(json).byteLength);
    const post = (text: string) => new Request('http://localhost/api/settings/ai/functions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text,
    });
    assert.equal((await handlers.PREVIEW(post(body))).status, 200);
    assert.equal((await handlers.POST(post(body + ' '))).status, 400);
    assert.equal((await handlers.POST(post('{"action":"set","action":"preset"}'))).status, 400);
    assert.equal(f.writes(), 0);
});

test('HTTP owner retired while reauthentication resolves cannot apply or publish', async (t) => {
    const f = httpFixture(t); let calls = 0;
    const handlers = createFunctionModelPreferencesHttp({ authenticate: async () => {
        if (++calls === 2) retireSyntheticWebSession(f.session);
        return f.session;
    }, service: f.service });
    const response = await handlers.POST(new Request('http://localhost/api/settings/ai/functions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f.command),
    }));
    assert.equal(response.status, 401); assert.equal(f.writes(), 0);
    assert.equal((await handlers.GET(new Request('http://localhost/api/settings/ai/functions'))).status, 401);
});

test('HTTP reread checks owner again before publishing the response', async (t) => {
    const f = httpFixture(t);
    const handlers = createFunctionModelPreferencesHttp({ authenticate: async () => f.session,
        service: { ...f.service, read() { const view = f.service.read(); retireSyntheticWebSession(f.session); return view; } } });
    const response = await handlers.GET(new Request('http://localhost/api/settings/ai/functions'));
    assert.equal(response.status, 401); assert.equal((await response.json()).code, 'session_stale');
    assert.equal(f.writes(), 0);
});
