/* @Codex */
import { createHash } from 'node:crypto';
import { snapshotProviderLifecycleV2 } from './provider-lifecycle';
import { authorizeProviderOperationV2, createProviderOperationReceiptV2, type ProviderOperationReceiptV2,
    type ProviderPolicyDenialCode } from './provider-operation-policy';
import { createProviderSecretBrokerV2, ProviderSecretBrokerV2Error, type ProviderSecretBrokerV2ErrorCode } from './provider-secret-broker';
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
const ISO_DATE_MAX_MS = 8_640_000_000_000_000;
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
function record(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    try {
        const prototype = Object.getPrototypeOf(value); const keys = Reflect.ownKeys(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        return (prototype === Object.prototype || prototype === null)
            && keys.every((key) => typeof key === 'string' && allowed.includes(key))
            && keys.every((key) => typeof key === 'string' && descriptors[key] && 'value' in descriptors[key])
            && required.every((key) => Object.hasOwn(value, key)) ? value as Record<string, unknown> : null;
    } catch { return null; }
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
function parseResponse(body: string, model: string): { id: string; text: string; tokensIn: number; tokensOut: number } | null {
    let value: unknown;
    try { value = JSON.parse(body); } catch { return null; }
    const source = record(value, RESPONSE_KEYS, ['id', 'object', 'status', 'model', 'output', 'usage']);
    if (!source) return null;
    const values = read(source, ['id', 'object', 'status', 'model', 'output', 'usage']); if (!values) return null;
    const [id, object, status, responseModel, output, usageValue] = values;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id)
        || object !== 'response' || status !== 'completed' || responseModel !== model
        || !Array.isArray(output) || output.length === 0) return null;
    let message: Record<string, unknown> | null = null;
    for (const item of output) {
        const candidate = record(item, OUTPUT_ITEM_KEYS, ['type']); if (!candidate) return null;
        if (candidate.type === 'reasoning') {
            const reasoning = record(item, REASONING_KEYS, ['id', 'summary', 'type']);
            if (!reasoning || typeof reasoning.id !== 'string' || !Array.isArray(reasoning.summary)
                || (reasoning.status !== undefined && reasoning.status !== 'completed')) return null;
        } else {
            if (candidate.type !== 'message' || message) return null;
            message = record(item, MESSAGE_KEYS, MESSAGE_KEYS); if (!message) return null;
        }
    }
    if (!message) return null;
    const messageValues = read(message, MESSAGE_KEYS); if (!messageValues) return null;
    const [, type, messageStatus, role, content] = messageValues;
    if (type !== 'message' || messageStatus !== 'completed' || role !== 'assistant'
        || !Array.isArray(content) || content.length !== 1) return null;
    const part = record(content[0], CONTENT_KEYS, ['type', 'text', 'annotations']); if (!part) return null;
    const partValues = read(part, ['type', 'text', 'annotations']); if (!partValues) return null;
    const [partType, text, annotations] = partValues;
    const usage = record(usageValue, USAGE_KEYS, USAGE_KEYS); if (!usage) return null;
    const usageValues = read(usage, ['input_tokens', 'output_tokens', 'total_tokens']); if (!usageValues) return null;
    const [tokensIn, tokensOut, totalTokens] = usageValues;
    if (partType !== 'output_text' || typeof text !== 'string' || text.length === 0 || !Array.isArray(annotations)
        || !nonnegative(tokensIn) || !nonnegative(tokensOut) || !nonnegative(totalTokens)
        || totalTokens !== tokensIn + tokensOut) return null;
    return { id, text, tokensIn, tokensOut };
}
export async function executeOpenAIResponsesV2(inputValue: OpenAIResponsesExecutionInputV2): Promise<OpenAIResponsesExecutionV2> {
    let lifecycle;
    try { lifecycle = snapshotProviderLifecycleV2(inputValue.lifecycle); } catch { throw new OpenAIResponsesV2Error('input_invalid'); }
    const binding = lifecycle.binding;
    if (!binding || binding.providerId !== 'openai') throw new OpenAIResponsesV2Error('provider_disabled');
    if (typeof inputValue.input !== 'string' || typeof inputValue.transport !== 'function'
        || typeof inputValue.now !== 'function') throw new OpenAIResponsesV2Error('input_invalid');
    if (new TextEncoder().encode(inputValue.input).byteLength > binding.maxInputBytes) throw new OpenAIResponsesV2Error('input_invalid');
    if (inputValue.signal?.aborted) throw new OpenAIResponsesV2Error('request_cancelled');
    const startedAt = clock(inputValue.now);
    const claim = Object.freeze({ providerId: 'openai' as const, operation: binding.operation, generation: lifecycle.generation });
    const authorization = authorizeProviderOperationV2({ lifecycle, evidence: inputValue.evidence }, () => (
        inputValue.broker.issue({ ...claim, secretRef: inputValue.secretRef })
    ));
    if (authorization.status === 'denied') throw new OpenAIResponsesV2Error(authorization.code);
    if (inputValue.signal?.aborted) { inputValue.broker.revoke(authorization.secretLease); throw new OpenAIResponsesV2Error('request_cancelled'); }
    const body = JSON.stringify({ model: binding.model, input: inputValue.input, store: false, background: false });
    const controller = new AbortController(); let abortCode: 'request_timeout' | 'request_cancelled' | null = null;
    const cancel = () => { if (!abortCode) { abortCode = 'request_cancelled'; controller.abort(); } };
    inputValue.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { if (!abortCode) { abortCode = 'request_timeout'; controller.abort(); } }, binding.timeoutMs);
    let transportOutcome: Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }>;
    try {
        transportOutcome = await inputValue.broker.consume(authorization.secretLease, claim, async (inject) => {
            const headers = new Headers({ 'Content-Type': 'application/json', 'User-Agent': 'MediFlow/0.8.5 provider-v2' });
            inject(headers);
            const request = Object.freeze({ target: OPENAI_RESPONSES_V2_TARGET, method: 'POST' as const, headers, body,
                signal: controller.signal, maxResponseBytes: binding.maxOutputBytes });
            const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
            try { return { ok: true as const, value: await Promise.race([inputValue.transport(request), aborted]) }; }
            catch { return { ok: false as const }; }
        });
    } catch (error) {
        if (error instanceof ProviderSecretBrokerV2Error) throw new OpenAIResponsesV2Error(error.code);
        throw new OpenAIResponsesV2Error('secret_unavailable');
    } finally {
        clearTimeout(timer); inputValue.signal?.removeEventListener('abort', cancel);
    }
    if (abortCode) throw new OpenAIResponsesV2Error(abortCode);
    if (!transportOutcome.ok) throw new OpenAIResponsesV2Error('provider_unavailable');
    const envelope = record(transportOutcome.value, ['status', 'body'], ['status', 'body']);
    const envelopeValues = envelope && read(envelope, ['status', 'body']);
    if (!envelopeValues) throw new OpenAIResponsesV2Error('response_invalid');
    const [status, responseBody] = envelopeValues;
    if (!Number.isSafeInteger(status) || (status as number) < 100 || (status as number) > 599 || typeof responseBody !== 'string') {
        throw new OpenAIResponsesV2Error('response_invalid');
    }
    if (new TextEncoder().encode(responseBody).byteLength > binding.maxOutputBytes) throw new OpenAIResponsesV2Error('response_too_large');
    const statusCode = responseCode(status as number); if (statusCode) throw new OpenAIResponsesV2Error(statusCode);
    const parsed = parseResponse(responseBody, binding.model); if (!parsed) throw new OpenAIResponsesV2Error('response_invalid');
    const completedAtMs = clock(inputValue.now, startedAt); const validation = Object.freeze({
        schemaVersion: 'mediflow.ai.provider-response-validation.v2', validated: true,
        payloadSha256: createHash('sha256').update(body).digest('hex'),
        outputSha256: createHash('sha256').update(parsed.text).digest('hex'), vendorRequestId: parsed.id,
        latencyMs: completedAtMs - startedAt, tokensIn: parsed.tokensIn, tokensOut: parsed.tokensOut,
        completedAt: new Date(completedAtMs).toISOString(),
    });
    const receipt = createProviderOperationReceiptV2(authorization, validation);
    if (!receipt) throw new OpenAIResponsesV2Error('response_invalid');
    return Object.freeze({ outputText: parsed.text, receipt });
}
