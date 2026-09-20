/* @Codex: synthetic transport only; never used by production composition. */
import type { AccountNotice } from '../../lib/chatgpt-account/account-contract';
import type { AccountMethod, AccountNotification, AccountTransport } from '../../lib/chatgpt-account/account-protocol';
export const syntheticLogin = { type: 'chatgpt', loginId: 'synthetic-login-1', authUrl: 'https://auth.openai.com/oauth/authorize?state=synthetic-state' };
export const syntheticAccount = { account: { type: 'chatgpt', email: 'fixture@example.invalid', planType: 'plus' }, requiresOpenaiAuth: true };
export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
export class SyntheticAccountTransport implements AccountTransport {
    calls: { method: AccountMethod; params: unknown }[] = [];
    closed = 0;
    initializedCount = 0;
    notification: AccountNotification = () => undefined;
    failure: (code: AccountNotice) => void = () => undefined;
    loggedOut = false;
    handler: ((method: AccountMethod, params: unknown) => Promise<unknown>) | null = null;
    async request(method: AccountMethod, params: unknown) {
        this.calls.push({ method, params });
        if (this.handler) return this.handler(method, params);
        if (method === 'initialize') return { userAgent: 'codex-cli/0.153.4' };
        if (method === 'account/login/start') return syntheticLogin;
        if (method === 'account/login/cancel') return { status: 'canceled' };
        if (method === 'account/read') return this.loggedOut ? { account: null, requiresOpenaiAuth: true } : syntheticAccount;
        if (method === 'account/logout') { this.loggedOut = true; return {}; }
        if (method === 'model/list') return { data: [{ id: 'synthetic-model', model: 'synthetic-model', hidden: false, isDefault: true, description: 'discard me' }], nextCursor: null };
        return { rateLimits: { primary: null, secondary: null }, rateLimitsByLimitId: { codex: { primary: { usedPercent: 27, windowDurationMins: 300, resetsAt: 2000000000 }, secondary: null } }, accountId: 'private-synthetic-account', rateLimitUpsell: { message: 'discard me' } };
    }
    initialized() { this.initializedCount++; }
    subscribe(notification: AccountNotification, failure: (code: AccountNotice) => void) {
        this.notification = notification; this.failure = failure;
        // Retain callback so tests can deliver a notification from a detached transport.
        return () => undefined;
    }
    complete(loginId: string | null = syntheticLogin.loginId, success = true) { this.notification('account/login/completed', { loginId, success, error: success ? null : 'private upstream detail' }); }
    async close() { this.closed++; return true; }
}
