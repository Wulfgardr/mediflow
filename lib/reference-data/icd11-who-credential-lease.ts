/* @Codex */
import { types as nodeUtilTypes } from 'node:util';
export const ICD11_WHO_SECRET_REFERENCE = Object.freeze({ scheme: 'host_secret' as const,
    name: 'mediflow.who.icd-api.oauth-client.v1' as const });
export const ICD11_WHO_CREDENTIAL_TARGET = 'who.icd-api.oauth-client-credentials.host-owned' as const;
export const ICD11_WHO_TOKEN_TARGET = 'who.icd-api.oauth-client-credentials.official' as const;
export const ICD11_WHO_TOKEN_EXPIRY_SKEW_MS = 60_000;
export const ICD11_WHO_TOKEN_LEASE_TTL_MS = 30_000;
export const ICD11_WHO_TOKEN_MAX_TTL_MS = 86_400_000;
export const ICD11_WHO_SECRET_RESOLVE_TIMEOUT_MS = 1_000;
export const ICD11_WHO_TOKEN_ISSUE_TIMEOUT_MS = 5_000;
const SOURCE_KEYS = ['now', 'resolveSecretReference', 'issueToken'] as const;
const CONFIG_KEYS = ['schemaVersion', 'generation', 'enabled', 'secretRef'] as const;
const REF_KEYS = ['scheme', 'name'] as const;
const RESOLVED_KEYS = ['schemaVersion', 'presentCredentials'] as const;
const TOKEN_KEYS = ['schemaVersion', 'tokenType', 'accessToken', 'expiresInMs'] as const;
const ISO_DATE_MAX_MS = 8_640_000_000_000_000;
export type Icd11WhoCredentialLeaseErrorCode = 'input_invalid' | 'secret_ref_invalid'
    | 'credential_disabled' | 'credential_revoked' | 'runtime_restarted' | 'manager_disposed'
    | 'clock_invalid' | 'secret_unavailable' | 'token_unavailable' | 'secret_resolve_timeout' | 'token_issue_timeout'
    | 'token_invalid' | 'lease_invalid' | 'lease_expired' | 'lease_revoked' | 'lease_consumed'
    | 'injection_failed' | 'injection_missing';
export class Icd11WhoCredentialLeaseError extends Error {
    constructor(public readonly code: Icd11WhoCredentialLeaseErrorCode) {
        super(`ICD-11 WHO credential lease rejected: ${code}`); this.name = 'Icd11WhoCredentialLeaseError';
    } }
type HeaderInjector = (sink: { set(name: string, value: string): unknown }) => void;
type CredentialPresenter = (sink: { set(clientId: string, clientSecret: string): unknown }) => void;
type Callable = (...args: never[]) => unknown;
type Sources = Readonly<{
    now: () => unknown; resolveSecretReference: (request: Readonly<{
        target: typeof ICD11_WHO_CREDENTIAL_TARGET; secretRef: typeof ICD11_WHO_SECRET_REFERENCE;
        generation: number; signal: AbortSignal;
    }>) => unknown; issueToken: (request: Readonly<{
        target: typeof ICD11_WHO_TOKEN_TARGET; generation: number;
        presentCredentials: CredentialPresenter; signal: AbortSignal;
    }>) => unknown;
}>;
declare const LEASE_BRAND: unique symbol;
export type Icd11WhoTokenLease = Readonly<{ [LEASE_BRAND]: true }>;
type TokenRecord = { generation: number; usableUntil: number; value: string };
type LeaseRecord = { token: TokenRecord; expiresAt: number; state: 'available' | 'consumed' | 'revoked' | 'expired' };
function exactRecord(value: unknown, keys: readonly string[], code: Icd11WhoCredentialLeaseErrorCode): Record<string, unknown> {
    try {
        if (!value || typeof value !== 'object' || nodeUtilTypes.isProxy(value) || Array.isArray(value)) throw new Error('record');
        const prototype = Object.getPrototypeOf(value); const ownKeys = Reflect.ownKeys(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
            || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) throw new Error('shape');
        const output: Record<string, unknown> = Object.create(null);
        for (const key of keys) { const descriptor = descriptors[key];
            if (!descriptor || !('value' in descriptor)) throw new Error('accessor');
            output[key] = descriptor.value;
        }
        return output;
    } catch { throw new Icd11WhoCredentialLeaseError(code); }
}
function nativePromise(value: unknown): value is Promise<unknown> {
    try {
        return !nodeUtilTypes.isProxy(value) && nodeUtilTypes.isPromise(value)
            && Object.getPrototypeOf(value) === Promise.prototype;
    } catch { return false; }
}
function safeFunction(value: unknown): value is Callable {
    try { return typeof value === 'function' && !nodeUtilTypes.isProxy(value); }
    catch { return false; }
}
function unsafeThenable(value: unknown): boolean {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
    try {
        if (nodeUtilTypes.isProxy(value)) return true;
        let cursor: object | null = value as object;
        while (cursor) {
            if (Object.getOwnPropertyDescriptor(cursor, 'then')) return true; cursor = Object.getPrototypeOf(cursor);
        }
        return false;
    } catch { return true; }
}
export function createIcd11WhoCredentialLeaseManager(sourcesValue: unknown) {
    const sourceRecord = exactRecord(sourcesValue, SOURCE_KEYS, 'input_invalid');
    if (!safeFunction(sourceRecord.now) || !safeFunction(sourceRecord.resolveSecretReference)
        || !safeFunction(sourceRecord.issueToken)) throw new Icd11WhoCredentialLeaseError('input_invalid');
    const sources = sourceRecord as unknown as Sources;
    let lastNow = -1;
    let config: { generation: number; state: 'enabled' | 'disabled' | 'revoked' } | null = null;
    let token: TokenRecord | null = null;
    let flight: { generation: number; controller: AbortController; promise: Promise<TokenRecord>;
        cancel: (code: Icd11WhoCredentialLeaseErrorCode) => void } | null = null;
    let disposed = false; let runtimeEpoch = 0;
    const leases = new WeakMap<object, LeaseRecord>(); const consumers = new Set<(code: Icd11WhoCredentialLeaseErrorCode) => void>();
    const now = (): number => {
        const fail = (): never => {
            if (flight) { flight.cancel('clock_invalid'); flight.controller.abort(); flight = null; }
            if (token) token.value = ''; token = null;
            throw new Icd11WhoCredentialLeaseError('clock_invalid');
        };
        let value: unknown;
        try { value = sources.now(); } catch { return fail(); }
        if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < lastNow
            || (value as number) > ISO_DATE_MAX_MS) return fail();
        lastNow = value as number; return lastNow;
    };
    const configure = (value: unknown): void => {
        if (disposed) throw new Icd11WhoCredentialLeaseError('manager_disposed');
        const candidate = exactRecord(value, CONFIG_KEYS, 'input_invalid');
        const ref = exactRecord(candidate.secretRef, REF_KEYS, 'secret_ref_invalid');
        if (candidate.schemaVersion !== 'mediflow.reference-data.icd11-who-credential-config.v1'
            || !Number.isSafeInteger(candidate.generation) || (candidate.generation as number) < 1
            || typeof candidate.enabled !== 'boolean' || ref.scheme !== ICD11_WHO_SECRET_REFERENCE.scheme
            || ref.name !== ICD11_WHO_SECRET_REFERENCE.name) throw new Icd11WhoCredentialLeaseError('secret_ref_invalid');
        if (config && (candidate.generation as number) <= config.generation) throw new Icd11WhoCredentialLeaseError('input_invalid');
        if (flight) { flight.cancel('lease_revoked'); flight.controller.abort(); flight = null; }
        for (const cancel of consumers) cancel('lease_revoked'); consumers.clear();
        if (token) token.value = ''; token = null;
        config = { generation: candidate.generation as number, state: candidate.enabled ? 'enabled' : 'disabled' };
    };
    const waitPort = async (value: unknown, code: 'secret_unavailable' | 'token_unavailable',
        timeoutCode: 'secret_resolve_timeout' | 'token_issue_timeout', timeoutMs: number,
        cancelled: Promise<never>, controller: AbortController): Promise<unknown> => {
        if (!nativePromise(value)) throw new Icd11WhoCredentialLeaseError(code);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => {
            reject(new Icd11WhoCredentialLeaseError(timeoutCode)); controller.abort();
        }, timeoutMs); });
        try { return await Promise.race([value, cancelled, timedOut]); }
        catch (error) {
            if (error instanceof Icd11WhoCredentialLeaseError) throw new Icd11WhoCredentialLeaseError(error.code);
            throw new Icd11WhoCredentialLeaseError(code);
        } finally { if (timer) clearTimeout(timer); }
    };
    const mintToken = async (generation: number, epoch: number, controller: AbortController,
        cancelled: Promise<never>): Promise<TokenRecord> => {
        let resolvedValue: unknown;
        try { resolvedValue = sources.resolveSecretReference(Object.freeze({ target: ICD11_WHO_CREDENTIAL_TARGET,
            secretRef: ICD11_WHO_SECRET_REFERENCE, generation, signal: controller.signal })); }
        catch { throw new Icd11WhoCredentialLeaseError('secret_unavailable'); }
        const resolved = await waitPort(resolvedValue, 'secret_unavailable', 'secret_resolve_timeout',
            ICD11_WHO_SECRET_RESOLVE_TIMEOUT_MS, cancelled, controller);
        if (runtimeEpoch !== epoch) throw new Icd11WhoCredentialLeaseError('runtime_restarted');
        if (config?.state !== 'enabled' || config.generation !== generation) throw new Icd11WhoCredentialLeaseError('lease_revoked');
        const secret = exactRecord(resolved, RESOLVED_KEYS, 'secret_unavailable');
        if (secret.schemaVersion !== 'mediflow.reference-data.icd11-who-resolved-secret.v1'
            || !safeFunction(secret.presentCredentials)) throw new Icd11WhoCredentialLeaseError('secret_unavailable');
        let presented = false; let presentationActive = true;
        const presentCredentials: CredentialPresenter = Object.freeze((sink) => {
            if (!presentationActive || presented) throw new Icd11WhoCredentialLeaseError('token_unavailable');
            let sinkRecord: Record<string, unknown>;
            try { sinkRecord = exactRecord(sink, ['set'], 'token_unavailable'); } catch { throw new Icd11WhoCredentialLeaseError('token_unavailable'); }
            if (!safeFunction(sinkRecord.set)) throw new Icd11WhoCredentialLeaseError('token_unavailable');
            let written = false;
            const boundedSink = Object.freeze({ set(clientId: string, clientSecret: string) {
                if (written || typeof clientId !== 'string' || typeof clientSecret !== 'string'
                    || !/^[\x21-\x7e]{8,512}$/.test(clientId) || !/^[\x21-\x7e]{16,2048}$/.test(clientSecret))
                    throw new Icd11WhoCredentialLeaseError('token_unavailable');
                written = true; return Reflect.apply(sinkRecord.set as Callable, sink, [clientId, clientSecret]);
            } });
            try { Reflect.apply(secret.presentCredentials as Callable, undefined, [boundedSink]); }
            catch { throw new Icd11WhoCredentialLeaseError('token_unavailable'); }
            if (!written) throw new Icd11WhoCredentialLeaseError('token_unavailable');
            if (runtimeEpoch !== epoch) throw new Icd11WhoCredentialLeaseError('runtime_restarted');
            if (disposed || config?.state !== 'enabled' || config.generation !== generation)
                throw new Icd11WhoCredentialLeaseError(disposed ? 'manager_disposed' : 'lease_revoked');
            presented = true;
        });
        let response: unknown;
        try {
            let tokenValue: unknown;
            try { tokenValue = sources.issueToken(Object.freeze({ target: ICD11_WHO_TOKEN_TARGET,
                generation, presentCredentials, signal: controller.signal })); }
            catch { throw new Icd11WhoCredentialLeaseError('token_unavailable'); }
            response = await waitPort(tokenValue, 'token_unavailable', 'token_issue_timeout',
                ICD11_WHO_TOKEN_ISSUE_TIMEOUT_MS, cancelled, controller);
        } finally { presentationActive = false; }
        if (runtimeEpoch !== epoch) throw new Icd11WhoCredentialLeaseError('runtime_restarted');
        if (config?.state !== 'enabled' || config.generation !== generation) throw new Icd11WhoCredentialLeaseError('lease_revoked');
        const result = exactRecord(response, TOKEN_KEYS, 'token_invalid');
        const completedAt = now();
        if (disposed) throw new Icd11WhoCredentialLeaseError('manager_disposed');
        if (runtimeEpoch !== epoch) throw new Icd11WhoCredentialLeaseError('runtime_restarted');
        if (!presented || result.schemaVersion !== 'mediflow.reference-data.icd11-who-token-result.v1'
            || result.tokenType !== 'Bearer' || typeof result.accessToken !== 'string'
            || !/^[\x21-\x7e]{16,4096}$/.test(result.accessToken)
            || !Number.isSafeInteger(result.expiresInMs)
            || (result.expiresInMs as number) <= ICD11_WHO_TOKEN_EXPIRY_SKEW_MS + ICD11_WHO_TOKEN_LEASE_TTL_MS
            || (result.expiresInMs as number) > ICD11_WHO_TOKEN_MAX_TTL_MS
            || completedAt > ISO_DATE_MAX_MS - (result.expiresInMs as number)) throw new Icd11WhoCredentialLeaseError('token_invalid');
        const minted = { generation,
            usableUntil: completedAt + (result.expiresInMs as number) - ICD11_WHO_TOKEN_EXPIRY_SKEW_MS,
            value: result.accessToken };
        token = minted; return minted;
    };
    const acquire = async (): Promise<Icd11WhoTokenLease> => {
        if (disposed) throw new Icd11WhoCredentialLeaseError('manager_disposed');
        if (config?.state === 'revoked') throw new Icd11WhoCredentialLeaseError('credential_revoked');
        if (config?.state !== 'enabled') throw new Icd11WhoCredentialLeaseError('credential_disabled');
        const generation = config.generation; const epoch = runtimeEpoch;
        let observedAt = now();
        if (disposed) throw new Icd11WhoCredentialLeaseError('manager_disposed');
        if (runtimeEpoch !== epoch) throw new Icd11WhoCredentialLeaseError('runtime_restarted');
        if (config?.state !== 'enabled' || config.generation !== generation) throw new Icd11WhoCredentialLeaseError('lease_revoked');
        if (token && (token.generation !== generation || observedAt >= token.usableUntil)) { token.value = ''; token = null; }
        if (!token) {
            if (!flight || flight.generation !== generation) {
                const controller = new AbortController();
                let cancel!: (code: Icd11WhoCredentialLeaseErrorCode) => void;
                const cancelled = new Promise<never>((_resolve, reject) => {
                    cancel = (code) => reject(new Icd11WhoCredentialLeaseError(code)); });
                void cancelled.catch(() => undefined);
                const pending = Promise.resolve().then(() => mintToken(generation, epoch, controller, cancelled));
                flight = { generation, controller, promise: pending, cancel };
                void pending.finally(() => { if (flight?.promise === pending) flight = null; }).catch(() => undefined);
            }
            const ready = await flight.promise;
            if (disposed) throw new Icd11WhoCredentialLeaseError('manager_disposed');
            const currentToken = token as TokenRecord | null;
            if (config?.state !== 'enabled' || config.generation !== generation || currentToken !== ready) {
                ready.value = ''; if (currentToken === ready) token = null; throw new Icd11WhoCredentialLeaseError('lease_revoked');
            }
            observedAt = now();
            if (disposed) throw new Icd11WhoCredentialLeaseError('manager_disposed');
            if (runtimeEpoch !== epoch || (token as TokenRecord | null) !== ready) throw new Icd11WhoCredentialLeaseError('lease_revoked');
            if (observedAt >= ready.usableUntil) { ready.value = ''; token = null; throw new Icd11WhoCredentialLeaseError('token_invalid'); }
        }
        const leaseToken = token as TokenRecord | null;
        if (!leaseToken) throw new Icd11WhoCredentialLeaseError('lease_revoked');
        const lease = Object.freeze(Object.create(null)) as Icd11WhoTokenLease;
        leases.set(lease, { token: leaseToken, expiresAt: Math.min(leaseToken.usableUntil, observedAt + ICD11_WHO_TOKEN_LEASE_TTL_MS),
            state: 'available' });
        return lease;
    };
    const consume = async <T>(leaseValue: unknown, run: (inject: HeaderInjector) => T | Promise<T>): Promise<T> => {
        if (disposed) throw new Icd11WhoCredentialLeaseError('manager_disposed');
        if (!leaseValue || typeof leaseValue !== 'object' || !safeFunction(run)) throw new Icd11WhoCredentialLeaseError('lease_invalid');
        const lease = leases.get(leaseValue as object);
        if (!lease) throw new Icd11WhoCredentialLeaseError('lease_invalid');
        if (!config || lease.token.generation !== config.generation || lease.token !== token || !lease.token.value) {
            lease.state = 'revoked'; throw new Icd11WhoCredentialLeaseError('lease_revoked');
        }
        if (lease.state === 'consumed') throw new Icd11WhoCredentialLeaseError('lease_consumed');
        if (lease.state !== 'available') throw new Icd11WhoCredentialLeaseError('lease_revoked');
        const epoch = runtimeEpoch;
        if (now() >= lease.expiresAt) { lease.state = 'expired'; throw new Icd11WhoCredentialLeaseError('lease_expired'); }
        if (runtimeEpoch !== epoch || lease.token !== token) { lease.state = 'revoked'; throw new Icd11WhoCredentialLeaseError('lease_revoked'); }
        lease.state = 'consumed';
        let active = true; let injected = false;
        let cancel!: (code: Icd11WhoCredentialLeaseErrorCode) => void;
        const cancelled = new Promise<never>((_resolve, reject) => {
            cancel = (code) => reject(new Icd11WhoCredentialLeaseError(code)); });
        void cancelled.catch(() => undefined); consumers.add(cancel);
        const inject: HeaderInjector = Object.freeze((sink) => {
            if (!active || injected) throw new Icd11WhoCredentialLeaseError('lease_consumed');
            if (!config || lease.token !== token || !lease.token.value) throw new Icd11WhoCredentialLeaseError('lease_revoked');
            try {
                const sinkRecord = exactRecord(sink, ['set'], 'injection_failed');
                if (!safeFunction(sinkRecord.set)) throw new Error('setter');
                Reflect.apply(sinkRecord.set, sink, ['Authorization', `Bearer ${lease.token.value}`]);
            } catch { throw new Icd11WhoCredentialLeaseError('injection_failed'); }
            injected = true;
        });
        try {
            let returned: unknown;
            try { returned = run(inject); }
            catch { throw new Icd11WhoCredentialLeaseError('injection_failed'); }
            let outcome: unknown;
            if (nativePromise(returned)) outcome = await Promise.race([returned, cancelled]);
            else { if (unsafeThenable(returned)) throw new Icd11WhoCredentialLeaseError('injection_failed'); outcome = returned; }
            if (!injected) throw new Icd11WhoCredentialLeaseError('injection_missing');
            if (runtimeEpoch !== epoch || !config || lease.token !== token || !lease.token.value)
                throw new Icd11WhoCredentialLeaseError('lease_revoked');
            return outcome as T;
        } catch (error) {
            if (error instanceof Icd11WhoCredentialLeaseError) throw new Icd11WhoCredentialLeaseError(error.code);
            throw new Icd11WhoCredentialLeaseError('injection_failed');
        } finally { active = false; consumers.delete(cancel); }
    };
    const invalidate = (code: Icd11WhoCredentialLeaseErrorCode): void => {
        if (flight) { flight.cancel(code); flight.controller.abort(); flight = null; }
        for (const cancel of consumers) cancel(code === 'manager_disposed' ? code : 'lease_revoked'); consumers.clear();
        if (token) token.value = ''; token = null;
    };
    const disable = (): boolean => {
        if (disposed) throw new Icd11WhoCredentialLeaseError('manager_disposed');
        if (!config || config.state !== 'enabled') return false;
        config.state = 'disabled'; invalidate('credential_disabled'); return true; };
    const revoke = (): boolean => {
        if (disposed) throw new Icd11WhoCredentialLeaseError('manager_disposed');
        if (!config || config.state === 'revoked') return false;
        config.state = 'revoked'; invalidate('credential_revoked'); return true; };
    const restart = (): boolean => {
        if (disposed) throw new Icd11WhoCredentialLeaseError('manager_disposed');
        if (runtimeEpoch >= Number.MAX_SAFE_INTEGER) throw new Icd11WhoCredentialLeaseError('input_invalid');
        runtimeEpoch += 1;
        invalidate('runtime_restarted'); return true; };
    const dispose = (): boolean => {
        if (disposed) return false;
        disposed = true; invalidate('manager_disposed'); return true; };
    return Object.freeze({ configure, acquire, consume, disable, revoke, restart, dispose });
}
