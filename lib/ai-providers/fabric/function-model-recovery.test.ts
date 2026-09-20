/* @Codex */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
    buildFunctionModelCatalog, createFunctionModelPreferencesService, FUNCTION_PREFERENCES_KEY,
    FUNCTION_SWITCH_KEYS, planFunctionModelUpdate, readFunctionModelPreferences, resolveFunctionModelDispatch,
    type FunctionModelCommand, type FunctionModelSources,
} from './function-model-preferences';

// Configuration-only fixtures: these tests do not attest a provider or exercise SQLite.
function fixture(): FunctionModelSources {
    const lifecycle = (provider: string, version = 1) => ({ status: 'available', record: { version,
        lifecycle: { status: 'available_unqualified', provider, credentialClass: 'local_model' } } });
    return { settings: { aiProvider: 'ollama', aiUrl: 'http://127.0.0.1:11434',
        aiModel_clinical: 'synthetic-clinical:1', aiModel_reasoning: 'synthetic-reasoning:1',
        ...Object.fromEntries(Object.values(FUNCTION_SWITCH_KEYS).map(key => [key, 'enabled'])) },
    ollamaLifecycle: lifecycle('ollama'), athenaLifecycle: lifecycle('athena_mlx'),
    athenaIdentity: 'synthetic-artifact', athenaAvailable: true };
}
function command(sources: FunctionModelSources, change: Record<string, unknown> = {}): FunctionModelCommand {
    const view = readFunctionModelPreferences(sources);
    return { schemaVersion: 'mediflow.function-preferences-command.v1', commandId: randomUUID(),
        expectedRevision: view.revision, expectedCatalogRevision: view.catalogRevision,
        action: 'set', functionId: 'patient_insight', enabled: true,
        defaultModelOptionId: view.functions[0].options[1].modelOptionId, ...change } as FunctionModelCommand;
}
function savedFixture() {
    const sources = fixture();
    return { ...sources, settings: { ...sources.settings, ...planFunctionModelUpdate(sources, command(sources)).writes } };
}
function savedDefault(sources: FunctionModelSources) {
    return JSON.parse(sources.settings[FUNCTION_PREFERENCES_KEY]!).defaults.patient_insight;
}

for (const reason of ['model_removed', 'lifecycle_changed'] as const) {
    test(`disabling an existing stale default preserves its original identity and revision: ${reason}`, () => {
        const saved = savedFixture();
        const sources = reason === 'model_removed'
            ? { ...saved, settings: { ...saved.settings, aiModel_reasoning: 'synthetic-replacement:2' } }
            : { ...saved, ollamaLifecycle: { status: 'available', record: { version: 3,
                lifecycle: { status: 'available_unqualified', provider: 'ollama', credentialClass: 'local_model' } } } };
        const oldDefault = savedDefault(saved);
        assert.equal(readFunctionModelPreferences(sources).functions[0].bindingState, 'stale');
        const disable = command(sources, { enabled: false, defaultModelOptionId: oldDefault.modelOptionId });
        const before = JSON.stringify(sources);
        const plan = planFunctionModelUpdate(sources, disable);
        assert.equal(JSON.stringify(sources), before);
        const disabled = { ...sources, settings: { ...sources.settings, ...plan.writes } };
        assert.deepEqual(savedDefault(disabled), oldDefault);
        assert.equal(plan.view.functions[0].enabled, false);
        assert.equal(plan.view.functions[0].bindingState, 'stale');
        assert.equal(plan.view.functions[0].defaultModelOptionId, oldDefault.modelOptionId);
        assert.throws(() => resolveFunctionModelDispatch(disabled, 'patient_insight'), /function_disabled/);
        assert.deepEqual(planFunctionModelUpdate(disabled, disable).writes, {});
        assert.deepEqual(Object.keys(plan.writes).sort(), [FUNCTION_PREFERENCES_KEY, FUNCTION_SWITCH_KEYS.patient_insight].sort());
        // An unrelated toggle cannot silently rebind this now-disabled stale preference.
        const other = planFunctionModelUpdate(disabled, command(disabled, { functionId: 'smart_import',
            enabled: false, defaultModelOptionId: null }));
        assert.deepEqual(JSON.parse(other.writes[FUNCTION_PREFERENCES_KEY]).defaults.patient_insight, oldDefault);
    });
}

test('disabling preserves an existing unavailable default without admitting or recovering its provider', () => {
    const saved = savedFixture();
    const sources = { ...saved, ollamaLifecycle: { status: 'available', record: { version: 2,
        lifecycle: { status: 'revoked', provider: 'ollama', credentialClass: 'local_model' } } } };
    const lifecycle = JSON.stringify(sources.ollamaLifecycle);
    const plan = planFunctionModelUpdate(sources, command(sources, { enabled: false,
        defaultModelOptionId: savedDefault(saved).modelOptionId }));
    assert.equal(plan.view.functions[0].bindingState, 'stale');
    assert.equal(JSON.stringify(sources.ollamaLifecycle), lifecycle);
    assert.throws(() => planFunctionModelUpdate(sources, command(sources)), /provider_unavailable/);
});

test('disabled writes still reject a new noncataloged option and an option belonging to another function', () => {
    const sources = savedFixture();
    assert.throws(() => planFunctionModelUpdate(sources, command(sources, { enabled: false,
        defaultModelOptionId: `model_option_${'0'.repeat(32)}` })), /model_not_cataloged/);
    const athena = buildFunctionModelCatalog(sources).hostDefaults.treatment_reasoning;
    assert.throws(() => planFunctionModelUpdate(sources, command(sources, { enabled: false,
        defaultModelOptionId: athena })), /unsupported/);
});

test('an explicit available rebind is still required before a stale preference can execute', () => {
    const saved = savedFixture();
    const changed = { ...saved, settings: { ...saved.settings, aiModel_reasoning: 'synthetic-replacement:2' } };
    assert.throws(() => resolveFunctionModelDispatch(changed, 'patient_insight'), /catalog_stale/);
    const old = savedDefault(saved);
    assert.throws(() => planFunctionModelUpdate(changed, command(changed, { defaultModelOptionId: old.modelOptionId })), /model_not_cataloged/);
    const plan = planFunctionModelUpdate(changed, command(changed));
    const rebound = { ...changed, settings: { ...changed.settings, ...plan.writes } };
    assert.equal(resolveFunctionModelDispatch(rebound, 'patient_insight').binding.model, 'synthetic-replacement:2');
    assert.equal(plan.view.functions[0].bindingState, 'current');
});

test('stale recovery retains preference CAS, catalog CAS and last-command conflict checks', () => {
    const sources = savedFixture();
    const disable = command(sources, { enabled: false, defaultModelOptionId: savedDefault(sources).modelOptionId });
    const changed = { ...sources, settings: { ...sources.settings, aiModel_reasoning: 'synthetic-replacement:2' } };
    assert.throws(() => planFunctionModelUpdate(changed, disable), /catalog_stale/);
    const plan = planFunctionModelUpdate(sources, disable);
    const disabled = { ...sources, settings: { ...sources.settings, ...plan.writes } };
    assert.throws(() => planFunctionModelUpdate(disabled, { ...disable, commandId: randomUUID() }), /revision_conflict/);
    assert.throws(() => planFunctionModelUpdate(disabled, { ...disable, enabled: true }), /command_conflict/);
});

test('all_off preview/apply/reread preserves stale choices, while host_defaults resets choices without enabling functions', () => {
    const saved = savedFixture();
    let sources = { ...saved, settings: { ...saved.settings, aiModel_reasoning: 'synthetic-replacement:2' } };
    let writes = 0;
    const service = createFunctionModelPreferencesService({ readSources: () => sources, immediate: run => run(),
        writeSettings(next) { writes += Object.keys(next).length; sources = { ...sources, settings: { ...sources.settings, ...next } }; } });
    const preset = (presetId: 'all_off' | 'host_defaults'): FunctionModelCommand => {
        const view = service.read();
        return { schemaVersion: 'mediflow.function-preferences-command.v1', commandId: randomUUID(),
            expectedRevision: view.revision, expectedCatalogRevision: view.catalogRevision, action: 'preset', presetId };
    };
    const baseline = service.read(); const off = preset('all_off');
    const preview = service.preview(off); assert.equal(writes, 0); assert.deepEqual(service.read(), baseline);
    assert.equal(preview.proposed.functions[0].bindingState, 'stale');
    const applied = service.apply(off); assert.deepEqual(service.read(), applied); assert.deepEqual(service.apply(off), applied);
    assert.equal(writes, 5); assert.ok(applied.functions.every(row => !row.enabled));
    assert.deepEqual(savedDefault(sources), savedDefault(saved));
    const host = preset('host_defaults'); const hostPreview = service.preview(host);
    const reset = service.apply(host); assert.deepEqual(reset, hostPreview.proposed);
    assert.ok(reset.functions.every(row => !row.enabled && row.defaultSource === 'host_configuration'));
    assert.equal(reset.functions[0].defaultModelOptionId, buildFunctionModelCatalog(sources).hostDefaults.patient_insight);
});

test('host_defaults cannot enable an unavailable host binding or hide a stale catalog', () => {
    const sources = fixture(); const view = readFunctionModelPreferences(sources);
    const preset = { schemaVersion: 'mediflow.function-preferences-command.v1', commandId: randomUUID(),
        expectedRevision: view.revision, expectedCatalogRevision: view.catalogRevision, action: 'preset', presetId: 'host_defaults' };
    const unavailable = { ...sources, ollamaLifecycle: { status: 'denied', reason: 'missing' } };
    assert.throws(() => planFunctionModelUpdate(unavailable, preset), /catalog_stale/);
    assert.throws(() => planFunctionModelUpdate(unavailable, { ...preset,
        expectedCatalogRevision: readFunctionModelPreferences(unavailable).catalogRevision }), /provider_unavailable/);
});
