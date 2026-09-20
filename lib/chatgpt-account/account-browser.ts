/* @Codex: in-memory Web client; no provider preferences or credential persistence. */
import type { AccountAction, AccountLimitWindow, AccountModel, AccountNotice, AccountOperation, AccountRateLimits, AccountStatus } from './account-contract';

export type AccountBrowserView = Readonly<{
    kind: 'loading' | 'ready' | 'error' | 'locked';
    status: AccountStatus | null;
    busy: AccountOperation | 'status' | null;
    authUrl: string | null;
    models: readonly AccountModel[] | null;
    limits: Pick<AccountRateLimits, 'primary' | 'secondary'> | null;
    error: string | null;
    /** Browser observation only; never an account revision or execution capability. */
    modelsObservedAt: number | null;
    limitsObservedAt: number | null;
}>;
const actions: AccountAction[] = ['connect', 'cancel_login', 'complete_login', 'refresh_account', 'read_models', 'read_rate_limits', 'logout', 'configure_host'];
const notices: AccountNotice[] = [null, 'host_unavailable', 'timeout', 'protocol_error', 'process_exited', 'login_failed', 'login_expired', 'canceled', 'logout_unconfirmed', 'busy', 'session_expired', 'invalid_state'];
// Presentation cache lifetime, not a provider SLA or an admission/credential lifetime.
export const ACCOUNT_DETAILS_MAX_AGE_MS = 60_000;
const emptyDetails = { models: null, limits: null, modelsObservedAt: null, limitsObservedAt: null } as const;
const initial: AccountBrowserView = { kind: 'loading', status: null, busy: null, authUrl: null, error: null, ...emptyDetails };
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_response');
    return value as Record<string, unknown>;
}
export function parseAccountBrowserStatus(value: unknown): AccountStatus {
    const row = object(value);
    if (!['unavailable', 'disconnected', 'starting', 'awaiting_login', 'verifying', 'connected', 'error'].includes(row.state as string)
        || row.inferenceEnabled !== false || row.executionBlock !== 'data_boundary_unqualified'
        || !notices.includes(row.notice as AccountNotice)
        || !(row.plan === null || (typeof row.plan === 'string' && /^[a-z_0-9]{1,60}$/u.test(row.plan)))
        || !(row.loginExpiresAt === null || (Number.isSafeInteger(row.loginExpiresAt) && (row.loginExpiresAt as number) > 0))
        || !Array.isArray(row.actions) || row.actions.some(action => !actions.includes(action))) throw new Error('invalid_response');
    return { state: row.state as AccountStatus['state'], notice: row.notice as AccountNotice, plan: row.plan as string | null,
        loginExpiresAt: row.loginExpiresAt as number | null, actions: [...row.actions], inferenceEnabled: false, executionBlock: 'data_boundary_unqualified' };
}
function oauthUrl(value: unknown): string {
    if (typeof value !== 'string' || value.length > 8192) throw new Error('invalid_response');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.port !== '' || url.pathname !== '/oauth/authorize'
        || url.username || url.password || url.hash || !url.searchParams.get('state')) throw new Error('invalid_response');
    return url.href;
}
function windowValue(value: unknown): AccountLimitWindow | null {
    if (value === null) return null;
    const row = object(value);
    if (typeof row.usedPercent !== 'number' || !Number.isFinite(row.usedPercent) || row.usedPercent < 0
        || !(row.windowDurationMins === null || (Number.isSafeInteger(row.windowDurationMins) && (row.windowDurationMins as number) > 0))
        || !(row.resetsAt === null || (Number.isSafeInteger(row.resetsAt) && (row.resetsAt as number) >= 0))) throw new Error('invalid_response');
    return { usedPercent: row.usedPercent, windowDurationMins: row.windowDurationMins as number | null, resetsAt: row.resetsAt as number | null };
}
function modelValues(value: unknown): AccountModel[] {
    if (!Array.isArray(value) || value.length > 1000) throw new Error('invalid_response');
    return value.map(item => {
        const row = object(item);
        if (typeof row.id !== 'string' || typeof row.model !== 'string' || typeof row.isDefault !== 'boolean'
            || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(row.id) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(row.model)) throw new Error('invalid_response');
        return { id: row.id, model: row.model, isDefault: row.isDefault };
    });
}
export function createAccountBrowser(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
    let view = initial;
    let active = false;
    let generation = 0;
    let request: AbortController | null = null;
    const listeners = new Set<() => void>();
    let detailsTimer: ReturnType<typeof setTimeout> | null = null;
    function publish(next: AccountBrowserView) {
        if (detailsTimer !== null) clearTimeout(detailsTimer);
        detailsTimer = null;
        view = next;
        const deadlines = [
            next.models !== null && next.modelsObservedAt !== null ? next.modelsObservedAt + ACCOUNT_DETAILS_MAX_AGE_MS : null,
            next.limits !== null && next.limitsObservedAt !== null ? next.limitsObservedAt + ACCOUNT_DETAILS_MAX_AGE_MS : null,
        ].filter((value): value is number => value !== null);
        if (active && deadlines.length > 0) {
            detailsTimer = setTimeout(() => {
                const expired = (at: number | null) => at !== null && now() - at >= ACCOUNT_DETAILS_MAX_AGE_MS;
                // Keep the observation time to explain why the old values disappeared.
                // Expiry never requests the provider, refreshes credentials or retries work.
                publish({ ...view,
                    models: expired(view.modelsObservedAt) ? null : view.models,
                    limits: expired(view.limitsObservedAt) ? null : view.limits,
                });
            }, Math.max(0, Math.min(...deadlines) - now()));
        }
        for (const listener of listeners) listener();
    }
    function invalidate() { generation++; request?.abort(); request = null; }
    function setActive(value: boolean) {
        invalidate(); active = value;
        publish(value ? initial : { ...initial, kind: 'locked' });
    }
    async function run(operation: AccountOperation | 'status'): Promise<void> {
        if (!active) return;
        if (view.busy && operation !== 'login/cancel' && operation !== 'logout') return;
        invalidate(); const epoch = generation;
        const controller = new AbortController(); request = controller;
        const erase = operation === 'logout' || operation === 'login/cancel' || operation === 'login/complete' || operation === 'login/start';
        publish({ ...view, busy: operation, error: null,
            ...(operation === 'read' ? { models: null, limits: null } : {}),
            ...(operation === 'models' ? { models: null } : {}),
            ...(operation === 'rate-limits' ? { limits: null } : {}),
            ...(erase ? { authUrl: null, ...emptyDetails } : {}) });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            timer = setTimeout(() => controller.abort(), 20_000);
            const response = await fetcher(`/api/settings/ai/chatgpt/${operation}`, {
                method: operation === 'status' ? 'GET' : 'POST', cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
                ...(operation === 'status' ? {} : { headers: { 'Content-Type': 'application/json' }, body: '{}' }),
            });
            if (!active || epoch !== generation) return;
            if (controller.signal.aborted) throw new Error('unavailable');
            if (response.status === 401) { setActive(false); return; }
            if (!response.ok) throw new Error(response.status === 409 ? 'changed' : 'unavailable');
            const payload = object(await response.json());
            if (!active || epoch !== generation) return;
            if (controller.signal.aborted) throw new Error('unavailable');
            const status = parseAccountBrowserStatus(payload.status ?? payload);
            const connected = status.state === 'connected';
            const awaiting = status.state === 'awaiting_login';
            // GET status is local: it does not refresh catalog/limits. Even a
            // successful account read or a changed plan retires their old values.
            const sameAccountObservation = view.status?.state === 'connected' && view.status.plan === status.plan;
            const keepDetails = sameAccountObservation && status.notice === null && operation !== 'read';
            publish({ kind: 'ready', status, busy: null, error: null,
                authUrl: awaiting ? (operation === 'login/start' ? oauthUrl(payload.authUrl) : view.authUrl) : null,
                models: connected ? (operation === 'models' ? modelValues(payload.models) : keepDetails ? view.models : null) : null,
                limits: connected ? (operation === 'rate-limits' ? { primary: windowValue(payload.primary), secondary: windowValue(payload.secondary) } : keepDetails ? view.limits : null) : null,
                modelsObservedAt: connected ? (operation === 'models' ? now() : view.modelsObservedAt) : null,
                limitsObservedAt: connected ? (operation === 'rate-limits' ? now() : view.limitsObservedAt) : null,
            });
        } catch (error) {
            if (!active || epoch !== generation) return;
            publish({ ...view, kind: view.status ? 'ready' : 'error', busy: null, authUrl: null, models: null, limits: null,
                error: error instanceof Error && error.message === 'changed' ? 'Lo stato è cambiato. Rileggi prima di riprovare.' : 'Controllo non riuscito. Rileggi lo stato prima di riprovare.' });
        } finally { if (timer) clearTimeout(timer); if (epoch === generation) request = null; }
    }
    return Object.freeze({ snapshot: () => view, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        setActive, run, dispose() { setActive(false); listeners.clear(); } });
}
