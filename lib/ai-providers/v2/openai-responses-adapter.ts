/* @Codex */
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { types } from 'node:util';
import { snapshotProviderLifecycleV2 } from './provider-lifecycle';
import { authorizeProviderOperationV2, createProviderOperationReceiptV2, type ProviderOperationReceiptV2,
    type ProviderPolicyDenialCode } from './provider-operation-policy';
import { createProviderSecretBrokerV2, ProviderSecretBrokerV2Error, type ProviderHeaderInjectorV2,
    type ProviderSecretBrokerV2ErrorCode } from './provider-secret-broker';
export const OPENAI_RESPONSES_V2_TARGET = 'openai.responses.v1.official_api' as const;
const RESPONSE_KEYS = ['id', 'object', 'created_at', 'status', 'background', 'completed_at', 'conversation', 'error',
    'incomplete_details', 'instructions', 'max_output_tokens', 'max_tool_calls', 'metadata', 'model', 'output',
    'parallel_tool_calls', 'previous_response_id', 'prompt', 'prompt_cache_key', 'prompt_cache_options', 'reasoning',
    'safety_identifier', 'service_tier', 'store', 'temperature', 'text', 'tool_choice', 'tools', 'top_p', 'truncation',
    'usage', 'user'] as const;
const MESSAGE_KEYS = ['id', 'type', 'status', 'role', 'content'] as const;
const REASONING_KEYS = ['id', 'summary', 'type', 'content', 'encrypted_content', 'status'] as const;
const OUTPUT_ITEM_KEYS = ['id', 'type', 'status', 'role', 'content', 'summary', 'encrypted_content'] as const;
const CONTENT_KEYS = ['type', 'text', 'annotations', 'logprobs'] as const;
const USAGE_KEYS = ['input_tokens', 'input_tokens_details', 'output_tokens', 'output_tokens_details', 'total_tokens'] as const;
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
const HEADERS_DELETE = Headers.prototype.delete;
const IS_PROXY = types.isProxy, IS_PROMISE = types.isPromise, PROMISE_PROTOTYPE = Promise.prototype;
const PROMISE_THEN = Promise.prototype.then;
type SecretBroker = ReturnType<typeof createProviderSecretBrokerV2>;
export type OpenAIResponsesV2ErrorCode = ProviderPolicyDenialCode | ProviderSecretBrokerV2ErrorCode
    | 'request_timeout' | 'request_cancelled' | 'response_too_large' | 'auth_rejected'
    | 'rate_limited' | 'provider_unavailable' | 'response_invalid';
export class OpenAIResponsesV2Error extends Error {
    constructor(public readonly code: OpenAIResponsesV2ErrorCode) {
        super(`OpenAI Responses v2 rejected: ${code}`); this.name = 'OpenAIResponsesV2Error';
    }
}
export type OpenAIResponsesTransportRequestV2 = Readonly<{
    target: typeof OPENAI_RESPONSES_V2_TARGET; method: 'POST'; headers: Headers; body: string;
    signal: AbortSignal; maxResponseBytes: number;
}>;
export type OpenAIResponsesTransportV2 = (request: OpenAIResponsesTransportRequestV2) => Promise<unknown>;
export type OpenAIResponsesExecutionV2 = Readonly<{ outputText: string; receipt: ProviderOperationReceiptV2 }>;
export type OpenAIResponsesExecutionInputV2 = Readonly<{
    lifecycle: unknown; evidence: unknown; secretRef: unknown; broker: SecretBroker; input: string;
    now: () => unknown; transport: OpenAIResponsesTransportV2; signal?: AbortSignal;
}>;
function dataRecord(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || IS_PROXY(value) || Array.isArray(value)) return null;
        const prototype = Object.getPrototypeOf(value); const keys = Reflect.ownKeys(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if ((prototype !== Object.prototype && prototype !== null)
            || keys.some((key) => typeof key !== 'string' || !allowed.includes(key))
            || required.some((key) => !keys.includes(key))) return null;
        const copy: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            if (typeof key !== 'string') return null;
            const descriptor = descriptors[key];
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
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
function read(source: Record<string, unknown>, keys: readonly string[]): unknown[] | null {
    try { return keys.map((key) => source[key]); } catch { return null; }
}
function clock(now: () => unknown, minimum = 0): number {
    let value: unknown;
    try { value = now(); } catch { throw new OpenAIResponsesV2Error('response_invalid'); }
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > ISO_DATE_MAX_MS) {
        throw new OpenAIResponsesV2Error('response_invalid');
    }
    return value as number;
}
function nonnegative(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function responseCode(status: number): OpenAIResponsesV2ErrorCode | null {
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
    catch { throw new OpenAIResponsesV2Error('input_invalid'); }
}
function addAbortListener(signal: AbortSignal, listener: () => void): void {
    Reflect.apply(ADD_EVENT_LISTENER, signal, ['abort', listener, { once: true }]);
}
function removeAbortListener(signal: AbortSignal, listener: () => void): void {
    Reflect.apply(REMOVE_EVENT_LISTENER, signal, ['abort', listener]);
}
function createHeaders(inject: ProviderHeaderInjectorV2): Readonly<{ headers: Headers; clear(): void }> {
    if (typeof inject !== 'function' || IS_PROXY(inject)) throw new Error('header');
    const values = new Map<string, string>([
        ['content-type', 'application/json'], ['user-agent', 'MediFlow/0.8.5 provider-v2'],
    ]);
    let active = true;
    const sink = Object.freeze({ set(name: string, value: string) {
        if (!active || name.toLowerCase() !== 'authorization' || values.has('authorization')) throw new Error('header');
        values.set('authorization', value);
    } });
    try { inject(sink); }
    catch (error) { active = false; values.clear(); throw error; }
    if (!/^Bearer [\x21-\x7e]{16,4096}$/u.test(values.get('authorization') ?? '')) {
        active = false; values.clear(); throw new Error('header');
    }
    let headers: Headers;
    try { headers = new Headers(Array.from(values)); }
    catch (error) { active = false; values.clear(); throw error; }
    return Object.freeze({ headers, clear() {
        if (!active) return;
        active = false; values.clear();
        for (const name of ['authorization', 'content-type', 'user-agent']) {
            try { Reflect.apply(HEADERS_DELETE, headers, [name]); } catch { /* no retained credential */ }
        }
    } });
}
function parseResponse(body: string, model: string): { id: string; text: string; tokensIn: number; tokensOut: number } | null {
    let value: unknown;
    try { value = JSON.parse(body); } catch { return null; }
    const source = dataRecord(value, RESPONSE_KEYS, ['id', 'object', 'status', 'model', 'output', 'usage']);
    if (!source) return null;
    const values = read(source, ['id', 'object', 'status', 'model', 'output', 'usage']); if (!values) return null;
    const [id, object, status, responseModel, output, usageValue] = values;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id)
        || object !== 'response' || status !== 'completed' || responseModel !== model
        || !Array.isArray(output) || output.length === 0) return null;
    let message: Record<string, unknown> | null = null;
    for (const item of output) {
        const candidate = dataRecord(item, OUTPUT_ITEM_KEYS, ['type']); if (!candidate) return null;
        if (candidate.type === 'reasoning') {
            const reasoning = dataRecord(item, REASONING_KEYS, ['id', 'summary', 'type']);
            if (!reasoning || typeof reasoning.id !== 'string' || !Array.isArray(reasoning.summary)
                || (reasoning.status !== undefined && reasoning.status !== 'completed')) return null;
        } else {
            if (candidate.type !== 'message' || message) return null;
            message = dataRecord(item, MESSAGE_KEYS, MESSAGE_KEYS); if (!message) return null;
        }
    }
    if (!message) return null;
    const messageValues = read(message, MESSAGE_KEYS); if (!messageValues) return null;
    const [, type, messageStatus, role, content] = messageValues;
    if (type !== 'message' || messageStatus !== 'completed' || role !== 'assistant'
        || !Array.isArray(content) || content.length !== 1) return null;
    const part = dataRecord(content[0], CONTENT_KEYS, ['type', 'text', 'annotations']); if (!part) return null;
    const partValues = read(part, ['type', 'text', 'annotations']); if (!partValues) return null;
    const [partType, text, annotations] = partValues;
    const usage = dataRecord(usageValue, USAGE_KEYS, USAGE_KEYS); if (!usage) return null;
    const usageValues = read(usage, ['input_tokens', 'output_tokens', 'total_tokens']); if (!usageValues) return null;
    const [tokensIn, tokensOut, totalTokens] = usageValues;
    if (partType !== 'output_text' || typeof text !== 'string' || text.length === 0 || !Array.isArray(annotations)
        || !nonnegative(tokensIn) || !nonnegative(tokensOut) || !nonnegative(totalTokens)
        || totalTokens !== tokensIn + tokensOut) return null;
    return { id, text, tokensIn, tokensOut };
}
async function executeOpenAIResponsesV2Internal(
    inputValue: OpenAIResponsesExecutionInputV2,
): Promise<OpenAIResponsesExecutionV2> {
    const inputRecord = dataRecord(inputValue, INPUT_KEYS, INPUT_REQUIRED_KEYS);
    if (!inputRecord) throw new OpenAIResponsesV2Error('input_invalid');
    const rawLifecycle = inputRecord.lifecycle; const rawEvidence = inputRecord.evidence;
    const lifecycleValue = lifecycleRecord(rawLifecycle);
    const evidenceValue = dataRecord(rawEvidence, EVIDENCE_KEYS);
    const secretRef = dataRecord(inputRecord.secretRef, SECRET_REF_KEYS);
    if (!lifecycleValue || !evidenceValue || !secretRef) throw new OpenAIResponsesV2Error('input_invalid');
    const broker = brokerFacade(inputRecord.broker); if (!broker) throw new OpenAIResponsesV2Error('input_invalid');
    const input = inputRecord.input; const now = inputRecord.now; const transport = inputRecord.transport;
    const signal = checkedSignal(inputRecord.signal); if (signal === null) throw new OpenAIResponsesV2Error('input_invalid');
    let lifecycle;
    try { lifecycle = snapshotProviderLifecycleV2(lifecycleValue); }
    catch { throw new OpenAIResponsesV2Error('input_invalid'); }
    const binding = lifecycle.binding;
    if (!binding || binding.providerId !== 'openai') throw new OpenAIResponsesV2Error('provider_disabled');
    if (typeof input !== 'string' || typeof transport !== 'function' || IS_PROXY(transport)
        || typeof now !== 'function' || IS_PROXY(now)) throw new OpenAIResponsesV2Error('input_invalid');
    if (new TextEncoder().encode(input).byteLength > binding.maxInputBytes) throw new OpenAIResponsesV2Error('input_invalid');
    if (signal && isAborted(signal)) throw new OpenAIResponsesV2Error('request_cancelled');
    const startedAt = clock(now as () => unknown);
    if (!currentAuthorization(rawLifecycle, rawEvidence, lifecycle, evidenceValue)) {
        throw new OpenAIResponsesV2Error('provider_disabled');
    }
    const claim = Object.freeze({ providerId: 'openai' as const, operation: binding.operation, generation: lifecycle.generation });
    const authorization = authorizeProviderOperationV2({ lifecycle, evidence: evidenceValue }, () => (
        broker.issue({ ...claim, secretRef })
    ));
    if (authorization.status === 'denied') throw new OpenAIResponsesV2Error(authorization.code);
    if (!currentAuthorization(rawLifecycle, rawEvidence, lifecycle, evidenceValue)) {
        try { broker.revoke(authorization.secretLease); } catch { /* fail closed below */ }
        throw new OpenAIResponsesV2Error('provider_disabled');
    }
    if (signal && isAborted(signal)) {
        broker.revoke(authorization.secretLease); throw new OpenAIResponsesV2Error('request_cancelled');
    }
    const body = JSON.stringify({ model: binding.model, input, store: false, background: false });
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
                const request = Object.freeze({ target: OPENAI_RESPONSES_V2_TARGET, method: 'POST' as const,
                    headers: headerBag.headers, body, signal: controller.signal, maxResponseBytes: binding.maxOutputBytes });
                if (isAborted(controller.signal)) return { ok: false as const, code: 'provider_unavailable' as const };
                let pending: unknown;
                try { pending = Reflect.apply(transport as OpenAIResponsesTransportV2, undefined, [request]); }
                catch { return { ok: false as const, code: 'provider_unavailable' as const }; }
                const pendingPromise = nativePromise(pending);
                if (!pendingPromise) return { ok: false as const, code: 'response_invalid' as const };
                let abortListener: () => void = () => undefined;
                const aborted = new Promise<never>((_resolve, reject) => {
                    abortListener = () => reject(new Error('aborted'));
                    addAbortListener(controller.signal, abortListener);
                });
                if (isAborted(controller.signal)) abortListener();
                try {
                    return { ok: true as const, value: await Promise.race([pendingPromise, aborted]) };
                } catch { return { ok: false as const, code: 'provider_unavailable' as const }; }
                finally { removeAbortListener(controller.signal, abortListener); }
            } finally { headerBag.clear(); }
        });
        const consumptionPromise = nativePromise(consumption); if (!consumptionPromise) throw new Error('broker');
        transportOutcome = await consumptionPromise as typeof transportOutcome;
    } catch (error) {
        if (error instanceof ProviderSecretBrokerV2Error) throw new OpenAIResponsesV2Error(error.code);
        throw new OpenAIResponsesV2Error('secret_unavailable');
    } finally {
        clearTimeout(timer); if (signal) removeAbortListener(signal, cancel);
    }
    if (abortCode) throw new OpenAIResponsesV2Error(abortCode);
    if (!transportOutcome.ok) throw new OpenAIResponsesV2Error(transportOutcome.code);
    const envelope = dataRecord(transportOutcome.value, ['status', 'body']);
    if (!envelope || !Number.isSafeInteger(envelope.status) || (envelope.status as number) < 100
        || (envelope.status as number) > 599 || typeof envelope.body !== 'string') {
        throw new OpenAIResponsesV2Error('response_invalid');
    }
    if (new TextEncoder().encode(envelope.body).byteLength > binding.maxOutputBytes) {
        throw new OpenAIResponsesV2Error('response_too_large');
    }
    const statusCode = responseCode(envelope.status as number); if (statusCode) throw new OpenAIResponsesV2Error(statusCode);
    const parsed = parseResponse(envelope.body, binding.model); if (!parsed) throw new OpenAIResponsesV2Error('response_invalid');
    const completedAtMs = clock(now as () => unknown, startedAt);
    if (!currentAuthorization(rawLifecycle, rawEvidence, lifecycle, evidenceValue)) {
        throw new OpenAIResponsesV2Error('provider_disabled');
    }
    if (signal && isAborted(signal)) throw new OpenAIResponsesV2Error('request_cancelled');
    const validation = Object.freeze({ schemaVersion: 'mediflow.ai.provider-response-validation.v2', validated: true,
        payloadSha256: createHash('sha256').update(body).digest('hex'),
        outputSha256: createHash('sha256').update(parsed.text).digest('hex'), vendorRequestId: parsed.id,
        latencyMs: completedAtMs - startedAt, tokensIn: parsed.tokensIn, tokensOut: parsed.tokensOut,
        completedAt: new Date(completedAtMs).toISOString() });
    const receipt = createProviderOperationReceiptV2(authorization, validation);
    if (!receipt) throw new OpenAIResponsesV2Error('response_invalid');
    return Object.freeze({ outputText: parsed.text, receipt });
}

export function executeOpenAIResponsesV2(
    inputValue: OpenAIResponsesExecutionInputV2,
): Promise<OpenAIResponsesExecutionV2> {
    if (EXECUTION_CONTEXT.getStore()) return Promise.reject(new OpenAIResponsesV2Error('input_invalid'));
    return EXECUTION_CONTEXT.run(true, () => executeOpenAIResponsesV2Internal(inputValue));
}
