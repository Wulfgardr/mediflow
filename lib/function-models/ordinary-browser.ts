import { isAiLaneEnabledValue } from '../ai-lane-kill-switch';
/* @Codex — same preview output; no account/clinical material in browser storage. */
import { ordinaryWireObject, ORDINARY_FLOW_SCHEMA, ORDINARY_SELECTION_SCHEMA, type OrdinaryFunction, type OrdinaryFlowState } from '../chatgpt-product/ordinary-wire';
import type { SynthesisCatalog, SynthesisChoice } from '../chatgpt-execution/execution-contract';
import type { OrdinaryContentDisclosure } from '../chatgpt-product/product-contract';
const PREFIX = '/api/settings/ai/chatgpt/ordinary/';
const FUNCTIONS = ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'] as const;
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export type BrowserOrdinarySettings = Readonly<{ revision: string; enabled: boolean; retention: 'chatgpt_service_terms_apply';
    preferences: Readonly<Record<OrdinaryFunction, Readonly<{ use: 'local' | 'chatgpt_subscription'; model: string | null; effort: string | null }>>>;
    lanes: Readonly<Record<OrdinaryFunction, string | undefined>> }>;
export type OrdinaryBrowserView = Readonly<{ loading: boolean; error: string | null; settings: BrowserOrdinarySettings | null;
    state: OrdinaryFlowState | null; disclosure: OrdinaryContentDisclosure | null;
    challenge: Readonly<{ verificationUrl: string; userCode: string }> | null; catalog: SynthesisCatalog | null; choice: string; completed: boolean }>;
const text = (v: unknown, n = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= n && !/[\x00-\x1f\x7f]/u.test(v);
const failure = (code = 'response_invalid') => Object.assign(new Error('Operazione OpenAI non disponibile.'), { code });
export function parseOrdinaryBrowserSettings(v: unknown): BrowserOrdinarySettings {
    const x = ordinaryWireObject(v, ['schema', 'revision', 'enabled', 'retention', 'preferences', 'lanes']);
    const preferences = x && ordinaryWireObject(x.preferences, FUNCTIONS);
    const lanes = x?.lanes && typeof x.lanes === 'object' && !Array.isArray(x.lanes) ? x.lanes as Record<string, unknown> : null;
    if (!x || x.schema !== 'mediflow.chatgpt-ordinary-settings.v1' || !text(x.revision) || !/^sha256_[a-f0-9]{64}$/u.test(x.revision)
        || typeof x.enabled !== 'boolean' || x.retention !== 'chatgpt_service_terms_apply' || !preferences || !lanes
        || Object.keys(lanes).some(k => !(FUNCTIONS as readonly string[]).includes(k))) throw failure();
    const parsed: Record<string, unknown> = {};
    for (const id of FUNCTIONS) {
        const p = ordinaryWireObject(preferences[id], ['use', 'model', 'effort']);
        if (!p || !['local', 'chatgpt_subscription'].includes(p.use as string) || (p.model === null) !== (p.effort === null)
            || (p.model !== null && (!text(p.model, 160) || !EFFORTS.includes(p.effort as string)))
            || (lanes[id] !== undefined && typeof lanes[id] !== 'string')) throw failure();
        parsed[id] = Object.freeze({ ...p });
    }
    return Object.freeze({ revision: x.revision, enabled: x.enabled, retention: x.retention,
        preferences: Object.freeze(parsed) as BrowserOrdinarySettings['preferences'], lanes: Object.freeze({ ...lanes }) as BrowserOrdinarySettings['lanes'] });
}
export function parseOrdinaryCatalog(value: unknown): SynthesisCatalog {
    const c = ordinaryWireObject(value, ['revision', 'choices']);
    if (!c || !text(c.revision) || !Array.isArray(c.choices) || c.choices.length > 512) throw failure();
    const seen = new Set<string>();
    const choices = c.choices.map(raw => {
        const v = ordinaryWireObject(raw, ['optionId', 'model', 'effort']);
        if (!v || !text(v.optionId) || !text(v.model, 160) || !EFFORTS.includes(v.effort as string) || seen.has(v.optionId)) throw failure();
        seen.add(v.optionId); return Object.freeze({ ...v }) as SynthesisChoice;
    });
    return Object.freeze({ revision: c.revision, choices: Object.freeze(choices) });
}
function parseState(value: unknown, functionId: OrdinaryFunction): OrdinaryFlowState {
    if (!value || typeof value !== 'object') throw failure();
    const v = value as Record<string, unknown>;
    if (v.schema !== ORDINARY_FLOW_SCHEMA || v.functionId !== functionId || !text(v.attemptId) || !['preparing','needs_consent','consented','awaiting_login','connected','ready','generating','closed'].includes(v.phase as string)
        || !Number.isSafeInteger(v.expiresAt) || (v.expiresAt as number) <= Date.now()) throw failure();
    return Object.freeze({ schema: ORDINARY_FLOW_SCHEMA, functionId, attemptId: v.attemptId, phase: v.phase, expiresAt: v.expiresAt }) as OrdinaryFlowState;
}
function parseDisclosure(value: unknown, state: OrdinaryFlowState): OrdinaryContentDisclosure {
    const x = ordinaryWireObject(value, ['schema','revision','operation','profileVersion','contextRevision','attemptRevision','qualificationRevision','sourceSha256','payloadSha256','payloadBytes','egress','proposalOnly','clinicalWrites']);
    if (!x || x.schema !== 'mediflow.chatgpt-ordinary-disclosure.v1' || x.operation !== state.functionId || x.profileVersion !== 'mediflow.ordinary-redacted-profile.v1'
        || !['revision','contextRevision','attemptRevision','qualificationRevision'].every(k => text(x[k]))
        || typeof x.sourceSha256 !== 'string' || !/^sha256_[a-f0-9]{64}$/u.test(x.sourceSha256)
        || !['payloadSha256'].every(k => typeof x[k] === 'string' && /^[a-f0-9]{64}$/u.test(x[k] as string))
        || !Number.isSafeInteger(x.payloadBytes) || (x.payloadBytes as number) <= 0
        || JSON.stringify(x.egress) !== JSON.stringify(['auth.openai.com:443','chatgpt.com:443']) || x.proposalOnly !== true || x.clinicalWrites !== 0) throw failure();
    return Object.freeze({ ...x, egress: Object.freeze([...(x.egress as string[])]) }) as OrdinaryContentDisclosure;
}
export function createOrdinaryBrowser(functionId: OrdinaryFunction, transport: typeof fetch, changed: (view: OrdinaryBrowserView) => void) {
    const empty = (): OrdinaryBrowserView => ({ loading: false, error: null, settings: null, state: null, disclosure: null, challenge: null, catalog: null, choice: '', completed: false });
    let view = empty(), generation = 0, pending: { resolve(value: Response): void; reject(error: Error): void } | undefined;
    let lifetime: ReturnType<typeof setTimeout> | undefined;
    const emit = (patch: Partial<OrdinaryBrowserView>) => { view = Object.freeze({ ...view, ...patch }); changed(view); };
    async function fetchValue(operation: string, value?: unknown, signal?: AbortSignal): Promise<unknown> {
        const response = await transport(PREFIX + operation, { method: value === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
            ...(value === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }), signal });
        const json = await response.json() as { code?: string };
        if (!response.ok) throw failure(typeof json?.code === 'string' ? json.code : 'upstream_error');
        return json;
    }
    function cancel() {
        const id = view.state?.attemptId; generation++; clearTimeout(lifetime);
        pending?.reject(failure('revoked')); pending = undefined;
        if (id) void transport(PREFIX + 'cancel', { method: 'POST', credentials: 'same-origin', cache: 'no-store', keepalive: true,
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attemptId: id }) }).catch(() => {});
        view = empty(); changed(view);
    }
    async function read() {
        const token = generation; emit({ loading: true, error: null });
        try { const value = parseOrdinaryBrowserSettings(await fetchValue('settings', undefined, AbortSignal.timeout(15000)));
            if (token !== generation) return; emit({ settings: value, loading: false }); }
        catch { if (token === generation) emit({ loading: false, error: 'Configurazione OpenAI non verificata. Rileggi prima di procedere.' }); }
    }
    return Object.freeze({ getSnapshot: () => view, read, cancel,
        async policy(enabled: boolean) {
            if (!view.settings || view.loading || view.state) throw failure('invalid_state');
            const token = generation; emit({ loading: true, error: null });
            try { const settings = parseOrdinaryBrowserSettings(await fetchValue('policy', { expectedRevision: view.settings.revision, enabled, retention: 'chatgpt_service_terms_apply' }));
                if (token === generation) emit({ settings, loading: false }); }
            catch { if (token === generation) emit({ loading: false, error: 'Modifica non verificata. Rileggi; nessuna ripetizione automatica.' }); }
        },
        choose(optionId: string) { if (!view.catalog?.choices.some(c => c.optionId === optionId) || view.loading) throw failure('catalog_stale'); emit({ choice: optionId, error: null }); },
        async execute(input: RequestInfo | URL, init: RequestInit, signal: AbortSignal): Promise<Response> {
            if (!view.settings?.enabled || view.loading || view.state || view.completed || !isAiLaneEnabledValue(view.settings.lanes[functionId])) throw failure('invalid_state');
            const token = generation; emit({ loading: true, error: null });
            const abort = () => cancel(); signal.addEventListener('abort', abort, { once: true });
            try {
                const headers = new Headers(init.headers); headers.set('x-mediflow-function-model', JSON.stringify({ schema: ORDINARY_SELECTION_SCHEMA, expectedPreferenceRevision: view.settings.revision }));
                const response = await transport(input, { ...init, headers, signal });
                if (generation !== token || signal.aborted) throw failure('revoked');
                if (response.status !== 202) { emit({ loading: false }); return response; }
                const value = await response.json(); const state = parseState(value, functionId); const disclosure = parseDisclosure(value.disclosure, state);
                if (state.phase !== 'needs_consent') throw failure();
                const waiting = new Promise<Response>((resolve, reject) => { pending = { resolve, reject }; });
                lifetime = setTimeout(cancel, Math.max(0, state.expiresAt - Date.now()));
                emit({ loading: false, state, disclosure });
                const final = await waiting;
                if (generation !== token || signal.aborted) throw failure('revoked');
                return final;
            } catch (error) { if (token === generation) { emit({ loading: false, error: 'Operazione interrotta; nessun fallback.' }); cancel(); } throw error; }
            finally { signal.removeEventListener('abort', abort); }
        },
        async action(operation: 'consent' | 'login/start' | 'login/complete' | 'models' | 'generate' | 'preference') {
            if (!view.state || view.loading) return;
            const token = generation, attemptId = view.state.attemptId;
            const body = { attemptId, ...(operation === 'consent' ? { expectedDisclosureRevision: view.disclosure?.revision } : {}),
                ...(['generate','preference'].includes(operation) ? { modelOptionId: view.choice, expectedCatalogRevision: view.catalog?.revision } : {}),
                ...(operation === 'preference' ? { expectedRevision: view.settings?.revision } : {}) };
            emit({ loading: true, error: null });
            try {
                const response = await transport(PREFIX + operation, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
                    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                if (token !== generation) return;
                if (!response.ok) { const e = await response.json(); throw failure(e?.code); }
                if (operation === 'generate') {
                    clearTimeout(lifetime); emit({ loading: false, completed: true, catalog: null, state: null, challenge: null });
                    pending?.resolve(response); pending = undefined; return;
                }
                const value = await response.json(); const state = parseState(value, functionId);
                if (state.attemptId !== attemptId) throw failure();
                let patch: Partial<OrdinaryBrowserView> = { state, loading: false };
                if (operation === 'login/start') {
                    const c = ordinaryWireObject(value.challenge, ['verificationUrl','userCode']);
                    if (!c || !text(c.verificationUrl, 2048) || !text(c.userCode, 64) || !/^[A-Za-z0-9-]+$/u.test(c.userCode)) throw failure();
                    const url = new URL(c.verificationUrl);
                    if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.port || url.username || url.password || url.hash) throw failure();
                    patch = { ...patch, challenge: Object.freeze({ verificationUrl: url.href, userCode: c.userCode }) };
                }
                if (operation === 'models') { const catalog = parseOrdinaryCatalog(value.catalog); const saved = view.settings?.preferences[functionId];
                    const choice = saved?.use === 'chatgpt_subscription' ? catalog.choices.find(c => c.model === saved.model && c.effort === saved.effort)?.optionId ?? '' : '';
                    patch = { ...patch, catalog, choice, ...(saved?.model && !choice ? { error: 'Il modello preferito non è nel catalogo corrente. Scegli esplicitamente; nessuna sostituzione.' } : {}) }; }
                if (operation === 'preference') patch = { ...patch, settings: parseOrdinaryBrowserSettings(value.settings) };
                emit(patch);
            } catch (error) {
                if (token !== generation) return;
                const code = (error as { code?: string })?.code;
                if (code === 'login_pending') { emit({ loading: false, error: 'Completa l’accesso nella pagina ufficiale, poi verifica di nuovo.' }); return; }
                pending?.reject(failure(code)); pending = undefined; cancel();
                emit({ loading: false, error: `Esito non verificato (${code ?? 'upstream_error'}). Nessun fallback; serve una nuova preparazione.` });
            }
        },
    });
}
