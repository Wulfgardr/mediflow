/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { assertLocalOllamaModelReference, strictOllamaLoopbackBaseUrl } from '../ollama-locality';
import { createLocalOcrExecutionContract } from './local-ocr-execution-contract';

type Mode = 'full' | 'patient' | 'labs';
type Meta = Readonly<{ fallback: 'denied_by_contract'; applyPolicy: 'none'; writesPerformed: 0 }>;
type Binding = Readonly<{ provider: 'ollama_ocr'; venue: 'local_process'; egress: 'none' }>;
type Readiness = Readonly<{ provider: 'ollama'; model: string; state: 'available' }>;
export type LocalOcrOllamaExecutionDenialCode = 'policy_invalid' | 'envelope_invalid' | 'provider_unavailable' | 'provider_timeout' | 'provider_cancelled' | 'response_invalid' | 'response_mismatch' | 'response_oversized' | 'low_signal';
export type LocalOcrOllamaExecutionResult = Meta & (Readonly<{ status: 'succeeded'; code: null; binding: Binding; model: string; readiness: Readiness; output: Readonly<{ kind: 'plain_text'; text: string }>; receipt: unknown; provenance: unknown }> | Readonly<{ status: 'denied'; code: LocalOcrOllamaExecutionDenialCode; binding: null; model: null; readiness: null; output: null; receipt: null; provenance: null }>);
export type HostInjectedLocalOcrOllamaInvocation = (request: Readonly<{ model: string; instruction: string; image: Readonly<{ mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; payload: string }>; signal: AbortSignal }>) => Promise<unknown>;

const MAX_RESPONSE_CHARS = 64 * 1024;
const INSTRUCTIONS: Readonly<Record<Mode, string>> = Object.freeze({
    full: 'Transcribe the image exactly as visible. Return plain text only. Do not infer, summarize, classify, or make clinical claims.',
    patient: 'Transcribe only patient-identifying and administrative text exactly as visible. Return plain text only. Do not infer, summarize, classify, or make clinical claims.',
    labs: 'Transcribe only laboratory result text exactly as visible. Return plain text only. Do not infer, summarize, classify, or make clinical claims.',
});

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const actual = Reflect.ownKeys(value);
        if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const copy: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function deny(code: LocalOcrOllamaExecutionDenialCode): LocalOcrOllamaExecutionResult {
    return Object.freeze({ status: 'denied' as const, code, binding: null, model: null, readiness: null, output: null, receipt: null, provenance: null, fallback: 'denied_by_contract' as const, applyPolicy: 'none' as const, writesPerformed: 0 as const });
}

function policy(value: unknown): Readonly<{ model: string; readiness: Readiness }> | null {
    const input = record(value, ['provider', 'venue', 'endpoint', 'model', 'readiness', 'egress']);
    const ready = input && record(input.readiness, ['provider', 'model', 'state']);
    if (!input || !ready || input.provider !== 'ollama_ocr' || input.venue !== 'local_process' || input.egress !== 'none' || typeof input.endpoint !== 'string' || typeof input.model !== 'string' || ready.provider !== 'ollama' || ready.model !== input.model || ready.state !== 'available') return null;
    try {
        if (strictOllamaLoopbackBaseUrl(input.endpoint) !== input.endpoint) return null;
        assertLocalOllamaModelReference(input.model);
    } catch { return null; }
    return Object.freeze({ model: input.model, readiness: Object.freeze({ provider: 'ollama' as const, model: input.model, state: 'available' as const }) });
}

function snapshotOptions(value: unknown): Readonly<{ policy: unknown; invoke: HostInjectedLocalOcrOllamaInvocation }> | null {
    const options = record(value, ['policy', 'invoke']);
    return options && typeof options.invoke === 'function' && !types.isProxy(options.invoke) ? Object.freeze({ policy: options.policy, invoke: options.invoke as HostInjectedLocalOcrOllamaInvocation }) : null;
}

function request(value: unknown): Readonly<{ evidence: unknown; image: Readonly<{ source: 'host_attachment'; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; payload: string }>; mode: Mode }> | null {
    const input = record(value, ['evidence', 'image', 'mode']);
    const image = input && record(input.image, ['source', 'mimeType', 'payload']);
    if (!input || !image || image.source !== 'host_attachment' || (image.mimeType !== 'image/png' && image.mimeType !== 'image/jpeg' && image.mimeType !== 'image/webp') || typeof image.payload !== 'string' || !image.payload || (input.mode !== 'full' && input.mode !== 'patient' && input.mode !== 'labs')) return null;
    return Object.freeze({ evidence: input.evidence, image: Object.freeze({ source: 'host_attachment' as const, mimeType: image.mimeType, payload: image.payload }), mode: input.mode });
}

function response(value: unknown, model: string): Readonly<{ text: string }> | null {
    const input = record(value, ['model', 'text']);
    return input && input.model === model && typeof input.text === 'string' ? Object.freeze({ text: input.text }) : null;
}

async function invokeOnce(invoke: HostInjectedLocalOcrOllamaInvocation, input: Parameters<HostInjectedLocalOcrOllamaInvocation>[0], signal: AbortSignal): Promise<Readonly<{ kind: 'result'; value: unknown }> | Readonly<{ kind: 'error'; value: unknown }> | Readonly<{ kind: 'timeout' }>> {
    let timer: (() => void) | undefined;
    const timed = new Promise<Readonly<{ kind: 'timeout' }>>((resolve) => { timer = () => resolve(Object.freeze({ kind: 'timeout' as const })); signal.addEventListener('abort', timer, { once: true }); if (signal.aborted) timer(); });
    try {
        const result = await Promise.race([Promise.resolve(invoke(input)).then((value) => Object.freeze({ kind: 'result' as const, value }), (value) => Object.freeze({ kind: 'error' as const, value })), timed]);
        return result;
    } catch (value) { return Object.freeze({ kind: 'error' as const, value }); }
    finally { if (timer) signal.removeEventListener('abort', timer); }
}

/** Server-only X1: one host-injected, loopback-only Ollama OCR execution; it is review-only and never applies writes. */
export function createLocalOcrOllamaExecutionAdapter(options: unknown) {
    const host = snapshotOptions(options); const admitted = host && policy(host.policy); const x0 = createLocalOcrExecutionContract();
    return Object.freeze({ async execute(input: unknown): Promise<LocalOcrOllamaExecutionResult> {
        if (!host || !admitted) return deny('policy_invalid');
        const accepted = request(input);
        if (!accepted) return deny('envelope_invalid');
        const preflight = x0.freeze({ ...accepted, outcome: { kind: 'success', text: 'x' } });
        if (preflight.status !== 'succeeded' || preflight.binding.provider !== 'ollama_ocr') return deny('envelope_invalid');
        const signal = AbortSignal.timeout(180_000);
        const execution = await invokeOnce(host.invoke, Object.freeze({ model: admitted.model, instruction: INSTRUCTIONS[accepted.mode], image: Object.freeze({ mimeType: accepted.image.mimeType, payload: accepted.image.payload }), signal }), signal);
        if (execution.kind === 'timeout' || signal.aborted) return deny('provider_timeout');
        if (execution.kind === 'error') return execution.value instanceof DOMException && execution.value.name === 'AbortError' ? deny('provider_cancelled') : deny('provider_unavailable');
        const resolved = response(execution.value, admitted.model);
        if (!resolved) return deny('response_mismatch');
        if (resolved.text.length > MAX_RESPONSE_CHARS) return deny('response_oversized');
        if (resolved.text.trim().length < 2) return deny('low_signal');
        const result = x0.freeze({ ...accepted, outcome: { kind: 'success', text: resolved.text } });
        if (result.status !== 'succeeded' || result.binding.provider !== 'ollama_ocr') return deny('response_invalid');
        return Object.freeze({ status: 'succeeded' as const, code: null, binding: Object.freeze({ provider: 'ollama_ocr' as const, venue: 'local_process' as const, egress: 'none' as const }), model: admitted.model, readiness: admitted.readiness, output: result.output, receipt: result.receipt, provenance: result.provenance, fallback: 'denied_by_contract' as const, applyPolicy: 'none' as const, writesPerformed: 0 as const });
    }});
}
