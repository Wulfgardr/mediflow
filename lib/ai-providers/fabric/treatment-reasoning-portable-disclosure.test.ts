/* @Codex: synthetic contracts and process-local owner; not clinical/runtime qualification. */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ATHENA_R1_QWEN3_8B_MODEL_ID } from '../../athena-model-identity';
import { assessPortableHardware, type PortableStatus } from './treatment-reasoning-portable-provisioning';
import { buildTreatmentReasoningPortableDisclosure, parseTreatmentReasoningPortableDisclosure,
    parsePortableFabricStatusEnvelope, FABRIC_STATUS_VERSION_HEADER, portablePrerequisiteText } from './treatment-reasoning-portable-disclosure';
import { buildFabricStatusSnapshot, buildPortableFabricStatusSnapshot } from './status';
import { readFunctionModelPreferences, buildFunctionModelCatalog, createFunctionModelPreferencesService, planFunctionModelUpdate,
    parseFunctionModelCommand, resolveFunctionModelDispatch, FUNCTION_PREFERENCES_KEY, FUNCTION_SWITCH_KEYS,
    FUNCTION_PREFERENCES_VERSION_HEADER, type FunctionModelSources, type FunctionModelCommand } from './function-model-preferences';
import { parsePreferences, parsePreview, createPreferencesClient } from '../../function-models/browser';
import { createFunctionModelPreferencesHttp } from './function-model-preferences-http';
import { issueSyntheticWebSession, retireSyntheticWebSession } from '../../security/web-auth-lifecycle-owner-test-fixture';

const hardware = () => assessPortableHardware({ platform: 'linux', nodeArchitecture: 'arm64', machineArchitecture: 'aarch64',
    totalMemoryBytes: 64 * 1024 ** 3, availableMemoryBytes: 60 * 1024 ** 3, logicalCpus: 8 });
const status = (state: PortableStatus['state'] = 'NEEDS_CONTEXT'): PortableStatus => ({
    schemaVersion: 'mediflow.treatment-portable-status.v1', provider: 'athena_transformers', model: ATHENA_R1_QWEN3_8B_MODEL_ID,
    state, selected: state === 'admitted', releaseDigest: state === 'admitted' ? 'a'.repeat(64) : null,
    revision: state === 'admitted' ? 2 : 0, prerequisites: state === 'admitted' ? [] : ['host_release_manifest'], writesPerformed: 0, applyPolicy: 'none',
});
function sources(portable = true): FunctionModelSources {
    return { settings: { aiProvider: 'ollama', aiUrl: 'http://127.0.0.1:11434', aiModel_clinical: 'synthetic-clinical:1',
        aiModel_reasoning: 'synthetic-reasoning:1', ...Object.fromEntries(Object.values(FUNCTION_SWITCH_KEYS).map(key => [key, 'enabled'])) },
    ollamaLifecycle: { status: 'available', record: { lifecycle: { provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' } } },
    athenaLifecycle: { status: 'available', record: { lifecycle: { provider: 'athena_mlx', credentialClass: 'local_model', status: 'available_unqualified' } } },
    athenaIdentity: 'synthetic-mlx-directory', athenaAvailable: true, ...(portable ? { portable: status('admitted') } : {}) };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const command = (input: FunctionModelSources, version: 'v1' | 'v2' = 'v2'): FunctionModelCommand => {
    const view = readFunctionModelPreferences(input, version);
    return { schemaVersion: version === 'v1' ? 'mediflow.function-preferences-command.v1' : 'mediflow.function-preferences-command.v2',
        commandId: randomUUID(), expectedRevision: view.revision, expectedCatalogRevision: view.catalogRevision, action: 'set',
        functionId: 'treatment_reasoning', enabled: true, defaultModelOptionId: buildFunctionModelCatalog(input).hostDefaults.treatment_reasoning };
};

test('v2 disclosure is configuration-only, honest engine identity; v1 roster and snapshot stay exact', () => {
    const providers = { ollama: () => ({ status: 'denied', reason: 'missing' }), athena: () => ({ status: 'denied', reason: 'missing' }) };
    const legacy = buildFabricStatusSnapshot(providers);
    let reads = 0;
    const envelope = buildPortableFabricStatusSnapshot(providers, { status() { reads++; return status(); }, hardware });
    assert.equal(reads, 1); assert.deepEqual(envelope.legacy, legacy);
    assert.deepEqual(legacy.providerDisclosure.providers.map(p => p.id), ['ollama', 'athena_mlx', 'openai', 'anthropic']);
    assert.equal(envelope.treatmentReasoning.provider, 'athena_transformers');
    assert.equal(envelope.treatmentReasoning.state, 'NEEDS_CONTEXT');
    assert.equal(envelope.treatmentReasoning.runtimeObservation, 'not_observed');
    assert.equal(envelope.treatmentReasoning.configurationDisposition, 'blocked');
    assert.equal(envelope.treatmentReasoning.writesPerformed, 0); assert.equal(envelope.treatmentReasoning.applyPolicy, 'none');
    assert.deepEqual(parsePortableFabricStatusEnvelope(clone(legacy)), { legacy: clone(legacy), treatmentReasoning: null });
    assert.deepEqual(parsePortableFabricStatusEnvelope(clone(envelope)).legacy, legacy);
    const admitted = buildTreatmentReasoningPortableDisclosure(() => status('admitted'), hardware);
    assert.equal(admitted.configurationDisposition, 'admitted_unqualified'); assert.equal(admitted.runtimeObservation, 'not_observed');
});

test('malformed or secret-bearing status becomes bounded unavailability, never a path or exception disclosure', () => {
    for (const read of [() => { throw new Error('/private/SENSITIVE/TOKEN'); }, () => ({ ...status(), secret: 'SENSITIVE' }),
        () => ({ ...status(), prerequisites: ['http://127.0.0.1/SENSITIVE'] })]) {
        const result = buildTreatmentReasoningPortableDisclosure(read, hardware);
        assert.equal(result.state, 'unavailable'); assert.equal(result.selected, false);
        assert.doesNotMatch(JSON.stringify(result), /SENSITIVE|https:\/\//u);
    }
});

test('portable disclosure parser rejects unknown fields, fake readiness, malformed hardware and legacy relabeling', () => {
    const good = buildTreatmentReasoningPortableDisclosure(() => status('admitted'), hardware);
    for (const changed of [ { ...good, provider: 'athena_mlx' }, { ...good, model: 'another/model' }, { ...good, review: 'optional' },
        { ...good, runtimeObservation: 'available' }, { ...good, writesPerformed: 1 }, { ...good, applyPolicy: 'allowed' },
        { ...good, extra: true }, { ...good, hardware: null }, { ...good, selected: false }, { ...good, releaseDigest: null },
        { ...good, prerequisites: ['physical_memory_below_bf16_policy'] },
        { ...good, hardware: { ...good.hardware, minimumHostMemoryBytes: 1 } },
        { ...good, hardware: { ...good.hardware, blockers: ['physical_memory_below_bf16_policy'] } } ]) {
        assert.throws(() => parseTreatmentReasoningPortableDisclosure(changed), /portable_disclosure_invalid/u);
    }
    let evaluated = false; const getter = { ...good }; Object.defineProperty(getter, 'state', { enumerable: true, get() { evaluated = true; return 'admitted'; } });
    assert.throws(() => parseTreatmentReasoningPortableDisclosure(getter)); assert.equal(evaluated, false);
    assert.throws(() => parsePortableFabricStatusEnvelope({ schemaVersion: 'mediflow.ai.fabric-status.v3' }));
});

test('negotiated v1 projection never widens its closed union; v2 shares authoritative catalog revision', () => {
    const input = sources(); const v1 = readFunctionModelPreferences(input); const v2 = readFunctionModelPreferences(input, 'v2');
    assert.equal(v1.schemaVersion, 'mediflow.function-preferences.v1'); assert.equal(v2.schemaVersion, 'mediflow.function-preferences.v2');
    assert.equal(v1.catalogRevision, v2.catalogRevision); assert.equal(v1.revision, v2.revision);
    assert.ok(v1.functions.every(f => f.options.every(o => o.provider === 'ollama' || o.provider === 'athena_mlx')));
    assert.equal(v1.functions[3].defaultModelOptionId, null); assert.equal(v1.functions[3].bindingState, 'unsupported');
    assert.equal(v2.functions[3].options.find(o => o.provider === 'athena_transformers')?.label, ATHENA_R1_QWEN3_8B_MODEL_ID);
    assert.deepEqual(parsePreferences(clone(v1)), v1); assert.deepEqual(parsePreferences(clone(v2)), v2);
    for (let i = 0; i < 3; i++) assert.deepEqual(v1.functions[i], v2.functions[i]);
});

test('legacy persisted MLX choice survives unchanged and is never promoted to portable when catalog changes', () => {
    const legacy = sources(false); const request = command(legacy, 'v1'); const plan = planFunctionModelUpdate(legacy, request);
    const saved = { ...legacy, settings: { ...legacy.settings, ...plan.writes } };
    assert.equal(resolveFunctionModelDispatch(saved, 'treatment_reasoning').binding.provider, 'athena_mlx');
    const withPortable = { ...saved, portable: status('admitted') };
    for (const version of ['v1', 'v2'] as const) {
        const row = readFunctionModelPreferences(withPortable, version).functions[3];
        assert.equal(row.defaultModelOptionId, request.action === 'set' ? request.defaultModelOptionId : null);
        assert.equal(row.bindingState, 'stale'); assert.equal(row.defaultSource, 'saved_preference');
    }
    assert.throws(() => resolveFunctionModelDispatch(withPortable, 'treatment_reasoning'), /catalog_stale/u);
    assert.equal(withPortable.settings[FUNCTION_PREFERENCES_KEY], plan.writes[FUNCTION_PREFERENCES_KEY]);
});

test('v1 commands cannot bind portable explicitly, by host-default or preset; all-off remains possible', () => {
    const input = sources(); const req = command(input, 'v1');
    assert.throws(() => planFunctionModelUpdate(input, req), /unsupported/u);
    assert.throws(() => planFunctionModelUpdate(input, { ...req, defaultModelOptionId: null }), /unsupported/u);
    const { schemaVersion, commandId, expectedRevision, expectedCatalogRevision } = req;
    const preset = { schemaVersion, commandId, expectedRevision, expectedCatalogRevision, action: 'preset', presetId: 'host_defaults' };
    assert.throws(() => planFunctionModelUpdate(input, preset), /unsupported/u);
    assert.ok(planFunctionModelUpdate(input, { ...preset, presetId: 'all_off' }).view.functions.every(f => !f.enabled));
    assert.throws(() => parseFunctionModelCommand({ ...req, extra: true }), /input_invalid/u);
    const stale = { ...input, portable: { ...status('admitted'), revision: 3 } };
    assert.throws(() => planFunctionModelUpdate(stale, command(input)), /catalog_stale/u);
});

test('v1 can retain an opaque portable saved choice only while disabling; not re-enable it', () => {
    const input = sources(); const plan = planFunctionModelUpdate(input, command(input));
    const saved = { ...input, settings: { ...input.settings, ...plan.writes } };
    const v1 = readFunctionModelPreferences(saved); assert.equal(v1.functions[3].bindingState, 'stale');
    const req = { ...command(saved, 'v1'), enabled: false };
    const disabled = planFunctionModelUpdate(saved, req); assert.equal(disabled.view.functions[3].enabled, false);
    const later = { ...saved, settings: { ...saved.settings, ...disabled.writes } };
    assert.throws(() => planFunctionModelUpdate(later, command(later, 'v1')), /unsupported/u);
});

test('browser rejects mislabeled v1 portable payloads, extra data, impossible readiness and mixed preview versions', () => {
    const value = readFunctionModelPreferences(sources(), 'v2');
    assert.throws(() => parsePreferences({ ...value, schemaVersion: 'mediflow.function-preferences.v1' }), /invalid/u);
    assert.throws(() => parsePreferences({ ...value, secret: true }), /invalid/u);
    const modifyOption = (edit: (row: Record<string, unknown>) => void) => {
        const changed = clone(value); const row = changed.functions[3].options.find(o => o.provider === 'athena_transformers');
        assert.ok(row); edit(row as unknown as Record<string, unknown>); assert.throws(() => parsePreferences(changed), /invalid/u);
    };
    modifyOption(o => { o.provisioningState = 'NEEDS_CONTEXT'; });
    modifyOption(o => { o.prerequisites = ['http://127.0.0.1']; });
    modifyOption(o => { o.secret = 'unexpected'; });
    modifyOption(o => { o.prerequisites = ['same', 'same']; });
    const request = command(sources()); const proposed = planFunctionModelUpdate(sources(), request).view;
    const preview = { schemaVersion: 'mediflow.function-preferences-preview.v2', command: request, proposed, writesPerformed: 0 };
    assert.deepEqual(parsePreview(clone(preview), request), proposed);
    assert.throws(() => parsePreview({ ...preview, schemaVersion: 'mediflow.function-preferences-preview.v1' }, request));
    assert.throws(() => parsePreview({ ...preview, secret: true }, request));
    const getter = { ...value }; let read = false;
    Object.defineProperty(getter, 'functions', { enumerable: true, get() { read = true; return []; } });
    assert.throws(() => parsePreferences(getter)); assert.equal(read, false);
});

function http(t: { after(callback: () => void): void }) {
    let input = sources(); let writes = 0;
    const session = issueSyntheticWebSession({ id: `synthetic-${randomUUID()}`, username: randomUUID(), role: 'admin' }, randomUUID());
    t.after(() => retireSyntheticWebSession(session));
    const service = createFunctionModelPreferencesService({ readSources: () => input, immediate: callback => callback(), writeSettings(next) {
        writes += Object.keys(next).length; input = { ...input, settings: { ...input.settings, ...next } };
    } });
    const handlers = createFunctionModelPreferencesHttp({ authenticate: async () => session, service });
    return { service, handlers, session, writes: () => writes, input: () => input };
}
const request = (version?: string, body?: unknown, signal?: AbortSignal) => new Request('http://localhost/api/settings/ai/functions', {
    method: body ? 'POST' : 'GET', signal, headers: { ...(version ? { [FUNCTION_PREFERENCES_VERSION_HEADER]: version } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

test('real HTTP boundary negotiates headers, rejects version mismatch before writes, preserves owner retirement', async t => {
    const f = http(t);
    for (const version of [undefined, '1', '2']) {
        const response = await f.handlers.GET(request(version)); assert.equal(response.status, 200);
        assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(response.headers.get('Vary'), FUNCTION_PREFERENCES_VERSION_HEADER);
        assert.equal((await response.json()).schemaVersion, version === '2' ? 'mediflow.function-preferences.v2' : 'mediflow.function-preferences.v1');
    }
    assert.equal((await f.handlers.GET(request('3'))).status, 400);
    assert.equal((await f.handlers.POST(request(undefined, command(f.input())))).status, 400);
    assert.equal((await f.handlers.POST(request('2', command(f.input(), 'v1')))).status, 400);
    assert.equal(f.writes(), 0);
    assert.equal((await f.handlers.PREVIEW(request('2', command(f.input())))).status, 200); assert.equal(f.writes(), 0);
    retireSyntheticWebSession(f.session);
    assert.equal((await f.handlers.POST(request('2', command(f.input())))).status, 401); assert.equal(f.writes(), 0);
});

test('current browser uses negotiated v2 through real producer preview/apply/reread, with synthetic settings only', async t => {
    const f = http(t); const headers: string[] = [];
    const transport: typeof fetch = async (url, init) => {
        const req = new Request(new URL(String(url), 'http://localhost'), init); headers.push(req.headers.get(FUNCTION_PREFERENCES_VERSION_HEADER) ?? 'absent');
        return String(url).endsWith('/preview') ? f.handlers.PREVIEW(req) : req.method === 'POST' ? f.handlers.POST(req) : f.handlers.GET(req);
    };
    const client = createPreferencesClient(transport); t.after(() => client.reset());
    await client.read(); assert.equal(client.getSnapshot().dto?.schemaVersion, 'mediflow.function-preferences.v2');
    await client.preview({ action: 'set', functionId: 'treatment_reasoning', enabled: true,
        defaultModelOptionId: buildFunctionModelCatalog(f.input()).hostDefaults.treatment_reasoning });
    assert.ok(client.getSnapshot().proposed); assert.equal(f.writes(), 0);
    await client.apply(); assert.equal(client.getSnapshot().saved, true); assert.equal(f.writes(), 2);
    assert.deepEqual(headers, ['2', '2', '2', '2']);
    assert.equal(resolveFunctionModelDispatch(f.input(), 'treatment_reasoning').binding.provider, 'athena_transformers');
});

test('Fabric route/page source wiring negotiates v2 while retaining legacy validator and account boundary', () => {
    const route = fs.readFileSync('app/api/ai/fabric/status/route.ts', 'utf8');
    const page = fs.readFileSync('app/settings/ai/fabric/page.tsx', 'utf8');
    assert.ok(route.includes('requireSessionOrLocalToken(req)')); assert.ok(route.includes("requested === '2' ? buildPortableFabricStatusSnapshot"));
    assert.ok(route.includes('buildFabricStatusSnapshot(sources)')); assert.ok(page.includes(`[FABRIC_STATUS_VERSION_HEADER]: '2'`));
    assert.ok(page.includes('parsePortableFabricStatusEnvelope')); assert.ok(page.includes('parseFabricSnapshotPair(envelope.legacy, observabilityValue)'));
    assert.ok(page.includes('PortableTreatmentSection')); assert.ok(page.includes('<ChatGptAccountPanel'));
    assert.equal(FABRIC_STATUS_VERSION_HEADER, 'x-mediflow-fabric-status');
    assert.match(portablePrerequisiteText('physical_memory_below_bf16_policy'), /RAM/u);
});
