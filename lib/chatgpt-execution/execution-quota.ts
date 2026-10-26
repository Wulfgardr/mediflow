import 'server-only';
import { types } from 'node:util';
import { ExecutionError, type ExecutionCode } from './execution-contract';
import type { ExecutionQuotaView } from './quota-view';

const HARD = new Set(['workspace_owner_credits_depleted', 'workspace_member_credits_depleted', 'workspace_owner_usage_limit_reached', 'workspace_member_usage_limit_reached']);
type Credits = Readonly<{ hasCredits: boolean; unlimited: boolean }>;
type Quota = { primaryUsedPercent: number | null; secondaryUsedPercent: number | null; credits: Credits | null;
    spend: boolean | null; reached: string | null };
type Patch = Partial<Quota>;
function object(value: unknown): Record<string, unknown> {
    if (types.isProxy(value) || !value || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new ExecutionError('limits_unavailable');
    if (Reflect.ownKeys(value).length > 32) throw new ExecutionError('limits_unavailable');
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') throw new ExecutionError('limits_unavailable');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) throw new ExecutionError('limits_unavailable');
        Object.defineProperty(copy, key, { enumerable: true, value: descriptor.value });
    }
    return copy;
}
function window(value: unknown): number | null {
    if (value == null) return null;
    const used = object(value).usedPercent;
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) throw new ExecutionError('limits_unavailable');
    return used;
}
function credits(value: unknown): Credits | null {
    if (value == null) return null;
    const input = object(value);
    if (Object.keys(input).some(key => !['hasCredits', 'unlimited', 'balance'].includes(key)) || typeof input.hasCredits !== 'boolean' || typeof input.unlimited !== 'boolean'
        || input.balance != null && (typeof input.balance !== 'string' || /[\x00-\x1f\x7f]/u.test(input.balance) || input.balance.length > 256)) throw new ExecutionError('limits_unavailable');
    return Object.freeze({ hasCredits: input.hasCredits, unlimited: input.unlimited });
}
function reached(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value !== 'string' || value !== 'rate_limit_reached' && !HARD.has(value)) throw new ExecutionError('limits_unavailable');
    return value;
}
function spend(value: unknown): boolean | null {
    if (value == null) return null;
    if (typeof value !== 'boolean') throw new ExecutionError('limits_unavailable');
    return value;
}
function hard(value: Partial<Quota>) {
    if (value.spend === true || value.reached && HARD.has(value.reached)) throw new ExecutionError('quota_exhausted');
}
function classify(value: Quota): ExecutionQuotaView {
    hard(value);
    if (value.primaryUsedPercent === null && value.secondaryUsedPercent === null) throw new ExecutionError('limits_unavailable');
    const exhausted = value.reached === 'rate_limit_reached' || [value.primaryUsedPercent, value.secondaryUsedPercent].some(used => used !== null && used >= 100);
    const usable = !!value.credits && (value.credits.hasCredits || value.credits.unlimited);
    if (exhausted && !usable) throw new ExecutionError('quota_exhausted');
    if (exhausted && value.spend !== false) throw new ExecutionError('limits_unavailable');
    return Object.freeze({ primaryUsedPercent: value.primaryUsedPercent, secondaryUsedPercent: value.secondaryUsedPercent,
        includedUsage: exhausted ? 'exhausted' : 'available', creditAvailability: usable ? 'available' : value.credits ? 'unavailable' : 'not_reported' });
}
function full(raw: unknown): { quota: Quota; accountId: string | null } {
    const response = object(raw);
    const input = object(response.rateLimitsByLimitId == null ? response.rateLimits : object(response.rateLimitsByLimitId).codex);
    if (input.limitId != null && input.limitId !== 'codex') throw new ExecutionError('limits_unavailable');
    if (response.accountId != null && (typeof response.accountId !== 'string' || response.accountId.length < 1 || response.accountId.length > 200)) throw new ExecutionError('limits_unavailable');
    return { accountId: typeof response.accountId === 'string' ? response.accountId : null, quota: {
        primaryUsedPercent: window(input.primary), secondaryUsedPercent: window(input.secondary), credits: credits(input.credits),
        spend: spend(input.spendControlReached), reached: reached(input.rateLimitReachedType),
    } };
}
function patch(raw: unknown): Patch | null {
    const input = object(object(raw).rateLimits);
    if (input.limitId != null) {
        if (typeof input.limitId !== 'string' || !input.limitId || input.limitId.length > 200) throw new ExecutionError('limits_unavailable');
        if (input.limitId !== 'codex') return null;
    }
    const output: Patch = {};
    if (input.primary != null) output.primaryUsedPercent = window(input.primary);
    if (input.secondary != null) output.secondaryUsedPercent = window(input.secondary);
    if (input.credits != null) output.credits = credits(input.credits);
    if (input.spendControlReached != null) output.spend = spend(input.spendControlReached);
    if (input.rateLimitReachedType != null) output.reached = reached(input.rateLimitReachedType);
    hard(output); return output;
}

/** Per-process metadata only. Caller still owns identity, consent, one-turn authority and backend errors. */
export function createExecutionQuotaMonitor() {
    let value: Quota | null = null, view: ExecutionQuotaView | null = null, accountId: string | null = null;
    let terminal: ExecutionError | null = null, reading = false, sequence = 0, accountEpoch = 0;
    let journal: { sequence: number; patch: Patch }[] = [];
    const guard = () => { if (terminal) throw terminal; };
    const fail = (error: unknown, source: 'limits_snapshot' | 'limits_notice'): never => {
        terminal ??= new ExecutionError(error instanceof ExecutionError ? error.code : 'limits_unavailable',
            error instanceof ExecutionError && error.denial ? error.denial : Object.freeze({ source, method: source === 'limits_snapshot' ? 'account/rateLimits/read' : 'account/rateLimits/updated', rpcCode: null, backendCode: null }));
        view = null; throw terminal;
    };
    return Object.freeze({
        snapshot: () => view,
        retire(code: ExecutionCode) { terminal ??= new ExecutionError(code); view = null; },
        discardAccountSnapshot() { guard(); value = null; view = null; accountId = null; journal = []; accountEpoch++; },
        notice(raw: unknown) {
            guard();
            try {
                const update = patch(raw); if (!update) return;
                if (journal.length >= 64) throw new ExecutionError('limits_unavailable');
                sequence++; if (reading || !value) journal.push({ sequence, patch: update });
                if (value) { value = { ...value, ...update }; view = classify(value); }
                else {
                    const provisional = Object.assign({ primaryUsedPercent: null, secondaryUsedPercent: null, credits: null, spend: null, reached: null }, ...journal.map(item => item.patch)) as Quota;
                    if ((provisional.primaryUsedPercent !== null || provisional.secondaryUsedPercent !== null)
                        && provisional.credits !== null && (!(provisional.credits.hasCredits || provisional.credits.unlimited) || provisional.spend !== null)) classify(provisional);
                }
            } catch (error) { fail(error, 'limits_notice'); }
        },
        async read(request: () => Promise<unknown>): Promise<ExecutionQuotaView> {
            guard(); if (reading) throw new ExecutionError('limits_unavailable');
            reading = true; const start = sequence, epoch = accountEpoch, initial = value === null;
            try {
                const response = await request(); guard();
                if (epoch !== accountEpoch) throw new ExecutionError('revoked');
                const observed = full(response);
                classify(observed.quota);
                if (accountId && observed.accountId && accountId !== observed.accountId) throw new ExecutionError('revoked');
                const next = { ...observed.quota };
                for (const entry of journal) if (initial || entry.sequence > start) Object.assign(next, entry.patch);
                const nextView = classify(next);
                value = next; view = nextView; accountId ??= observed.accountId; journal = [];
                return nextView;
            } catch (error) { return fail(error, 'limits_snapshot'); }
            finally { reading = false; }
        },
    });
}
export type ExecutionQuotaMonitor = ReturnType<typeof createExecutionQuotaMonitor>;
export function readExecutionQuota(raw: unknown): ExecutionQuotaView { return classify(full(raw).quota); }
