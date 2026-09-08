/* @Codex */
import { createHash } from 'node:crypto';
import { isAiLaneEnabledValue } from '../../ai-lane-kill-switch';
import { resolveTextModel } from '../../ai-model-selection';
import { DEFAULT_OLLAMA_BASE_URL, resolveOllamaBaseUrl } from '../base-url';
import { assertLocalOllamaModelReference, strictOllamaLoopbackBaseUrl } from '../ollama-locality';

export const FUNCTION_MODEL_IDS = ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'] as const;
export type FunctionModelId = typeof FUNCTION_MODEL_IDS[number];
export const FUNCTION_PREFERENCES_KEY = 'ai.fabric.functionPreferences';
export const FUNCTION_SWITCH_KEYS = Object.freeze({ patient_insight: 'aiPatientInsightKillSwitch', smart_import: 'aiSmartImportKillSwitch',
    document_synthesis: 'aiDocumentSynthesisKillSwitch', treatment_reasoning: 'aiTreatmentReasoningKillSwitch' });
const CONFIG_KEYS = ['aiProvider', 'aiModel_clinical', 'aiModel_reasoning', 'aiModel', 'aiUrl', 'ollamaUrl'] as const;
export const FUNCTION_MODEL_SETTING_KEYS = [...CONFIG_KEYS, ...Object.values(FUNCTION_SWITCH_KEYS), FUNCTION_PREFERENCES_KEY];
export type FunctionModelSettings = Readonly<Record<string, string | undefined>>;
export type FunctionModelSources = Readonly<{ settings: FunctionModelSettings; ollamaLifecycle: unknown; athenaLifecycle: unknown;
    athenaIdentity: string; athenaAvailable: boolean }>;
export type FunctionModelErrorCode = 'input_invalid' | 'state_corrupt' | 'catalog_stale' | 'revision_conflict' | 'command_conflict'
    | 'model_not_cataloged' | 'unsupported' | 'function_disabled' | 'provider_unavailable' | 'session_stale' | 'binding_stale' | 'unavailable';
export class FunctionModelError extends Error {
    constructor(public readonly code: FunctionModelErrorCode) { super(`Function model request denied: ${code}`); this.name = 'FunctionModelError'; }
}
export type FunctionModelBinding = Readonly<{ modelOptionId: string; model: string; provider: 'ollama' | 'athena_mlx';
    endpoint: string | null; functions: readonly FunctionModelId[]; available: boolean }>;
type SavedDefault = Readonly<{ modelOptionId: string; catalogRevision: string }> | null;
type Defaults = Record<FunctionModelId, SavedDefault>;
type LastCommand = Readonly<{ id: string; digest: string; resultFingerprint: string }> | null;
type State = Readonly<{ schemaVersion: 'mediflow.function-preferences-store.v1'; defaults: Defaults; lastCommand: LastCommand }>;
export type FunctionModelCatalog = Readonly<{ revision: string; bindings: readonly FunctionModelBinding[];
    hostDefaults: Readonly<Record<FunctionModelId, string | null>> }>;
const REVISION = /^sha256_[0-9a-f]{64}$/u;
const OPTION = /^model_option_[0-9a-f]{32}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,95}$/u;
export const functionModelDigest = (value: unknown): string => `sha256_${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const fail = (code: FunctionModelErrorCode): never => { throw new FunctionModelError(code); };

export function functionModelRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
        || Reflect.ownKeys(value).length !== keys.length) return fail('input_invalid');
    const result: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) return fail('input_invalid');
        result[key] = descriptor.value;
    }
    return result;
}
export function isFunctionModelId(value: unknown): value is FunctionModelId {
    return typeof value === 'string' && (FUNCTION_MODEL_IDS as readonly string[]).includes(value);
}
function admitted(value: unknown, provider: string): boolean {
    const read = value as { status?: string; record?: { lifecycle?: { status?: string; provider?: string; credentialClass?: string } } } | null;
    return read?.status === 'available' && read.record?.lifecycle?.status === 'available_unqualified'
        && read.record.lifecycle.provider === provider && read.record.lifecycle.credentialClass === 'local_model';
}
export function buildFunctionModelCatalog(sources: FunctionModelSources): FunctionModelCatalog {
    const config = Object.fromEntries(CONFIG_KEYS.map(key => [key, sources.settings[key] ?? null]));
    const revision = functionModelDigest([config, sources.ollamaLifecycle, sources.athenaLifecycle, sources.athenaIdentity, sources.athenaAvailable]);
    const bindings: FunctionModelBinding[] = [];
    const hostDefaults = Object.fromEntries(FUNCTION_MODEL_IDS.map(id => [id, null])) as Record<FunctionModelId, string | null>;
    const add = (model: string, provider: 'ollama' | 'athena_mlx', endpoint: string | null, functions: readonly FunctionModelId[], available: boolean) => {
        const modelOptionId = `model_option_${functionModelDigest([provider, model, endpoint, provider === 'athena_mlx' ? sources.athenaIdentity : null]).slice(7, 39)}`;
        if (!bindings.some(item => item.modelOptionId === modelOptionId)) bindings.push(Object.freeze({ modelOptionId, model, provider, endpoint, functions, available }));
        return modelOptionId;
    };
    try {
        if ((sources.settings.aiProvider ?? 'ollama') !== 'ollama') throw new Error();
        const endpoint = strictOllamaLoopbackBaseUrl(resolveOllamaBaseUrl(sources.settings.aiUrl, sources.settings.ollamaUrl, DEFAULT_OLLAMA_BASE_URL));
        for (const role of ['clinical', 'reasoning'] as const) {
            // Invalid explicit roles never fall back to another model.
            try {
                const explicit = sources.settings[`aiModel_${role}`];
                if (explicit !== undefined && explicit.trim() === '') throw new Error();
                const model = resolveTextModel(explicit, sources.settings.aiModel);
                assertLocalOllamaModelReference(model);
                const id = add(model, 'ollama', endpoint, Object.freeze(['patient_insight', 'smart_import', 'document_synthesis']), admitted(sources.ollamaLifecycle, 'ollama'));
                if (role === 'clinical') { hostDefaults.patient_insight = id; hostDefaults.smart_import = id; }
                else hostDefaults.document_synthesis = id;
            } catch { /* Leave this host role unsupported. */ }
        }
    } catch { /* Invalid provider/endpoint is not a local candidate. */ }
    hostDefaults.treatment_reasoning = add('ATHENA / MLX', 'athena_mlx', null, Object.freeze(['treatment_reasoning']),
        admitted(sources.athenaLifecycle, 'athena_mlx') && sources.athenaAvailable);
    return Object.freeze({ revision, bindings: Object.freeze(bindings), hostDefaults: Object.freeze(hostDefaults) });
}
function readState(raw: string | undefined): State {
    const defaults = Object.fromEntries(FUNCTION_MODEL_IDS.map(id => [id, null])) as Defaults;
    if (raw === undefined) return { schemaVersion: 'mediflow.function-preferences-store.v1', defaults, lastCommand: null };
    try {
        if (raw.length > 16_384) throw new Error();
        const input = functionModelRecord(JSON.parse(raw), ['schemaVersion', 'defaults', 'lastCommand']);
        if (input.schemaVersion !== 'mediflow.function-preferences-store.v1') throw new Error();
        const entries = functionModelRecord(input.defaults, FUNCTION_MODEL_IDS);
        for (const id of FUNCTION_MODEL_IDS) {
            if (entries[id] === null) continue;
            const saved = functionModelRecord(entries[id], ['modelOptionId', 'catalogRevision']);
            if (typeof saved.modelOptionId !== 'string' || !OPTION.test(saved.modelOptionId)
                || typeof saved.catalogRevision !== 'string' || !REVISION.test(saved.catalogRevision)) throw new Error();
            defaults[id] = { modelOptionId: saved.modelOptionId, catalogRevision: saved.catalogRevision };
        }
        let lastCommand: LastCommand = null;
        if (input.lastCommand !== null) {
            const last = functionModelRecord(input.lastCommand, ['id', 'digest', 'resultFingerprint']);
            if (typeof last.id !== 'string' || !COMMAND_ID.test(last.id) || typeof last.digest !== 'string' || !REVISION.test(last.digest)
                || typeof last.resultFingerprint !== 'string' || !REVISION.test(last.resultFingerprint)) throw new Error();
            lastCommand = { id: last.id, digest: last.digest, resultFingerprint: last.resultFingerprint };
        }
        return { schemaVersion: 'mediflow.function-preferences-store.v1', defaults, lastCommand };
    } catch { return fail('state_corrupt'); }
}
const switches = (settings: FunctionModelSettings) => Object.fromEntries(FUNCTION_MODEL_IDS.map(id => [id, isAiLaneEnabledValue(settings[FUNCTION_SWITCH_KEYS[id]])])) as Record<FunctionModelId, boolean>;
const fingerprint = (state: State, settings: FunctionModelSettings) => functionModelDigest([state.defaults, switches(settings)]);
const revision = (state: State, settings: FunctionModelSettings) => functionModelDigest([state, ...FUNCTION_MODEL_IDS.map(id => settings[FUNCTION_SWITCH_KEYS[id]] ?? null)]);
function lookup(catalog: FunctionModelCatalog, id: FunctionModelId, option: string | null, requireAvailable: boolean): FunctionModelBinding {
    const binding = catalog.bindings.find(item => item.modelOptionId === option);
    if (!binding) return fail('model_not_cataloged');
    if (!binding.functions.includes(id)) return fail('unsupported');
    if (requireAvailable && !binding.available) return fail('provider_unavailable');
    return binding;
}
export function readFunctionModelPreferences(sources: FunctionModelSources) {
    const state = readState(sources.settings[FUNCTION_PREFERENCES_KEY]); const catalog = buildFunctionModelCatalog(sources);
    return Object.freeze({ schemaVersion: 'mediflow.function-preferences.v1' as const, revision: revision(state, sources.settings), catalogRevision: catalog.revision,
        check: 'configuration_only' as const, functions: FUNCTION_MODEL_IDS.map(id => {
            const saved = state.defaults[id]; const selected = saved?.modelOptionId ?? catalog.hostDefaults[id];
            const stale = saved !== null && (saved.catalogRevision !== catalog.revision || !catalog.bindings.some(item => item.modelOptionId === selected && item.functions.includes(id)));
            return { id, enabled: isAiLaneEnabledValue(sources.settings[FUNCTION_SWITCH_KEYS[id]]), defaultModelOptionId: selected,
                defaultSource: saved ? 'saved_preference' as const : 'host_configuration' as const, bindingState: stale ? 'stale' as const : !catalog.bindings.some(item => item.modelOptionId === selected && item.functions.includes(id)) ? 'unsupported' as const : 'current' as const,
                options: catalog.bindings.filter(item => item.functions.includes(id)).map(item => ({ modelOptionId: item.modelOptionId,
                    label: item.model, provider: item.provider, state: item.available ? 'available_unqualified' as const : 'unavailable' as const })) };
        }), presets: ['host_defaults', 'all_off'] as const, apply: 'denied' as const });
}
export type FunctionModelPreferences = ReturnType<typeof readFunctionModelPreferences>;
export type FunctionModelChoice = Readonly<{ modelOptionId: string; expectedCatalogRevision: string }>;
export function parseFunctionModelChoice(value: unknown): FunctionModelChoice {
    const input = functionModelRecord(value, ['modelOptionId', 'expectedCatalogRevision']);
    if (typeof input.modelOptionId !== 'string' || !OPTION.test(input.modelOptionId)
        || typeof input.expectedCatalogRevision !== 'string' || !REVISION.test(input.expectedCatalogRevision)) return fail('input_invalid');
    return Object.freeze({ modelOptionId: input.modelOptionId, expectedCatalogRevision: input.expectedCatalogRevision });
}
export function resolveFunctionModelDispatch(sources: FunctionModelSources, id: FunctionModelId, choiceValue?: unknown) {
    if (!isFunctionModelId(id)) return fail('unsupported');
    const state = readState(sources.settings[FUNCTION_PREFERENCES_KEY]); const catalog = buildFunctionModelCatalog(sources);
    if (!isAiLaneEnabledValue(sources.settings[FUNCTION_SWITCH_KEYS[id]])) return fail('function_disabled');
    const choice = choiceValue === undefined ? undefined : parseFunctionModelChoice(choiceValue);
    const saved = state.defaults[id];
    if (choice ? choice.expectedCatalogRevision !== catalog.revision : saved && saved.catalogRevision !== catalog.revision) return fail('catalog_stale');
    const binding = lookup(catalog, id, choice?.modelOptionId ?? saved?.modelOptionId ?? catalog.hostDefaults[id], true);
    return Object.freeze({ functionId: id, binding, catalogRevision: catalog.revision, preferenceRevision: revision(state, sources.settings),
        source: choice ? 'request_override' as const : saved ? 'saved_preference' as const : 'host_configuration' as const });
}

type SetCommand = { action: 'set'; functionId: FunctionModelId; enabled: boolean; defaultModelOptionId: string | null };
type PresetCommand = { action: 'preset'; presetId: 'host_defaults' | 'all_off' };
export type FunctionModelCommand = Readonly<{ schemaVersion: 'mediflow.function-preferences-command.v1'; commandId: string;
    expectedRevision: string; expectedCatalogRevision: string } & (SetCommand | PresetCommand)>;
export function parseFunctionModelCommand(value: unknown): FunctionModelCommand {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('input_invalid');
    const action = Object.getOwnPropertyDescriptor(value, 'action')?.value;
    const base = ['schemaVersion', 'commandId', 'expectedRevision', 'expectedCatalogRevision', 'action'];
    const input = functionModelRecord(value, [...base, ...(action === 'set' ? ['functionId', 'enabled', 'defaultModelOptionId'] : ['presetId'])]);
    if (input.schemaVersion !== 'mediflow.function-preferences-command.v1' || typeof input.commandId !== 'string' || !COMMAND_ID.test(input.commandId)
        || typeof input.expectedRevision !== 'string' || !REVISION.test(input.expectedRevision)
        || typeof input.expectedCatalogRevision !== 'string' || !REVISION.test(input.expectedCatalogRevision)) return fail('input_invalid');
    if (action === 'set') {
        if (!isFunctionModelId(input.functionId) || typeof input.enabled !== 'boolean'
            || (input.defaultModelOptionId !== null && (typeof input.defaultModelOptionId !== 'string' || !OPTION.test(input.defaultModelOptionId)))) return fail('input_invalid');
    } else if (action !== 'preset' || !['host_defaults', 'all_off'].includes(input.presetId as string)) return fail('input_invalid');
    return Object.freeze(input) as FunctionModelCommand;
}
export function planFunctionModelUpdate(sources: FunctionModelSources, value: unknown) {
    const command = parseFunctionModelCommand(value); const catalog = buildFunctionModelCatalog(sources);
    const state = readState(sources.settings[FUNCTION_PREFERENCES_KEY]); const digest = functionModelDigest(command);
    if (command.expectedCatalogRevision !== catalog.revision) return fail('catalog_stale');
    if (state.lastCommand?.id === command.commandId) {
        if (state.lastCommand.digest !== digest || state.lastCommand.resultFingerprint !== fingerprint(state, sources.settings)) return fail('command_conflict');
        return { writes: {} as Record<string, string>, view: readFunctionModelPreferences(sources), command };
    }
    if (command.expectedRevision !== revision(state, sources.settings)) return fail('revision_conflict');
    const defaults = { ...state.defaults }; const nextSettings = { ...sources.settings }; const writes: Record<string, string> = {};
    const set = (id: FunctionModelId, enabled: boolean, option: string | null) => {
        // Switching off is not a rebind. Retain an existing choice verbatim, even
        // if it has disappeared from the catalog; execution still requires a
        // current, available binding and the switch to be explicitly enabled.
        const retained = state.defaults[id];
        if (!enabled && option !== null && retained?.modelOptionId === option) defaults[id] = retained;
        else {
            if (option !== null) lookup(catalog, id, option, enabled);
            else if (enabled) lookup(catalog, id, catalog.hostDefaults[id], true);
            defaults[id] = option === null ? null : { modelOptionId: option, catalogRevision: catalog.revision };
        }
        writes[FUNCTION_SWITCH_KEYS[id]] = enabled ? 'enabled' : 'disabled';
    };
    if (command.action === 'set') set(command.functionId, command.enabled, command.defaultModelOptionId);
    else for (const id of FUNCTION_MODEL_IDS) {
        if (command.presetId === 'all_off') writes[FUNCTION_SWITCH_KEYS[id]] = 'disabled';
        else set(id, isAiLaneEnabledValue(sources.settings[FUNCTION_SWITCH_KEYS[id]]), null);
    }
    Object.assign(nextSettings, writes);
    const next: State = { schemaVersion: state.schemaVersion, defaults, lastCommand: null };
    const persisted: State = { ...next, lastCommand: { id: command.commandId, digest, resultFingerprint: fingerprint(next, nextSettings) } };
    writes[FUNCTION_PREFERENCES_KEY] = JSON.stringify(persisted); Object.assign(nextSettings, writes);
    return { writes, view: readFunctionModelPreferences({ ...sources, settings: nextSettings }), command };
}

/** Named owner: preview is read-only; apply serializes compare/read/write/reread. */
export function createFunctionModelPreferencesService(dependencies: Readonly<{ readSources(): FunctionModelSources;
    writeSettings(writes: Readonly<Record<string, string>>): void; immediate<T>(operation: () => T): T }>) {
    const read = () => readFunctionModelPreferences(dependencies.readSources());
    return Object.freeze({ read,
        preview(value: unknown) { const plan = planFunctionModelUpdate(dependencies.readSources(), value);
            return { schemaVersion: 'mediflow.function-preferences-preview.v1' as const, command: plan.command, proposed: plan.view, writesPerformed: 0 as const }; },
        apply(value: unknown) { return dependencies.immediate(() => {
            const plan = planFunctionModelUpdate(dependencies.readSources(), value);
            dependencies.writeSettings(plan.writes);
            const observed = read();
            if (observed.revision !== plan.view.revision || observed.catalogRevision !== plan.view.catalogRevision) return fail('binding_stale');
            return observed;
        }); },
    });
}
