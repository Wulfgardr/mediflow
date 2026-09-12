/* @Codex — browser-only controller; no authority, automatic inference or storage. */
import { PRODUCT_NAMESPACE, PRODUCT_OPERATION, PRODUCT_DATA_CLASS, ProductError,
    type ProductResponse, type ProductSnapshot, type ProductLoginChallenge, type ProductOperation, type ProductRequest } from './product-contract';
import type { SynthesisRequest } from '../chatgpt-execution/execution-contract';
import { selectProductOption } from './product-dispatch-seam';
export type ProductBrowserView = Readonly<{
    active: boolean; snapshot: ProductSnapshot | null; login: ProductLoginChallenge | null;
    selection: SynthesisRequest | null; busy: ProductOperation | null; error: string | null;
}>;
const initial: ProductBrowserView = Object.freeze({ active: false, snapshot: null, login: null, selection: null, busy: null, error: null });
class PublicMessage extends Error {}
const LOGIN_PENDING_MESSAGE = 'Completa prima l’accesso ufficiale, poi premi Verifica accesso.';
const isLoginPhase = (snapshot: ProductSnapshot | null) => snapshot !== null && ['awaiting_login', 'verifying'].includes(snapshot.state);
/** A local challenge is never copied into another consent/login context. */
function sameLoginContext(previous: ProductSnapshot | null, next: ProductSnapshot): boolean {
    return previous !== null && isLoginPhase(previous) && isLoginPhase(next) && previous?.contextRevision === next.contextRevision
        && previous.disclosure.revision === next.disclosure.revision
        && previous.qualification.revision === next.qualification.revision && next.qualification.state === 'qualified'
        && previous.consentExpiresAt === next.consentExpiresAt && previous.loginExpiresAt === next.loginExpiresAt
        && next.consentExpiresAt !== null && next.consentExpiresAt > Date.now()
        && next.loginExpiresAt !== null && next.loginExpiresAt > Date.now();
}
const states = ['held', 'needs_consent', 'consented', 'starting', 'awaiting_login', 'verifying', 'connected', 'ready', 'generating', 'completed', 'canceled', 'error'];
const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_response');
    return value as Record<string, unknown>;
};
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
const sha = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
function parse(value: unknown, operation: ProductOperation): ProductResponse {
    const response = object(value), row = object(response.snapshot), disclosure = object(row.disclosure), qualification = object(row.qualification);
    if (row.schema !== 'mediflow.chatgpt-product.v1' || !states.includes(String(row.state)) || row.clinicalAdmission !== 'held'
        || row.accountControlAdmitsExecution !== false || row.manualGenerationOnly !== true || !uuid(row.contextRevision)
        || !['none', 'dedicated_execution'].includes(String(row.authenticatedProcess)) || ![null, 'plus', 'pro'].includes(row.plan as null | string)
        || (row.notice !== null && !text(row.notice, 80)) || !text(qualification.platform, 80) || !text(qualification.revision, 256)
        || !Array.isArray(qualification.missing) || qualification.missing.length > 32 || qualification.missing.some(item => !text(item, 256))
        || !['qualified', 'unqualified', 'unsupported'].includes(String(qualification.state))
        || disclosure.operation !== PRODUCT_OPERATION || disclosure.dataClass !== PRODUCT_DATA_CLASS || disclosure.proposalOnly !== true
        || disclosure.clinicalWrites !== 0 || !uuid(disclosure.revision) || !sha(disclosure.inputSha256) || !text(disclosure.fixtureId, 128)
        || disclosure.maximumDurationMs !== 300000 || JSON.stringify(disclosure.egress) !== JSON.stringify(['auth.openai.com:443', 'chatgpt.com:443'])
        || !Array.isArray(disclosure.sources) || disclosure.sources.length < 1 || disclosure.sources.length > 32) throw new Error('invalid_response');
    const sources = disclosure.sources.map(value => object(value));
    if (sources.some(source => !text(source.id, 128) || !text(source.title, 256) || !text(source.text, 32000) || !sha(source.sha256))
        || new Set(sources.map(source => source.id)).size !== sources.length
        || sources.reduce((sum, source) => sum + (source.text as string).length, 0) > 64000) throw new Error('invalid_response');
    for (const field of ['consentExpiresAt', 'loginExpiresAt']) if (row[field] !== null && (typeof row[field] !== 'number' || !Number.isSafeInteger(row[field]) || (row[field] as number) <= 0)) throw new Error('invalid_response');
    const receipt = object(row.receipt);
    if (typeof receipt.localAuthorityWithdrawn !== 'boolean' || typeof receipt.egressWithdrawalRequested !== 'boolean'
        || !['not_attempted', 'attempted', 'acknowledged'].includes(String(receipt.interruption))
        || !['not_attempted', 'confirmed', 'unconfirmed'].includes(String(receipt.remoteLogout))
        || receipt.escapedDescendants !== 'not_attested' || receipt.globalRemoteRevocation !== 'not_claimed'
        || receipt.secureErase !== 'not_claimed' || receipt.quotaRefund !== 'not_claimed'
        || ['leaderExit', 'ownedGroupCessation', 'cleanup'].some(field => !['not_observed', 'confirmed', 'unconfirmed'].includes(String(receipt[field])))) throw new Error('invalid_response');
    if (row.limits !== null) {
        const limits = object(row.limits);
        for (const field of ['primaryUsedPercent', 'secondaryUsedPercent']) if (limits[field] !== null && (typeof limits[field] !== 'number' || !Number.isFinite(limits[field]) || (limits[field] as number) < 0 || (limits[field] as number) >= 100)) throw new Error('invalid_response');
    }
    if (row.catalog != null) {
        const catalog = object(row.catalog);
        if (!['ready', 'generating'].includes(String(row.state)) || !uuid(catalog.revision) || !Array.isArray(catalog.choices)
            || !catalog.choices.length || catalog.choices.length > 800 || catalog.choices.some(choice => {
                const c = object(choice); return !uuid(c.optionId) || !text(c.model, 256) || !efforts.has(String(c.effort));
            }) || new Set(catalog.choices.map(choice => object(choice).optionId)).size !== catalog.choices.length) throw new Error('invalid_response');
    }
    if (row.result != null) {
        const result = object(row.result), provenance = object(result.provenance);
        if (row.state !== 'completed' || result.status !== 'completed' || result.proposalOnly !== true || result.clinicalWrites !== 0
            || result.dataClass !== PRODUCT_DATA_CLASS || !text(result.summary, 4000) || !text(result.explanation, 2000)
            || JSON.stringify(result.sources) !== JSON.stringify(disclosure.sources)
            || !Array.isArray(result.citations) || !result.citations.length || result.citations.length > 32
            || provenance.provider !== 'openai' || provenance.channel !== 'codex_app_server' || provenance.authentication !== 'chatgpt_subscription'
            || provenance.fallback !== 'none' || provenance.requestedServiceTier !== 'priority'
            || (provenance.observedServiceTier !== null && !text(provenance.observedServiceTier, 80))
            || !text(provenance.model, 256) || !efforts.has(String(provenance.effort)) || !sha(provenance.outputSha256)
            || provenance.fixtureId !== disclosure.fixtureId || provenance.inputSha256 !== disclosure.inputSha256) throw new Error('invalid_response');
        for (const value of result.citations) {
            const citation = object(value), source = sources.find(source => source.id === citation.sourceId);
            if (!source || citation.sourceSha256 !== source.sha256 || !text(citation.quote, 2000) || !(source.text as string).includes(citation.quote)) throw new Error('invalid_response');
        }
    }
    let login: ProductLoginChallenge | undefined;
    if (response.login !== undefined) {
        const challenge = object(response.login);
        if (operation !== 'login/start' || !['awaiting_login', 'verifying'].includes(String(row.state))
            || !text(challenge.verificationUrl, 2048) || typeof challenge.userCode !== 'string' || !/^[A-Za-z0-9-]{1,64}$/u.test(challenge.userCode)) throw new Error('invalid_response');
        const url = new URL(challenge.verificationUrl);
        if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.port || url.username || url.password || url.hash) throw new Error('invalid_response');
        login = { verificationUrl: url.href, userCode: challenge.userCode };
    }
    return { snapshot: row as unknown as ProductSnapshot, ...(login ? { login } : {}) };
}
async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
    const reader = response.body?.getReader(); if (!reader) throw new Error('invalid_response');
    let length = 0; const chunks: Uint8Array[] = [];
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        for (;;) {
            if (signal.aborted) throw new Error('canceled');
            const next = await reader.read(); if (next.done) break;
            length += next.value.byteLength;
            if (length > 262144) throw new Error('invalid_response');
            chunks.push(next.value);
        }
        if (signal.aborted) throw new Error('canceled');
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); }
}
export function createProductBrowser(fetcher: typeof fetch = fetch) {
    let view = initial, generation = 0;
    let pending: AbortController | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const listeners = new Set<() => void>();
    function publish(next: ProductBrowserView) {
        view = Object.freeze(next); clearTimeout(expiry); expiry = undefined;
        const deadlines = [view.snapshot?.consentExpiresAt, view.snapshot?.loginExpiresAt]
            .filter((value): value is number => typeof value === 'number');
        if (view.active && deadlines.length) {
            const remaining = Math.min(...deadlines) - Date.now();
            const expire = () => {
                generation++; pending?.abort(); pending = undefined;
                publish({ ...initial, active: view.active, error: 'Consenso o accesso scaduto. Rileggi lo stato e autorizza nuovamente.' });
            };
            // A late HTTP response cannot reinstall an already-expired challenge.
            if (remaining <= 0) { expire(); return; }
            expiry = setTimeout(expire, remaining);
        }
        for (const listener of listeners) listener();
    }
    function setActive(active: boolean) {
        const mustCancel = !active && view.active && (!!view.snapshot?.consentExpiresAt || view.busy === 'login/start' || view.busy === 'generate');
        generation++; pending?.abort(); pending = undefined; clearTimeout(expiry);
        publish({ ...initial, active });
        if (mustCancel) {
            const cleanup = new AbortController();
            const timer = setTimeout(() => cleanup.abort(), 3000);
            // Explicit deactivation only. Never a login, catalog or turn. Server
            // authority decides whether the cancellation is still authorized.
            void Promise.resolve().then(() => fetcher(PRODUCT_NAMESPACE + 'cancel', { method: 'POST', cache: 'no-store',
                credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}',
                signal: cleanup.signal, keepalive: true })).then(response => response.body?.cancel()).catch(() => {}).finally(() => clearTimeout(timer));
        }
    }
    async function run(operation: ProductOperation): Promise<void> {
        if (!view.active) return;
        if (view.busy && !['cancel', 'login/cancel', 'logout'].includes(operation)) return;
        let payload: ProductRequest = {};
        if (operation === 'consent') {
            if (!view.snapshot) return;
            payload = { operation: PRODUCT_OPERATION, dataClass: PRODUCT_DATA_CLASS, expectedDisclosureRevision: view.snapshot.disclosure.revision };
        }
        if (operation === 'generate') {
            if (!view.snapshot || !view.selection) return;
            try { payload = selectProductOption(view.snapshot, view.selection.modelOptionId); } catch { return; }
            if ((payload as SynthesisRequest).expectedCatalogRevision !== view.selection.expectedCatalogRevision) return;
        }
        generation++; pending?.abort(); const epoch = generation;
        const controller = new AbortController(); pending = controller;
        const clear = ['consent', 'login/start', 'login/complete', 'login/cancel', 'cancel', 'logout', 'read', 'models'].includes(operation);
        const loginSnapshot = view.snapshot;
        const keepLogin = (operation === 'status' || operation === 'login/complete') && view.login !== null
            && loginSnapshot !== null && sameLoginContext(loginSnapshot, loginSnapshot);
        publish({ ...view, busy: operation,
            error: keepLogin && view.error === LOGIN_PENDING_MESSAGE ? LOGIN_PENDING_MESSAGE : null,
            login: keepLogin ? view.login : null,
            ...(clear ? { selection: null, snapshot: view.snapshot ? { ...view.snapshot, result: null, catalog: null } : null } : {}) });
        if (epoch !== generation || controller.signal.aborted) return;
        const deadline = setTimeout(() => controller.abort(), operation === 'generate' ? 120000 : operation === 'login/start' ? 120000 : 20000);
        try {
            const response = await fetcher(PRODUCT_NAMESPACE + operation, { method: operation === 'status' ? 'GET' : 'POST',
                cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
                ...(operation === 'status' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) });
            if (!view.active || epoch !== generation) return;
            if (response.status === 401) { setActive(false); return; }
            const raw = await readResponse(response, controller.signal);
            if (!view.active || epoch !== generation || controller.signal.aborted) return;
            if (!response.ok) {
                const code = object(raw).error;
                if (response.status === 409 && operation === 'login/complete' && code === 'login_pending'
                    && keepLogin && view.login !== null && view.snapshot !== null && sameLoginContext(loginSnapshot, view.snapshot)) {
                    // No new login/process/RPC. The owner keeps the pending login;
                    // subsequent local polls preserve its challenge and notice.
                    publish({ ...view, busy: null, error: LOGIN_PENDING_MESSAGE });
                    return;
                }
                throw new PublicMessage(code === 'unqualified_boundary' ? 'Esecuzione non qualificata su questa piattaforma o versione.'
                        : code === 'quota_exhausted' ? 'Quota esaurita. Nessun ripiego o riavvio automatico.'
                            : code === 'limits_unavailable' ? 'Quota non verificabile: generazione negata.'
                                : code === 'catalog_stale' ? 'Catalogo cambiato. Nuovo consenso e nuova scelta richiesti.'
                                    : 'Operazione non riuscita. Rileggi lo stato prima di un nuovo tentativo manuale.');
            }
            const parsed = parse(raw, operation), snapshot = parsed.snapshot;
            const sameContext = view.snapshot?.contextRevision === snapshot.contextRevision;
            const selection = sameContext && snapshot.catalog && view.selection && snapshot.catalog.revision === view.selection.expectedCatalogRevision
                && snapshot.catalog.choices.some(choice => choice.optionId === view.selection?.modelOptionId) ? view.selection : null;
            const continuingLogin = keepLogin && view.login !== null && sameLoginContext(loginSnapshot, snapshot);
            publish({ active: true, snapshot, selection, busy: null,
                error: continuingLogin && view.error === LOGIN_PENDING_MESSAGE ? LOGIN_PENDING_MESSAGE : null,
                login: isLoginPhase(snapshot) ? parsed.login ?? (continuingLogin ? view.login : null) : null });
        } catch (error) {
            if (!view.active || epoch !== generation) return;
            publish({ ...view, snapshot: null, login: null, selection: null, busy: null,
                error: controller.signal.aborted ? 'Richiesta annullata o scaduta. Rileggi lo stato.' : error instanceof PublicMessage ? error.message : 'Risposta non valida o servizio non disponibile. Rileggi lo stato.' });
        } finally { clearTimeout(deadline); if (epoch === generation) pending = undefined; }
    }
    async function select(optionId: string) {
        if (!view.active || !view.snapshot) return;
        if ((view.busy && view.busy !== 'status') || view.snapshot.state === 'generating') {
            publish({ ...view, selection: null, snapshot: { ...view.snapshot, result: null } });
            await run('cancel'); return;
        }
        generation++; pending?.abort(); pending = undefined;
        let selection: SynthesisRequest | null = null;
        try { selection = optionId ? selectProductOption(view.snapshot, optionId) : null; }
        catch (error) { if (!(error instanceof ProductError)) throw error; }
        publish({ ...view, busy: null, selection, snapshot: { ...view.snapshot, result: null } });
    }
    return Object.freeze({ snapshot: () => view, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        setActive, run, select,
        dispose() { setActive(false); listeners.clear(); },
    });
}
