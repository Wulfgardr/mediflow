/* @Codex */
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { types } from 'node:util';
import { snapshotProviderLifecycleV2 } from './provider-lifecycle';
import {
    authorizeProviderOperationV2, createProviderOperationReceiptV2,
    type ProviderOperationReceiptV2, type ProviderPolicyDenialCode,
} from './provider-operation-policy';
import {
    createProviderSecretBrokerV2, ProviderSecretBrokerV2Error,
    type ProviderHeaderInjectorV2, type ProviderSecretBrokerV2ErrorCode,
} from './provider-secret-broker';
export const ANTHROPIC_MESSAGES_V2_TARGET = 'anthropic.messages.v1.official_api' as const;
export const ANTHROPIC_MESSAGES_V2_VERSION = '2023-06-01' as const;
export const ANTHROPIC_MESSAGES_V2_MAX_TOKENS = 1_024 as const;

const RESPONSE_KEYS = ['id', 'type', 'role', 'model', 'content', 'stop_reason', 'stop_sequence', 'usage'] as const;
const CONTENT_KEYS = ['type', 'text'] as const;
const USAGE_KEYS = ['input_tokens', 'output_tokens'] as const;
const INPUT_KEYS = ['lifecycle', 'evidence', 'secretRef', 'broker', 'input', 'now', 'transport', 'signal'] as const;
const INPUT_REQUIRED_KEYS = ['lifecycle', 'evidence', 'secretRef', 'broker', 'input', 'now', 'transport'] as const;
const LIFECYCLE_KEYS = ['schemaVersion', 'generation', 'status', 'binding'] as const;
const BINDING_KEYS = ['schemaVersion', 'operation', 'providerId', 'kind', 'venue', 'model', 'dataClass', 'egressProfileRef',
    'retentionProfileRef', 'consentRef', 'timeoutMs', 'maxInputBytes', 'maxOutputBytes', 'fallback'] as const;
const EVIDENCE_KEYS = ['schemaVersion', 'egressProfileRef', 'retentionProfileRef', 'consentRef', 'egressPromoted',
    'retentionEligible', 'consentCurrent', 'redactionReceiptSha256'] as const;
const SECRET_REF_KEYS = ['scheme', 'name'] as const;
const BROKER_KEYS = ['issue', 'snapshot', 'revoke', 'consume'] as const;
const ISO_DATE_MAX_MS = 8_640_000_000_000_000;
const EXECUTION_CONTEXT = new AsyncLocalStorage<true>();
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const IS_PROXY = types.isProxy, IS_PROMISE = types.isPromise, PROMISE_PROTOTYPE = Promise.prototype;
const PROMISE_THEN = Promise.prototype.then;
type SecretBroker = ReturnType<typeof createProviderSecretBrokerV2>;
export type AnthropicMessagesV2ErrorCode = ProviderPolicyDenialCode | ProviderSecretBrokerV2ErrorCode
    | 'request_timeout' | 'request_cancelled' | 'response_too_large' | 'auth_rejected'
    | 'rate_limited' | 'provider_unavailable' | 'response_invalid';
export class AnthropicMessagesV2Error extends Error {
    constructor(public readonly code: AnthropicMessagesV2ErrorCode) {
        super(`Anthropic Messages v2 rejected: ${code}`); this.name = 'AnthropicMessagesV2Error';
    }
}
export type AnthropicMessagesHeadersV2 = Readonly<{ get(name: string): string | null }>;
export type AnthropicMessagesTransportRequestV2 = Readonly<{
    target: typeof ANTHROPIC_MESSAGES_V2_TARGET; method: 'POST'; headers: AnthropicMessagesHeadersV2;
    body: string; signal: AbortSignal; maxResponseBytes: number;
}>;
export type AnthropicMessagesTransportV2 = (request: AnthropicMessagesTransportRequestV2) => Promise<unknown>;
export type AnthropicMessagesExecutionV2 = Readonly<{ outputText: string; receipt: ProviderOperationReceiptV2 }>;
export type AnthropicMessagesExecutionInputV2 = Readonly<{
    lifecycle: unknown; evidence: unknown; secretRef: unknown; broker: SecretBroker; input: string;
    now: () => unknown; transport: AnthropicMessagesTransportV2; signal?: AbortSignal;
}>;
function dataRecord(value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> | null {
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
            const descriptor = descriptors[key]; if (!descriptor || !('value' in descriptor)) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}
function lifecycleRecord(value: unknown): Record<string, unknown> | null {
    const state = dataRecord(value, LIFECYCLE_KEYS); if (!state) return null;
    if (state.binding === null) return state;
    const binding = dataRecord(state.binding, BINDING_KEYS); if (!binding) return null;
    state.binding = binding; return state;
}
function sameRecord(left: Record<string, unknown>, right: Record<string, unknown>, keys: readonly string[]): boolean {
    return keys.every((key) => Object.is(left[key], right[key]));
}
function currentAuthorization(
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
function brokerFacade(value: unknown): SecretBroker | null {
    const methods = dataRecord(value, BROKER_KEYS);
    if (!methods || BROKER_KEYS.some((key) => typeof methods[key] !== 'function' || IS_PROXY(methods[key]))) return null;
    const call = (name: typeof BROKER_KEYS[number], args: unknown[]) => Reflect.apply(
        methods[name] as (...parameters: unknown[]) => unknown, value, args);
    return Object.freeze({
        issue: (input: unknown) => call('issue', [input]), snapshot: (lease: unknown) => call('snapshot', [lease]),
        revoke: (lease: unknown) => call('revoke', [lease]),
        consume: (lease: unknown, claim: unknown, run: unknown) => call('consume', [lease, claim, run]),
    }) as unknown as SecretBroker;
}
function clock(now: () => unknown, minimum = 0): number {
    let value: unknown;
    try { value = now(); } catch { throw new AnthropicMessagesV2Error('response_invalid'); }
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > ISO_DATE_MAX_MS) {
        throw new AnthropicMessagesV2Error('response_invalid');
    }
    return value as number;
}
function statusError(status: number): AnthropicMessagesV2ErrorCode | null {
    if (status >= 200 && status < 300) return null;
    if (status === 401 || status === 403) return 'auth_rejected';
    if (status === 408) return 'request_timeout';
    if (status === 429) return 'rate_limited';
    return status >= 500 ? 'provider_unavailable' : 'response_invalid';
}
function nativePromise(value: unknown): Promise<unknown> | null {
    try {
        if (!value || typeof value !== 'object' || IS_PROXY(value) || !IS_PROMISE(value)
            || Object.getPrototypeOf(value) !== PROMISE_PROTOTYPE || Object.hasOwn(value, 'constructor')) return null;
        return Reflect.apply(PROMISE_THEN, value, [(result: unknown) => result]);
    } catch { return null; }
}

function checkedSignal(value: unknown): AbortSignal | undefined | null {
    if (value === undefined) return undefined;
    try {
        if (typeof ABORTED_GETTER !== 'function' || !value || typeof value !== 'object' || IS_PROXY(value)
            || Object.getPrototypeOf(value) !== AbortSignal.prototype) return null;
        Reflect.apply(ABORTED_GETTER, value, []); return value as AbortSignal;
    } catch { return null; }
}

function isAborted(signal: AbortSignal): boolean {
    try { return Reflect.apply(ABORTED_GETTER as () => boolean, signal, []) === true; }
    catch { throw new AnthropicMessagesV2Error('input_invalid'); }
}

function addAbortListener(signal: AbortSignal, listener: () => void): void {
    Reflect.apply(ADD_EVENT_LISTENER, signal, ['abort', listener, { once: true }]);
}

function removeAbortListener(signal: AbortSignal, listener: () => void): void {
    Reflect.apply(REMOVE_EVENT_LISTENER, signal, ['abort', listener]);
}

function parseResponse(body: string, model: string): Readonly<{
    id: string; text: string; tokensIn: number; tokensOut: number;
}> | null {
    let value: unknown;
    try { value = JSON.parse(body); } catch { return null; }
    const response = dataRecord(value, RESPONSE_KEYS); if (!response) return null;
    const { id, type, role, model: responseModel, content, stop_reason: stopReason,
        stop_sequence: stopSequence, usage: usageValue } = response;
    if (typeof id !== 'string' || !/^msg_[a-zA-Z0-9._:-]{1,123}$/.test(id) || type !== 'message'
        || role !== 'assistant' || responseModel !== model || stopReason !== 'end_turn' || stopSequence !== null
        || !Array.isArray(content) || content.length !== 1) return null;
    const part = dataRecord(content[0], CONTENT_KEYS); const usage = dataRecord(usageValue, USAGE_KEYS);
    if (!part || part.type !== 'text' || typeof part.text !== 'string' || part.text.length === 0 || !usage
        || !Number.isSafeInteger(usage.input_tokens) || (usage.input_tokens as number) < 0
        || !Number.isSafeInteger(usage.output_tokens) || (usage.output_tokens as number) < 0) return null;
    return Object.freeze({ id, text: part.text, tokensIn: usage.input_tokens as number, tokensOut: usage.output_tokens as number });
}

function createHeaders(inject: ProviderHeaderInjectorV2): Readonly<{
    headers: AnthropicMessagesHeadersV2; clear(): void;
}> {
    if (typeof inject !== 'function' || IS_PROXY(inject)) throw new Error('header');
    const values = new Map<string, string>([
        ['content-type', 'application/json'], ['anthropic-version', ANTHROPIC_MESSAGES_V2_VERSION],
        ['user-agent', 'MediFlow/0.8.5 provider-v2'],
    ]);
    let active = true;
    const sink = Object.freeze({ set(name: string, value: string) {
        if (!active || name.toLowerCase() !== 'x-api-key' || values.has('x-api-key')) throw new Error('header');
        values.set('x-api-key', value);
    } });
    inject(sink);
    const headers = Object.freeze({ get(name: string) { return active ? values.get(name.toLowerCase()) ?? null : null; } });
    return Object.freeze({ headers, clear() { active = false; values.clear(); } });
}

async function executeAnthropicMessagesV2Internal(
    inputValue: AnthropicMessagesExecutionInputV2,
): Promise<AnthropicMessagesExecutionV2> {
    const inputRecord = dataRecord(inputValue, INPUT_KEYS, INPUT_REQUIRED_KEYS);
    if (!inputRecord) throw new AnthropicMessagesV2Error('input_invalid');
    const rawLifecycle = inputRecord.lifecycle; const rawEvidence = inputRecord.evidence;
    const lifecycleValue = lifecycleRecord(rawLifecycle);
    const evidenceValue = dataRecord(rawEvidence, EVIDENCE_KEYS);
    const secretRef = dataRecord(inputRecord.secretRef, SECRET_REF_KEYS);
    if (!lifecycleValue || !evidenceValue || !secretRef) throw new AnthropicMessagesV2Error('input_invalid');
    const broker = brokerFacade(inputRecord.broker);
    if (!broker) throw new AnthropicMessagesV2Error('input_invalid');
    const input = inputRecord.input; const now = inputRecord.now; const transport = inputRecord.transport;
    const signal = checkedSignal(inputRecord.signal);
    if (signal === null) throw new AnthropicMessagesV2Error('input_invalid');
    let lifecycle;
    try { lifecycle = snapshotProviderLifecycleV2(lifecycleValue); }
    catch { throw new AnthropicMessagesV2Error('input_invalid'); }
    const binding = lifecycle.binding;
    if (!binding || binding.providerId !== 'anthropic') throw new AnthropicMessagesV2Error('provider_disabled');
    if (typeof input !== 'string' || typeof transport !== 'function' || IS_PROXY(transport)
        || typeof now !== 'function' || IS_PROXY(now)) {
        throw new AnthropicMessagesV2Error('input_invalid');
    }
    if (new TextEncoder().encode(input).byteLength > binding.maxInputBytes) {
        throw new AnthropicMessagesV2Error('input_invalid');
    }
    if (signal && isAborted(signal)) throw new AnthropicMessagesV2Error('request_cancelled');
    const startedAt = clock(now as () => unknown);
    if (!currentAuthorization(rawLifecycle, rawEvidence, lifecycle, evidenceValue)) {
        throw new AnthropicMessagesV2Error('provider_disabled');
    }
    const claim = Object.freeze({ providerId: 'anthropic' as const, operation: binding.operation, generation: lifecycle.generation });
    const authorization = authorizeProviderOperationV2({ lifecycle, evidence: evidenceValue }, () => (
        broker.issue({ ...claim, secretRef })
    ));
    if (authorization.status === 'denied') throw new AnthropicMessagesV2Error(authorization.code);
    if (!currentAuthorization(rawLifecycle, rawEvidence, lifecycle, evidenceValue)) {
        try { broker.revoke(authorization.secretLease); } catch { /* fail closed below */ }
        throw new AnthropicMessagesV2Error('provider_disabled');
    }
    if (signal && isAborted(signal)) {
        broker.revoke(authorization.secretLease); throw new AnthropicMessagesV2Error('request_cancelled');
    }
    const body = JSON.stringify({ model: binding.model, max_tokens: ANTHROPIC_MESSAGES_V2_MAX_TOKENS,
        messages: [{ role: 'user', content: input }] });
    const controller = new AbortController(); let abortCode: 'request_timeout' | 'request_cancelled' | null = null;
    const cancel = () => { if (!abortCode) { abortCode = 'request_cancelled'; controller.abort(); } };
    if (signal) addAbortListener(signal, cancel);
    const timer = setTimeout(() => { if (!abortCode) { abortCode = 'request_timeout'; controller.abort(); } }, binding.timeoutMs);
    let transportOutcome: Readonly<{ ok: true; value: unknown }>
        | Readonly<{ ok: false; code: 'provider_unavailable' | 'response_invalid' | 'provider_disabled' }>;
    try {
        const consumption = broker.consume(authorization.secretLease, claim, async (inject) => {
            const headerBag = createHeaders(inject);
            try {
                if (!currentAuthorization(rawLifecycle, rawEvidence, lifecycle, evidenceValue)) {
                    return { ok: false as const, code: 'provider_disabled' as const };
                }
                const request = Object.freeze({ target: ANTHROPIC_MESSAGES_V2_TARGET, method: 'POST' as const,
                    headers: headerBag.headers, body, signal: controller.signal, maxResponseBytes: binding.maxOutputBytes });
                const aborted = new Promise<never>((_resolve, reject) => addAbortListener(controller.signal,
                    () => reject(new Error('aborted'))));
                let pending: unknown;
                try { pending = Reflect.apply(transport as AnthropicMessagesTransportV2, undefined, [request]); }
                catch { return { ok: false as const, code: 'provider_unavailable' as const }; }
                const pendingPromise = nativePromise(pending);
                if (!pendingPromise) return { ok: false as const, code: 'response_invalid' as const };
                try { return { ok: true as const, value: await Promise.race([pendingPromise, aborted]) }; }
                catch { return { ok: false as const, code: 'provider_unavailable' as const }; }
            } finally { headerBag.clear(); }
        });
        const consumptionPromise = nativePromise(consumption);
        if (!consumptionPromise) throw new Error('broker');
        transportOutcome = await consumptionPromise as typeof transportOutcome;
    } catch (error) {
        if (error instanceof ProviderSecretBrokerV2Error) throw new AnthropicMessagesV2Error(error.code);
        throw new AnthropicMessagesV2Error('secret_unavailable');
    } finally {
        clearTimeout(timer); if (signal) removeAbortListener(signal, cancel);
    }
    if (abortCode) throw new AnthropicMessagesV2Error(abortCode);
    if (!transportOutcome.ok) throw new AnthropicMessagesV2Error(transportOutcome.code);
    const envelope = dataRecord(transportOutcome.value, ['status', 'body']);
    if (!envelope || !Number.isSafeInteger(envelope.status) || (envelope.status as number) < 100
        || (envelope.status as number) > 599 || typeof envelope.body !== 'string') throw new AnthropicMessagesV2Error('response_invalid');
    if (new TextEncoder().encode(envelope.body).byteLength > binding.maxOutputBytes) {
        throw new AnthropicMessagesV2Error('response_too_large');
    }
    const mapped = statusError(envelope.status as number); if (mapped) throw new AnthropicMessagesV2Error(mapped);
    const parsed = parseResponse(envelope.body, binding.model); if (!parsed) throw new AnthropicMessagesV2Error('response_invalid');
    const completedAtMs = clock(now as () => unknown, startedAt);
    if (!currentAuthorization(rawLifecycle, rawEvidence, lifecycle, evidenceValue) || (signal && isAborted(signal))) {
        throw new AnthropicMessagesV2Error('provider_disabled');
    }
    const validation = Object.freeze({ schemaVersion: 'mediflow.ai.provider-response-validation.v2', validated: true,
        payloadSha256: createHash('sha256').update(body).digest('hex'),
        outputSha256: createHash('sha256').update(parsed.text).digest('hex'), vendorRequestId: parsed.id,
        latencyMs: completedAtMs - startedAt, tokensIn: parsed.tokensIn, tokensOut: parsed.tokensOut,
        completedAt: new Date(completedAtMs).toISOString() });
    const receipt = createProviderOperationReceiptV2(authorization, validation);
    if (!receipt) throw new AnthropicMessagesV2Error('response_invalid');
    return Object.freeze({ outputText: parsed.text, receipt });
}

export function executeAnthropicMessagesV2(
    inputValue: AnthropicMessagesExecutionInputV2,
): Promise<AnthropicMessagesExecutionV2> {
    if (EXECUTION_CONTEXT.getStore()) return Promise.reject(new AnthropicMessagesV2Error('input_invalid'));
    return EXECUTION_CONTEXT.run(true, () => executeAnthropicMessagesV2Internal(inputValue));
}
