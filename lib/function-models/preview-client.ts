import { isAiLaneEnabledValue } from '../ai-lane-kill-switch';
import { createOrdinaryBrowser, type OrdinaryBrowserView } from './ordinary-browser';
/* @Codex: a request-local model selection, never clinical authority or persistence. */
import { api, parsePreferences, ModelUiError, errorText } from './browser';
import type { FunctionModelPreferences, FunctionModelId, FunctionModelChoice } from './browser';
export type PickerView = Readonly<{ dto: FunctionModelPreferences | null; choice: FunctionModelChoice | null; loading: boolean; error: string | null; blocked: boolean; consumed: boolean; remote?: OrdinaryBrowserView }>;
export function createModelPreviewClient(functionId: FunctionModelId, request: typeof fetch = globalThis.fetch) {
    let view: PickerView = { dto: null, choice: null, loading: false, error: null, blocked: false, consumed: false };
    let generation = 0; let transport = new AbortController(); let active = false; let lease: { generation: number; choice: FunctionModelChoice | null; remote?: boolean } | null = null;
    const listeners = new Set<() => void>(); const emit = (next: Partial<PickerView>) => { view = { ...view, ...next }; listeners.forEach(fn => fn()); };
    let remoteMode = false;
    const remote = createOrdinaryBrowser(functionId, request, value => { if (remoteMode) emit({ remote: value }); });
    const abort = (cancelRemote = true) => { if (cancelRemote) remote.cancel(); generation++; transport.abort(); transport = new AbortController(); lease = null; };
    const current = (token: number) => { if (!active || token !== generation || transport.signal.aborted) throw new ModelUiError('stale'); };
    const read = async () => {
        if (!active) return; remoteMode = false; abort(); const { remote: _remoteView, ...localView } = view; view = localView; void _remoteView; const token = generation; const previous = view.dto; emit({ loading: true, error: null });
        const signal = AbortSignal.any([transport.signal, AbortSignal.timeout(15000)]);
        try { const dto = parsePreferences(await api(request, signal)); current(token);
            const changed = previous && (previous.catalogRevision !== dto.catalogRevision || previous.revision !== dto.revision);
            emit({ dto, choice: changed || view.consumed ? null : view.choice, loading: false, blocked: view.blocked || !!changed || view.consumed, consumed: false, error: changed ? errorText(new ModelUiError('stale')) : null });
        } catch (error) { if (token === generation) emit({ dto: null, choice: null, loading: false, blocked: true, error: errorText(error) }); }
    };
    return {
        getSnapshot: () => view, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
        reset(enabled = false) { active = enabled; remoteMode = false; abort(); view = { dto: null, choice: null, loading: false, error: null, blocked: !enabled, consumed: false }; listeners.forEach(fn => fn()); },
        cancel() { abort(); emit({ choice: null, blocked: true, error: 'Scelta annullata. Rileggi e conferma il modello prima di generare.' }); },
        read, remote,
        chooseRemote() { if (!active) return; abort(); remoteMode = true; emit({ choice: null, blocked: false, consumed: false, error: null, remote: remote.getSnapshot() }); void remote.read(); },
        choose(id: string) {
            remoteMode = false; abort(); const { remote: _remoteView, ...localView } = view; view = localView; void _remoteView; const dto = view.dto; const f = dto?.functions.find(f => f.id === functionId);
            const selected = f?.options.find(o => o.modelOptionId === (id || f.defaultModelOptionId));
            if (!active || !dto || !f?.enabled || (!id && f.bindingState !== 'current') || selected?.state !== 'available_unqualified') {
                emit({ choice: null, blocked: true, error: errorText(new ModelUiError(f?.enabled && selected?.state === 'unavailable' ? 'provider_unavailable' : 'stale')) }); return;
            }
            emit({ consumed: false, choice: id ? { modelOptionId: id, expectedCatalogRevision: dto.catalogRevision } : null, blocked: false, error: null });
        },
        async begin() {
            if (remoteMode) {
                if (!active || view.consumed) throw new ModelUiError('stale');
                abort(false); const token = generation; await remote.read(); current(token);
                const observed = remote.getSnapshot();
                if (observed.error || !observed.settings?.enabled || !isAiLaneEnabledValue(observed.settings.lanes[functionId])) throw new ModelUiError('stale');
                lease = { generation: token, choice: null, remote: true }; return token;
            }
            if (!active || view.blocked || view.loading || view.consumed) throw new ModelUiError('stale');
            abort(); const token = generation; const old = view.dto; const choice = view.choice;
            try {
                const dto = parsePreferences(await api(request, AbortSignal.any([transport.signal, AbortSignal.timeout(15000)]))); current(token);
                if (old && (old.revision !== dto.revision || old.catalogRevision !== dto.catalogRevision)) throw new ModelUiError('stale');
                const f = dto.functions.find(f => f.id === functionId)!;
                const selected = f.options.find(o => o.modelOptionId === (choice?.modelOptionId ?? f.defaultModelOptionId));
                if (!f.enabled || (!choice && f.bindingState !== 'current') || (choice && choice.expectedCatalogRevision !== dto.catalogRevision)) throw new ModelUiError('stale');
                if (selected?.state !== 'available_unqualified') throw new ModelUiError('provider_unavailable');
                emit({ dto }); lease = { generation: token, choice }; return token;
            } catch (error) { if (token === generation) emit({ ...(error instanceof ModelUiError && error.code === 'provider_unavailable' ? {} : { choice: null }), blocked: true, error: errorText(error) }); throw error; }
        },
        isCurrent(token: number) { return active && generation === token && !transport.signal.aborted; },
        fetch: (async (input, init) => {
            if (!active) throw new ModelUiError('locked');
            const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
            const previewPath = `/api/ai/${functionId.replaceAll('_', '-')}/preview`;
            const token = generation; const headers = new Headers(init?.headers); headers.delete('x-mediflow-function-model');
            let remoteRequest = false;
            if (path === previewPath) {
                if (!lease || lease.generation !== token || init?.method !== 'POST') throw new ModelUiError('stale');
                const choice = lease.choice; remoteRequest = lease.remote === true; lease = null; emit({ consumed: true });
                if (choice) headers.set('x-mediflow-function-model', JSON.stringify(choice));
            } else if (path.includes('/preview')) throw new ModelUiError('invalid');
            const signal = init?.signal ? AbortSignal.any([transport.signal, init.signal]) : transport.signal;
            const response = remoteRequest ? await remote.execute(input, { ...init, headers }, signal) : await request(input, { ...init, headers, signal }); current(token);
            if (path === previewPath && (response.status === 409 || response.status === 401)) {
                emit({ choice: null, blocked: true, error: errorText(new ModelUiError(response.status === 409 ? 'stale' : 'locked')) });
                throw new ModelUiError('stale');
            }
            // Body parsing is a publication boundary too, including synthetic transports that ignore abort.
            const json = response.json.bind(response);
            response.json = async () => { const value: unknown = await json(); current(token); return value; };
            return response;
        }) as typeof fetch,
    };
}
