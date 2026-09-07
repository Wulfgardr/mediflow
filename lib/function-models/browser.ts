/* @Codex: browser projection of ADR0129; the server remains the catalog authority. */
import type { FunctionModelPreferences, FunctionModelCommand, FunctionModelId, FunctionModelChoice } from '../ai-providers/fabric/function-model-preferences';
export type { FunctionModelPreferences, FunctionModelCommand, FunctionModelId, FunctionModelChoice };
export const names: Record<FunctionModelId, string> = { patient_insight: 'Quadro paziente', smart_import: 'Importazione assistita', document_synthesis: 'Sintesi dei documenti', treatment_reasoning: 'Ragionamento terapeutico' };
export const providerName = (provider: string) => provider === 'ollama' ? 'Ollama · locale' : provider === 'athena_mlx' ? 'ATHENA MLX · locale' : 'Provider non supportato';
export class ModelUiError extends Error { constructor(readonly code: 'unavailable' | 'invalid' | 'conflict' | 'stale' | 'locked') { super(code); } }
export const errorText = (error: unknown) => error instanceof ModelUiError && error.code === 'conflict'
    ? 'Le impostazioni sono cambiate. Rileggi e decidi di nuovo; nulla viene ritentato automaticamente.'
    : error instanceof ModelUiError && error.code === 'stale' ? 'La scelta del modello non è più attuale. Rileggi e scegli di nuovo: nessun modello alternativo viene usato.'
    : error instanceof ModelUiError && error.code === 'locked' ? 'Sessione non disponibile. Sblocca MediFlow e rileggi.'
    : 'Impossibile confermare le impostazioni. Rileggi prima di continuare.';
const record = (x: unknown): Record<string, unknown> => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new ModelUiError('invalid'); return x as Record<string, unknown>; };
const rev = (x: unknown): x is string => typeof x === 'string' && /^sha256_[0-9a-f]{64}$/u.test(x);
const option = (x: unknown): x is string => typeof x === 'string' && /^model_option_[0-9a-f]{32}$/u.test(x);
export function parsePreferences(value: unknown): FunctionModelPreferences {
    const row = record(value);
    if (row.schemaVersion !== 'mediflow.function-preferences.v1' || !rev(row.revision) || !rev(row.catalogRevision) || row.check !== 'configuration_only' || row.apply !== 'denied'
        || !Array.isArray(row.functions) || row.functions.length !== 4 || !Array.isArray(row.presets) || row.presets.join(',') !== 'host_defaults,all_off') throw new ModelUiError('invalid');
    const seen = new Set<string>();
    const functions = row.functions.map(value => {
        const f = record(value); const id = f.id as FunctionModelId;
        if (!Object.hasOwn(names, id) || seen.has(id) || typeof f.enabled !== 'boolean' || !(f.defaultModelOptionId === null || option(f.defaultModelOptionId))
            || !['saved_preference', 'host_configuration'].includes(f.defaultSource as string) || !['current', 'stale', 'unsupported'].includes(f.bindingState as string)
            || !Array.isArray(f.options) || f.options.length > 100) throw new ModelUiError('invalid');
        seen.add(id); const ids = new Set<string>();
        const options = f.options.map(value => {
            const o = record(value);
            if (!option(o.modelOptionId) || ids.has(o.modelOptionId) || typeof o.label !== 'string' || !o.label.trim() || o.label.length > 256 || /[\u0000-\u001f]/u.test(o.label)
                || !['ollama', 'athena_mlx'].includes(o.provider as string) || !['available_unqualified', 'unavailable'].includes(o.state as string)) throw new ModelUiError('invalid');
            ids.add(o.modelOptionId);
            return { modelOptionId: o.modelOptionId, label: o.label, provider: o.provider as 'ollama' | 'athena_mlx', state: o.state as 'available_unqualified' | 'unavailable' };
        });
        return { id, enabled: f.enabled, defaultModelOptionId: f.defaultModelOptionId as string | null, defaultSource: f.defaultSource as 'saved_preference' | 'host_configuration', bindingState: f.bindingState as 'current' | 'stale' | 'unsupported', options };
    });
    return { schemaVersion: 'mediflow.function-preferences.v1', revision: row.revision, catalogRevision: row.catalogRevision, check: 'configuration_only', functions, presets: ['host_defaults', 'all_off'], apply: 'denied' };
}
export async function api(request: typeof fetch, signal: AbortSignal, command?: FunctionModelCommand, preview = false): Promise<unknown> {
    const response = await request('/api/settings/ai/functions' + (preview ? '/preview' : ''), { method: command ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
        ...(command ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) } : {}) });
    if (signal.aborted) throw new ModelUiError('stale');
    if (!response.ok) throw new ModelUiError(response.status === 409 ? 'conflict' : response.status === 401 ? 'locked' : 'unavailable');
    const value: unknown = await response.json(); if (signal.aborted) throw new ModelUiError('stale'); return value;
}
export function parsePreview(value: unknown, command: FunctionModelCommand): FunctionModelPreferences {
    const row = record(value);
    if (row.schemaVersion !== 'mediflow.function-preferences-preview.v1' || row.writesPerformed !== 0 || JSON.stringify(row.command) !== JSON.stringify(command)) throw new ModelUiError('invalid');
    return parsePreferences(row.proposed);
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
        catch (error) { if (token === generation) { pending = null; emit({ dto: null, proposed: null, error: errorText(error) }); } }
        finally { clearTimeout(timeout); if (token === generation) { transport = null; emit({ busy: false }); } }
    };
    return { getSnapshot: () => view, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, reset,
        read: () => { pending = null; return execute(async signal => ({ dto: parsePreferences(await api(request, signal)), proposed: null })); },
        preview: (action: Omit<Extract<FunctionModelCommand, { action: 'set' }>, 'schemaVersion' | 'commandId' | 'expectedRevision' | 'expectedCatalogRevision'> | { action: 'preset'; presetId: 'host_defaults' | 'all_off' }) => {
            const dto = view.dto; if (!dto || view.busy) return Promise.resolve();
            const command: FunctionModelCommand = { schemaVersion: 'mediflow.function-preferences-command.v1', commandId: crypto.randomUUID(), expectedRevision: dto.revision, expectedCatalogRevision: dto.catalogRevision, ...action };
            pending = null; return execute(async signal => { const proposed = parsePreview(await api(request, signal, command, true), command); if (!signal.aborted) pending = command; return { proposed }; });
        },
        cancel: () => { generation++; transport?.abort(); pending = null; emit({ proposed: null, busy: false, saved: false }); },
        apply: () => {
            const command = pending; const proposed = view.proposed; if (!command || !proposed || view.busy) return Promise.resolve(); pending = null;
            return execute(async signal => { const applied = parsePreferences(await api(request, signal, command)); const observed = parsePreferences(await api(request, signal));
                if (observed.revision !== applied.revision || observed.catalogRevision !== applied.catalogRevision || applied.revision !== proposed.revision || applied.catalogRevision !== proposed.catalogRevision) throw new ModelUiError('conflict');
                return { dto: observed, proposed: null, saved: true }; });
        },
    };
}
