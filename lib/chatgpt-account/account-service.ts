/* @Codex */
import 'server-only';
import type { AccountAction, AccountNotice, AccountOperation, AccountResult, AccountState, AccountStatus } from './account-contract';
import { AccountError, accountResponse, loginResponse, modelPage, rateLimitsResponse, record, type AccountTransport } from './account-protocol';

type Options = Readonly<{ createTransport: () => Promise<AccountTransport>; configured: boolean; now?: () => number; loginTimeoutMs?: number }>;
export function createAccountService(options: Options) {
    const now = options.now ?? Date.now;
    let state: AccountState = options.configured ? 'disconnected' : 'unavailable';
    let notice: AccountNotice = options.configured ? null : 'host_unavailable';
    let plan: string | null = null;
    let transport: AccountTransport | null = null;
    let unsubscribe: (() => void) | null = null;
    let generation = 0;
    let busy = false;
    let terminal = false;
    let login: { id: string; expiresAt: number; completed: boolean } | null = null;
    let earlyCompletion: unknown = null;
    let expiry: ReturnType<typeof setTimeout> | null = null;
    let cleanup: Promise<boolean> = Promise.resolve(true);
    const resultEpochs = new WeakMap<object, number>();

    function clearLogin() {
        login = null; earlyCompletion = null;
        if (expiry) clearTimeout(expiry);
        expiry = null;
    }
    function detach(): Promise<boolean> {
        generation += 1; busy = false; plan = null; clearLogin();
        unsubscribe?.(); unsubscribe = null;
        const previous = transport; transport = null;
        if (previous) cleanup = previous.close().catch(() => false);
        return cleanup;
    }
    function fail(code: Exclude<AccountNotice, null>) {
        state = code === 'host_unavailable' ? 'unavailable' : 'error'; notice = code; void detach();
    }
    function checkEpoch(epoch: number) {
        if (terminal || epoch !== generation) throw new AccountError('session_expired');
    }
    function checkExpiry() {
        if (login && login.expiresAt <= now()) fail('login_expired');
    }
    function status(): AccountStatus {
        checkExpiry();
        const actions: AccountAction[] = terminal ? [] : state === 'unavailable' ? ['configure_host']
            : state === 'awaiting_login' || state === 'starting' ? ['cancel_login']
            : state === 'verifying' ? ['complete_login', 'cancel_login']
            : state === 'connected' ? ['refresh_account', 'read_models', 'read_rate_limits', 'logout'] : ['connect'];
        const result: AccountStatus = { state, notice, plan, loginExpiresAt: login?.expiresAt ?? null, actions,
            inferenceEnabled: false, executionBlock: 'data_boundary_unqualified' };
        resultEpochs.set(result, generation);
        return result;
    }
    function completed(value: unknown) {
        const event = record(value);
        if (typeof event.success !== 'boolean' || !(event.loginId === null || typeof event.loginId === 'string')) throw new AccountError('protocol_error');
        if (!login) { if (state === 'starting') earlyCompletion = value; return; }
        if (event.loginId !== login.id || !['awaiting_login', 'verifying'].includes(state)) return;
        checkExpiry();
        if (!login) return;
        if (!event.success) { fail('login_failed'); return; }
        login.completed = true; state = 'verifying';
    }
    async function start(epoch: number): Promise<AccountResult> {
        if (!options.configured) throw new AccountError('host_unavailable');
        if (!['disconnected', 'error'].includes(state)) throw new AccountError('invalid_state');
        if (!await cleanup) throw new AccountError('process_exited');
        checkEpoch(epoch);
        state = 'starting'; notice = null;
        // Reserve cleanup before the factory yields: a canceled pending startup
        // still owns its eventual child until that child has actually drained.
        let settleStartup!: (drained: boolean) => void;
        cleanup = new Promise<boolean>(resolve => { settleStartup = resolve; });
        let created: AccountTransport;
        try { created = await options.createTransport(); }
        catch (error) { settleStartup(true); throw error; }
        if (terminal || epoch !== generation) {
            const drained = await Promise.resolve().then(() => created.close()).catch(() => false);
            settleStartup(drained);
            throw new AccountError('session_expired');
        }
        transport = created;
        settleStartup(true);
        unsubscribe = created.subscribe((method, params) => {
            if (terminal || epoch !== generation) return;
            try {
                if (method === 'account/login/completed') completed(params);
                if (method === 'account/updated' && state === 'connected') {
                    const event = record(params);
                    if (event.authMode === null) { state = 'disconnected'; notice = null; void detach(); }
                    else if (event.authMode !== 'chatgpt') fail('protocol_error');
                }
            }
            catch { fail('protocol_error'); }
        }, (code) => { if (!terminal && epoch === generation) fail(code ?? 'process_exited'); });
        const init = record(await created.request('initialize', {
            clientInfo: { name: 'mediflow_account_control', title: 'MediFlow', version: '0.8.6' },
            capabilities: { experimentalApi: false, requestAttestation: false },
        }));
        checkEpoch(epoch);
        if (typeof init.userAgent !== 'string') throw new AccountError('protocol_error');
        created.initialized();
        const response = loginResponse(await created.request('account/login/start', { type: 'chatgpt' }));
        checkEpoch(epoch);
        login = { id: response.loginId, expiresAt: now() + (options.loginTimeoutMs ?? 300_000), completed: false };
        state = 'awaiting_login';
        expiry = setTimeout(() => { if (epoch === generation) fail('login_expired'); }, options.loginTimeoutMs ?? 300_000);
        expiry.unref?.();
        if (earlyCompletion) { const event = earlyCompletion; earlyCompletion = null; completed(event); }
        checkEpoch(epoch);
        return { status: status(), authUrl: response.authUrl };
    }
    async function cancelOrLogout(logout: boolean): Promise<AccountStatus> {
        if (terminal) throw new AccountError('session_expired');
        const previous = transport;
        const pendingId = login?.id;
        const epoch = ++generation;
        busy = true; plan = null; clearLogin();
        unsubscribe?.(); unsubscribe = null;
        state = 'disconnected'; notice = logout ? null : 'canceled';
        let confirmed = !previous;
        try {
            if (previous && logout) {
                const response = record(await previous.request('account/logout', undefined));
                checkEpoch(epoch);
                if (Object.keys(response).length !== 0) throw new AccountError('protocol_error');
                confirmed = !accountResponse(await previous.request('account/read', { refreshToken: false })).connected;
                checkEpoch(epoch);
            } else if (previous && pendingId) {
                const response = record(await previous.request('account/login/cancel', { loginId: pendingId }));
                if (!['canceled', 'notFound'].includes(response.status as string)) throw new AccountError('protocol_error');
                confirmed = true;
            }
        } catch { confirmed = false; }
        finally {
            if (previous) {
                cleanup = previous.close().catch(() => false);
                if (!await cleanup) confirmed = false;
            }
            if (epoch === generation) { transport = null; busy = false; }
        }
        checkEpoch(epoch);
        if (logout && !confirmed) notice = 'logout_unconfirmed';
        return status();
    }
    async function execute(operation: AccountOperation): Promise<AccountResult> {
        checkExpiry();
        if (terminal) throw new AccountError('session_expired');
        if (operation === 'logout') return cancelOrLogout(true);
        if (operation === 'login/cancel') {
            if (!['starting', 'awaiting_login', 'verifying'].includes(state)) throw new AccountError('invalid_state');
            return cancelOrLogout(false);
        }
        if (busy) throw new AccountError('busy');
        const epoch = generation;
        busy = true;
        try {
            if (operation === 'login/start') return await start(epoch);
            const current = transport;
            if (!current) throw new AccountError('invalid_state');
            if (operation === 'login/complete') {
                if (state !== 'verifying' || !login?.completed) throw new AccountError('invalid_state');
                const account = accountResponse(await current.request('account/read', { refreshToken: false }));
                checkEpoch(epoch); checkExpiry(); checkEpoch(epoch);
                if (!account.connected) throw new AccountError('login_failed');
                clearLogin(); state = 'connected'; plan = account.plan; notice = null;
                return status();
            }
            if (state !== 'connected') throw new AccountError('invalid_state');
            if (operation === 'read') {
                const account = accountResponse(await current.request('account/read', { refreshToken: false }));
                checkEpoch(epoch);
                if (!account.connected) {
                    state = 'disconnected'; notice = null;
                    const draining = detach(); const detachedEpoch = generation;
                    await draining; checkEpoch(detachedEpoch);
                }
                else plan = account.plan;
                return status();
            }
            if (operation === 'models') {
                const models = [];
                const cursors = new Set<string>();
                let cursor: string | null = null;
                for (let page = 0; page < 10; page += 1) {
                    const result = modelPage(await current.request('model/list', { limit: 100, includeHidden: false, cursor }));
                    checkEpoch(epoch);
                    models.push(...result.models); cursor = result.cursor;
                    if (cursor === null) return { status: status(), models };
                    if (cursors.has(cursor)) throw new AccountError('protocol_error');
                    cursors.add(cursor);
                }
                throw new AccountError('protocol_error');
            }
            if (operation === 'rate-limits') {
                const limits = rateLimitsResponse(await current.request('account/rateLimits/read', undefined));
                checkEpoch(epoch);
                return { status: status(), ...limits };
            }
            throw new AccountError('invalid_state');
        } catch (error) {
            const code = error instanceof AccountError ? error.code : 'protocol_error';
            if (epoch === generation && !['busy', 'invalid_state', 'session_expired'].includes(code)) fail(code);
            throw new AccountError(code);
        } finally { if (epoch === generation) busy = false; }
    }
    return Object.freeze({ status, execute, isCurrent(result: AccountResult): boolean {
        const snapshot = 'status' in result ? result.status : result;
        return !terminal && resultEpochs.get(snapshot) === generation;
    }, dispose(): Promise<boolean> {
        terminal = true; state = 'disconnected'; notice = 'session_expired'; return detach();
    } });
}
export type AccountService = ReturnType<typeof createAccountService>;
