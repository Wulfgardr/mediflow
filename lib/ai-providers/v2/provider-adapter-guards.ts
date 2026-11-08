import { types } from 'node:util';
import { snapshotProviderLifecycleV2 } from './provider-lifecycle';
import type { createProviderSecretBrokerV2 } from './provider-secret-broker';

/* Shared input guards of the official provider adapters (Anthropic Messages, OpenAI Responses):
 * plain data records only, the lifecycle authorization re-read at every step, a broker reached
 * through its own methods, native promises and abort signals read through captured intrinsics. */
export const INPUT_KEYS = ['lifecycle', 'evidence', 'secretRef', 'broker', 'input', 'now', 'transport', 'signal'] as const;
export const INPUT_REQUIRED_KEYS = ['lifecycle', 'evidence', 'secretRef', 'broker', 'input', 'now', 'transport'] as const;
const LIFECYCLE_KEYS = ['schemaVersion', 'generation', 'status', 'binding'] as const;
const BINDING_KEYS = ['schemaVersion', 'operation', 'providerId', 'kind', 'venue', 'model', 'dataClass', 'egressProfileRef',
    'retentionProfileRef', 'consentRef', 'timeoutMs', 'maxInputBytes', 'maxOutputBytes', 'fallback'] as const;
export const EVIDENCE_KEYS = ['schemaVersion', 'egressProfileRef', 'retentionProfileRef', 'consentRef', 'egressPromoted',
    'retentionEligible', 'consentCurrent', 'redactionReceiptSha256'] as const;
export const SECRET_REF_KEYS = ['scheme', 'name'] as const;
const BROKER_KEYS = ['issue', 'snapshot', 'revoke', 'consume'] as const;
const ISO_DATE_MAX_MS = 8_640_000_000_000_000;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
export const IS_PROXY = types.isProxy;
const IS_PROMISE = types.isPromise, PROMISE_PROTOTYPE = Promise.prototype;
const PROMISE_THEN = Promise.prototype.then;
export type ProviderSecretBroker = ReturnType<typeof createProviderSecretBrokerV2>;
export type ProviderHttpDenialCode = 'auth_rejected' | 'request_timeout' | 'rate_limited' | 'provider_unavailable' | 'response_invalid';

export function dataRecord(value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || IS_PROXY(value) || Array.isArray(value)) return null;
        const prototype = Object.getPrototypeOf(value); const ownKeys = Reflect.ownKeys(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if ((prototype !== Object.prototype && prototype !== null)
            || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
            || required.some((key) => !ownKeys.includes(key))) return null;
        const copy: Record<string, unknown> = Object.create(null);
        for (const key of ownKeys) {
            if (typeof key !== 'string') return null;
            const descriptor = descriptors[key];
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}
export function lifecycleRecord(value: unknown): Record<string, unknown> | null {
    const state = dataRecord(value, LIFECYCLE_KEYS); if (!state) return null;
    if (state.binding === null) return state;
    const binding = dataRecord(state.binding, BINDING_KEYS); if (!binding) return null;
    state.binding = binding; return state;
}
function sameRecord(left: Record<string, unknown>, right: Record<string, unknown>, keys: readonly string[]): boolean {
    return keys.every((key) => Object.is(left[key], right[key]));
}
export function currentAuthorization(
    rawLifecycle: unknown, rawEvidence: unknown, expectedLifecycle: ReturnType<typeof snapshotProviderLifecycleV2>,
    expectedEvidence: Record<string, unknown>,
): boolean {
    const state = lifecycleRecord(rawLifecycle); const evidence = dataRecord(rawEvidence, EVIDENCE_KEYS);
    if (!state || !evidence || !sameRecord(evidence, expectedEvidence, EVIDENCE_KEYS)) return false;
    let current;
    try { current = snapshotProviderLifecycleV2(state); } catch { return false; }
    if (current.status !== 'enabled' || !current.binding || !expectedLifecycle.binding
        || current.schemaVersion !== expectedLifecycle.schemaVersion || current.generation !== expectedLifecycle.generation
        || current.status !== expectedLifecycle.status) return false;
    return sameRecord(current.binding as unknown as Record<string, unknown>,
        expectedLifecycle.binding as unknown as Record<string, unknown>, BINDING_KEYS);
}
export function brokerFacade(value: unknown): ProviderSecretBroker | null {
    const methods = dataRecord(value, BROKER_KEYS);
    if (!methods || BROKER_KEYS.some((key) => typeof methods[key] !== 'function' || IS_PROXY(methods[key]))) return null;
    const call = (name: typeof BROKER_KEYS[number], args: unknown[]) => Reflect.apply(
        methods[name] as (...parameters: unknown[]) => unknown, value, args);
    return Object.freeze({
        issue: (input: unknown) => call('issue', [input]), snapshot: (lease: unknown) => call('snapshot', [lease]),
        revoke: (lease: unknown) => call('revoke', [lease]),
        consume: (lease: unknown, claim: unknown, run: unknown) => call('consume', [lease, claim, run]),
    }) as unknown as ProviderSecretBroker;
}
export function readClock(now: () => unknown, minimum: number, fail: () => Error): number {
    let value: unknown;
    try { value = now(); } catch { throw fail(); }
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > ISO_DATE_MAX_MS) throw fail();
    return value as number;
}
export function httpStatusDenial(status: number): ProviderHttpDenialCode | null {
    if (status >= 200 && status < 300) return null;
    if (status === 401 || status === 403) return 'auth_rejected';
    if (status === 408) return 'request_timeout';
    if (status === 429) return 'rate_limited';
    return status >= 500 ? 'provider_unavailable' : 'response_invalid';
}
export function nativePromise(value: unknown): Promise<unknown> | null {
    try {
        if (!value || typeof value !== 'object' || IS_PROXY(value) || !IS_PROMISE(value)
            || Object.getPrototypeOf(value) !== PROMISE_PROTOTYPE || Object.hasOwn(value, 'constructor')) return null;
        return Reflect.apply(PROMISE_THEN, value, [(result: unknown) => result]);
    } catch { return null; }
}
export function checkedSignal(value: unknown): AbortSignal | undefined | null {
    if (value === undefined) return undefined;
    try {
        if (typeof ABORTED_GETTER !== 'function' || !value || typeof value !== 'object' || IS_PROXY(value)
            || Object.getPrototypeOf(value) !== AbortSignal.prototype) return null;
        Reflect.apply(ABORTED_GETTER, value, []); return value as AbortSignal;
    } catch { return null; }
}
export function isSignalAborted(signal: AbortSignal, fail: () => Error): boolean {
    try { return Reflect.apply(ABORTED_GETTER as () => boolean, signal, []) === true; }
    catch { throw fail(); }
}
export function addAbortListener(signal: AbortSignal, listener: () => void): void {
    Reflect.apply(ADD_EVENT_LISTENER, signal, ['abort', listener, { once: true }]);
}
export function removeAbortListener(signal: AbortSignal, listener: () => void): void {
    Reflect.apply(REMOVE_EVENT_LISTENER, signal, ['abort', listener]);
}
