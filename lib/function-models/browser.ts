/* @Codex: browser projection of ADR0129; the server remains the catalog authority. */
import type { FunctionModelPreferences, FunctionModelCommand, FunctionModelId, FunctionModelChoice, FunctionModelOption, FunctionPreferenceRow, LegacyFunctionModelOption } from '../ai-providers/fabric/function-model-preferences';
export type { FunctionModelPreferences, FunctionModelCommand, FunctionModelId, FunctionModelChoice, FunctionModelOption, FunctionPreferenceRow, LegacyFunctionModelOption };
export const names: Record<FunctionModelId, string> = { patient_insight: 'Quadro paziente', smart_import: 'Importazione assistita', document_synthesis: 'Sintesi dei documenti', treatment_reasoning: 'Ragionamento terapeutico' };
export const providerName = (provider: string) => provider === 'ollama' ? 'Ollama · locale' : provider === 'athena_mlx' ? 'ATHENA MLX · locale' : provider === 'athena_transformers' ? 'ATHENA Transformers · CPU locale' : 'Provider non supportato';
export class ModelUiError extends Error { constructor(readonly code: 'unavailable' | 'provider_unavailable' | 'invalid' | 'conflict' | 'stale' | 'locked') { super(code); } }
export const errorText = (error: unknown) => error instanceof ModelUiError && error.code === 'conflict'
    ? 'Le impostazioni sono cambiate. Rileggi e decidi di nuovo; nulla viene ritentato automaticamente.'
    : error instanceof ModelUiError && error.code === 'stale' ? 'La scelta del modello non è più attuale. Rileggi e scegli di nuovo: nessun modello alternativo viene usato.'
    : error instanceof ModelUiError && error.code === 'provider_unavailable' ? 'provider_unavailable: il provider locale selezionato non è disponibile. Nessuna modifica e nessun fallback. Scegli esplicitamente OpenAI oppure rendi disponibile il provider locale.'
    : error instanceof ModelUiError && error.code === 'locked' ? 'Sessione non disponibile. Sblocca MediFlow e rileggi.'
    : 'Impossibile confermare le impostazioni. Rileggi prima di continuare.';
const record = (x: unknown): Record<string, unknown> => { if (!x || typeof x !== 'object' || Array.isArray(x) || Object.getPrototypeOf(x) !== Object.prototype || Reflect.ownKeys(x).some(key => typeof key !== 'string' || !Object.getOwnPropertyDescriptor(x, key)?.enumerable || !('value' in Object.getOwnPropertyDescriptor(x, key)!))) throw new ModelUiError('invalid'); return x as Record<string, unknown>; };
const exactKeys = (row: Record<string, unknown>, keys: readonly string[]) => { if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) throw new ModelUiError('invalid'); };
const rev = (x: unknown): x is string => typeof x === 'string' && /^sha256_[0-9a-f]{64}$/u.test(x);
const option = (x: unknown): x is string => typeof x === 'string' && /^model_option_[0-9a-f]{32}$/u.test(x);
export function parsePreferences(value: unknown): FunctionModelPreferences {
    const row = record(value);
    exactKeys(row, ['schemaVersion', 'revision', 'catalogRevision', 'check', 'functions', 'presets', 'apply']);
    if ((row.schemaVersion !== 'mediflow.function-preferences.v1' && row.schemaVersion !== 'mediflow.function-preferences.v2') || !rev(row.revision) || !rev(row.catalogRevision) || row.check !== 'configuration_only' || row.apply !== 'denied'
        || !Array.isArray(row.functions) || row.functions.length !== 4 || !Array.isArray(row.presets) || row.presets.join(',') !== 'host_defaults,all_off') throw new ModelUiError('invalid');
    const portableVersion = row.schemaVersion === 'mediflow.function-preferences.v2';
    const seen = new Set<string>();
    const functions: FunctionPreferenceRow[] = row.functions.map(value => {
        const f = record(value); exactKeys(f, ['id', 'enabled', 'defaultModelOptionId', 'defaultSource', 'bindingState', 'options']); const id = f.id as FunctionModelId;
        if (!Object.hasOwn(names, id) || seen.has(id) || typeof f.enabled !== 'boolean' || !(f.defaultModelOptionId === null || option(f.defaultModelOptionId))
            || !['saved_preference', 'host_configuration'].includes(f.defaultSource as string) || !['current', 'stale', 'unsupported'].includes(f.bindingState as string)
            || !Array.isArray(f.options) || f.options.length > 100) throw new ModelUiError('invalid');
        seen.add(id); const ids = new Set<string>();
        const options: FunctionModelOption[] = f.options.map(value => {
            const o = record(value);
            if (!option(o.modelOptionId) || ids.has(o.modelOptionId) || typeof o.label !== 'string' || !o.label.trim() || o.label.length > 256 || /[\u0000-\u001f]/u.test(o.label)
                || !['ollama', 'athena_mlx', 'athena_transformers'].includes(o.provider as string) || !['available_unqualified', 'unavailable'].includes(o.state as string)) throw new ModelUiError('invalid');
            const portable = o.provider === 'athena_transformers';
            exactKeys(o, ['modelOptionId', 'label', 'provider', 'state', ...(portable ? ['provisioningState', 'prerequisites'] : [])]);
            if (portable && (!portableVersion || id !== 'treatment_reasoning')) throw new ModelUiError('invalid');
            const states = ['NEEDS_CONTEXT', 'platform_unsupported', 'manifest_invalid', 'license_missing', 'model_not_provisioned',
                'needs_activation', 'admitted', 'revoked', 'artifact_tampered', 'consent_required', 'cancelled', 'busy', 'interrupted', 'unavailable'];
            if (portable && (typeof o.provisioningState !== 'string' || !states.includes(o.provisioningState)
                || !Array.isArray(o.prerequisites) || o.prerequisites.length > 16
                || !o.prerequisites.every(p => typeof p === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,159}$/u.test(p)) || new Set(o.prerequisites).size !== o.prerequisites.length
                || (o.state === 'available_unqualified' && (o.provisioningState !== 'admitted' || o.prerequisites.length !== 0)))) throw new ModelUiError('invalid');
            if (!portable && (o.provisioningState !== undefined || o.prerequisites !== undefined)) throw new ModelUiError('invalid');
            ids.add(o.modelOptionId);
            const common = { modelOptionId: o.modelOptionId, label: o.label,
                state: o.state as 'available_unqualified' | 'unavailable' };
            if (portable) return { ...common, provider: 'athena_transformers',
                provisioningState: o.provisioningState as NonNullable<FunctionModelOption['provisioningState']>,
                prerequisites: Object.freeze([...(o.prerequisites as string[])]) };
            if (o.provider !== 'ollama' && o.provider !== 'athena_mlx') throw new ModelUiError('invalid');
            return { ...common, provider: o.provider };
        });
        return { id, enabled: f.enabled, defaultModelOptionId: f.defaultModelOptionId as string | null, defaultSource: f.defaultSource as 'saved_preference' | 'host_configuration', bindingState: f.bindingState as 'current' | 'stale' | 'unsupported', options };
    });
    const common = { revision: row.revision, catalogRevision: row.catalogRevision, check: 'configuration_only' as const,
        presets: ['host_defaults', 'all_off'] as const, apply: 'denied' as const };
    if (portableVersion) return { ...common, schemaVersion: 'mediflow.function-preferences.v2', functions };
    return { ...common, schemaVersion: 'mediflow.function-preferences.v1', functions: functions.map(row => ({ ...row,
        options: row.options.filter((option): option is LegacyFunctionModelOption => option.provider !== 'athena_transformers') })) };

}
export async function api(request: typeof fetch, signal: AbortSignal, command?: FunctionModelCommand, preview = false, version: 'v1' | 'v2' = 'v2'): Promise<unknown> {
    const response = await request('/api/settings/ai/functions' + (preview ? '/preview' : ''), { method: command ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
        headers: { 'x-mediflow-function-preferences': (command ? command.schemaVersion === 'mediflow.function-preferences-command.v1' : version === 'v1') ? '1' : '2',
            ...(command ? { 'Content-Type': 'application/json' } : {}) },
        ...(command ? { body: JSON.stringify(command) } : {}) });
    if (signal.aborted) throw new ModelUiError('stale');
    if (!response.ok) {
        if (response.status === 401) throw new ModelUiError('locked');
        // Consume only the fixed code; never display arbitrary server error prose.
        const error: unknown = await response.json().catch(() => null);
        if (signal.aborted) throw new ModelUiError('stale');
        if (error && typeof error === 'object' && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'provider_unavailable') throw new ModelUiError('provider_unavailable');
        throw new ModelUiError(response.status === 409 ? 'conflict' : 'unavailable');
    }
    const value: unknown = await response.json(); if (signal.aborted) throw new ModelUiError('stale'); return value;
}
export function parsePreview(value: unknown, command: FunctionModelCommand): FunctionModelPreferences {
    const row = record(value);
    exactKeys(row, ['schemaVersion', 'command', 'proposed', 'writesPerformed']);
    if (row.schemaVersion !== (command.schemaVersion === 'mediflow.function-preferences-command.v2' ? 'mediflow.function-preferences-preview.v2' : 'mediflow.function-preferences-preview.v1') || row.writesPerformed !== 0 || JSON.stringify(row.command) !== JSON.stringify(command)) throw new ModelUiError('invalid');
    const proposed = parsePreferences(row.proposed);
    if (proposed.schemaVersion !== (command.schemaVersion === 'mediflow.function-preferences-command.v2' ? 'mediflow.function-preferences.v2' : 'mediflow.function-preferences.v1')) throw new ModelUiError('invalid');
    return proposed;
}
export type FunctionPreferenceAction =
    | Omit<Extract<FunctionModelCommand, { action: 'set' }>, 'schemaVersion' | 'commandId' | 'expectedRevision' | 'expectedCatalogRevision'>
    | Omit<Extract<FunctionModelCommand, { action: 'set_activation' }>, 'schemaVersion' | 'commandId' | 'expectedRevision' | 'expectedCatalogRevision'>
    | { action: 'preset'; presetId: 'host_defaults' | 'all_off' };
/** A local preview is not permission to probe an unavailable provider. */
function guardLocalPreview(dto: FunctionModelPreferences, action: FunctionPreferenceAction): void {
    if (action.action === 'set_activation') {
        if (dto.schemaVersion !== 'mediflow.function-preferences.v2') throw new ModelUiError('invalid');
        return;
    }
    if (action.action === 'preset' && action.presetId === 'all_off') return;
    const rows = action.action === 'set' ? dto.functions.filter(row => row.id === action.functionId) : dto.functions;
    for (const row of rows) {
        if (!(action.action === 'set' ? action.enabled : row.enabled)) continue;
        const id = action.action === 'set' ? action.defaultModelOptionId : null;
        // A saved preference does not disclose the host default. Only the
        // server's metadata-only preview may resolve it; never guess a binding.
        if (id === null && row.defaultSource !== 'host_configuration') continue;
        const selected = row.options.find(option => option.modelOptionId === (id ?? row.defaultModelOptionId));
        if (!selected || selected.state !== 'available_unqualified') throw new ModelUiError('provider_unavailable');
    }
}
export type PreferenceView = Readonly<{ dto: FunctionModelPreferences | null; proposed: FunctionModelPreferences | null; busy: boolean; error: string | null; saved: boolean }>;
export function createPreferencesClient(request: typeof fetch = globalThis.fetch) {
    let view: PreferenceView = { dto: null, proposed: null, busy: false, error: null, saved: false }; let pending: FunctionModelCommand | null = null;
    let generation = 0; let transport: AbortController | null = null; const listeners = new Set<() => void>();
    const emit = (next: Partial<PreferenceView>) => { view = { ...view, ...next }; listeners.forEach(fn => fn()); };
    const reset = () => { generation++; transport?.abort(); transport = null; pending = null; emit({ dto: null, proposed: null, busy: false, saved: false, error: null }); };
    const execute = async (work: (signal: AbortSignal) => Promise<Partial<PreferenceView>>) => {
        transport?.abort(); const token = ++generation; const controller = new AbortController(); transport = controller;
        const timeout = setTimeout(() => controller.abort(), 15000); emit({ busy: true, error: null, saved: false });
        try { const next = await work(controller.signal); if (token === generation && !controller.signal.aborted) emit(next); }
        catch (error) { if (token === generation) { pending = null; emit({ ...(error instanceof ModelUiError && error.code === 'provider_unavailable' ? {} : { dto: null }), proposed: null, error: errorText(error) }); } }
        finally { clearTimeout(timeout); if (token === generation) { transport = null; emit({ busy: false }); } }
    };
    return { getSnapshot: () => view, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, reset,
        read: () => { pending = null; return execute(async signal => ({ dto: parsePreferences(await api(request, signal)), proposed: null })); },
        preview: (action: FunctionPreferenceAction) => {
            const dto = view.dto; if (!dto || view.busy) return Promise.resolve();
            try { guardLocalPreview(dto, action); }
            catch (error) { pending = null; emit({ proposed: null, saved: false, error: errorText(error) }); return Promise.resolve(); }
            const command: FunctionModelCommand = { schemaVersion: dto.schemaVersion === 'mediflow.function-preferences.v2' ? 'mediflow.function-preferences-command.v2' : 'mediflow.function-preferences-command.v1', commandId: crypto.randomUUID(), expectedRevision: dto.revision, expectedCatalogRevision: dto.catalogRevision, ...action };
            pending = null; return execute(async signal => { const proposed = parsePreview(await api(request, signal, command, true), command); if (!signal.aborted) pending = command; return { proposed }; });
        },
        cancel: () => { generation++; transport?.abort(); pending = null; emit({ proposed: null, busy: false, saved: false }); },
        apply: () => {
            const command = pending; const proposed = view.proposed; if (!command || !proposed || view.busy) return Promise.resolve(); pending = null;
            return execute(async signal => { const applied = parsePreferences(await api(request, signal, command)); const observed = parsePreferences(await api(request, signal, undefined, false, command.schemaVersion === 'mediflow.function-preferences-command.v1' ? 'v1' : 'v2'));
                if (applied.schemaVersion !== proposed.schemaVersion || observed.schemaVersion !== applied.schemaVersion || observed.revision !== applied.revision || observed.catalogRevision !== applied.catalogRevision || applied.revision !== proposed.revision || applied.catalogRevision !== proposed.catalogRevision) throw new ModelUiError('conflict');
                return { dto: observed, proposed: null, saved: true }; });
        },
    };
}
