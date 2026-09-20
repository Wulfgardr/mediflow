/* @Codex */
import 'server-only';
import type { AccountLimitWindow, AccountModel, AccountNotice } from './account-contract';

export const ACCOUNT_METHODS = ['initialize', 'account/login/start', 'account/login/cancel', 'account/read', 'model/list', 'account/rateLimits/read', 'account/logout'] as const;
export type AccountMethod = typeof ACCOUNT_METHODS[number];
export type AccountNotification = (method: string, params: unknown) => void;
export interface AccountTransport {
    request(method: AccountMethod, params: unknown): Promise<unknown>;
    initialized(): void;
    subscribe(listener: AccountNotification, onFailure: (notice: AccountNotice) => void): () => void;
    close(): Promise<boolean>;
}
export class AccountError extends Error {
    readonly code: Exclude<AccountNotice, null>;
    constructor(code: Exclude<AccountNotice, null>) { super(code); this.name = 'AccountError'; this.code = code; }
}
export function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccountError('protocol_error');
    return value as Record<string, unknown>;
}
export function identifier(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(value)) throw new AccountError('protocol_error');
    return value;
}
export function loginResponse(value: unknown): { loginId: string; authUrl: string } {
    const data = record(value);
    if (data.type !== 'chatgpt') throw new AccountError('protocol_error');
    const loginId = identifier(data.loginId);
    if (typeof data.authUrl !== 'string' || data.authUrl.length > 8192) throw new AccountError('protocol_error');
    let url: URL;
    try { url = new URL(data.authUrl); } catch { throw new AccountError('protocol_error'); }
    if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.port || url.username || url.password
        || url.pathname !== '/oauth/authorize' || url.hash || !url.searchParams.get('state')) throw new AccountError('protocol_error');
    return { loginId, authUrl: url.href };
}
const PLANS = new Set(['free', 'go', 'plus', 'pro', 'team', 'business', 'enterprise', 'edu', 'unknown']);
export function accountResponse(value: unknown): { connected: boolean; plan: string | null } {
    const data = record(value);
    if (typeof data.requiresOpenaiAuth !== 'boolean') throw new AccountError('protocol_error');
    if (data.account === null) return { connected: false, plan: null };
    const account = record(data.account);
    if (account.type !== 'chatgpt' || typeof account.planType !== 'string') throw new AccountError('protocol_error');
    return { connected: true, plan: PLANS.has(account.planType) ? account.planType : 'unknown' };
}
export function modelPage(value: unknown): { models: AccountModel[]; cursor: string | null } {
    const data = record(value);
    if (!Array.isArray(data.data) || data.data.length > 100
        || !(data.nextCursor === null || (typeof data.nextCursor === 'string' && data.nextCursor.length > 0 && data.nextCursor.length <= 2048))) throw new AccountError('protocol_error');
    const models = data.data.map((item): AccountModel => {
        const model = record(item);
        if (typeof model.isDefault !== 'boolean' || typeof model.hidden !== 'boolean') throw new AccountError('protocol_error');
        return { id: identifier(model.id), model: identifier(model.model), isDefault: model.isDefault };
    });
    return { models, cursor: data.nextCursor as string | null };
}
function limitWindow(value: unknown): AccountLimitWindow | null {
    if (value === null) return null;
    const data = record(value);
    if (typeof data.usedPercent !== 'number' || !Number.isFinite(data.usedPercent) || data.usedPercent < 0
        || !(data.windowDurationMins === null || (Number.isSafeInteger(data.windowDurationMins) && (data.windowDurationMins as number) > 0))
        || !(data.resetsAt === null || (Number.isSafeInteger(data.resetsAt) && (data.resetsAt as number) >= 0))) throw new AccountError('protocol_error');
    return { usedPercent: data.usedPercent, windowDurationMins: data.windowDurationMins as number | null, resetsAt: data.resetsAt as number | null };
}
export function rateLimitsResponse(value: unknown): { primary: AccountLimitWindow | null; secondary: AccountLimitWindow | null } {
    const data = record(value);
    // Prefer the named Codex bucket, never enumerate backend account IDs or banners.
    const buckets = data.rateLimitsByLimitId === null || data.rateLimitsByLimitId === undefined ? null : record(data.rateLimitsByLimitId);
    const snapshot = record(buckets?.codex ?? data.rateLimits);
    return { primary: limitWindow(snapshot.primary), secondary: limitWindow(snapshot.secondary) };
}
