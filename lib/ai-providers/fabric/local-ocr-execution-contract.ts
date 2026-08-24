/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { getAttachmentPayloadByteSize, resolveMaxAttachmentBytes } from '../../attachment-payload';

type Provider = 'ollama_ocr' | 'apple_vision';
type Venue = 'local_process' | 'on_device';
type Mode = 'full' | 'patient' | 'labs';
type Binding = Readonly<{ provider: Provider; venue: Venue; egress: 'none' }>;
type Meta = Readonly<{ fallback: 'denied_by_contract'; applyPolicy: 'none'; writesPerformed: 0 }>;
type Receipt = Readonly<{ schemaVersion: 'mediflow.ai.local-ocr-provider-receipt.v1'; provider: Provider; venue: Venue; egress: 'none'; authority: 'review_only'; applyPolicy: 'none'; writesPerformed: 0 }>;
type Provenance = Readonly<{ schemaVersion: 'mediflow.ai.local-ocr-provider-provenance.v1'; provider: Provider; venue: Venue; egress: 'none'; receiptProvider: Provider }>;

export type LocalOcrExecutionDenialCode = 'request_invalid' | 'evidence_invalid' | 'outcome_invalid';
export type LocalOcrExecutionResult = Meta & (
    | Readonly<{ status: 'succeeded'; code: null; binding: Binding; mode: Mode; output: Readonly<{ kind: 'plain_text'; text: string }>; receipt: Receipt; provenance: Provenance }>
    | Readonly<{ status: 'denied'; code: LocalOcrExecutionDenialCode; binding: null; mode: null; output: null; receipt: null; provenance: null }>
    | Readonly<{ status: 'failed'; code: 'provider_failure'; binding: null; mode: null; output: null; receipt: null; provenance: null }>
);

const MAX_TEXT_CHARS: Readonly<Record<Provider, number>> = Object.freeze({ ollama_ocr: 64 * 1024, apple_vision: 32 * 1024 });

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const snapshot: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            snapshot[key] = descriptor.value;
        }
        return snapshot;
    } catch { return null; }
}

function frozenRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    const snapshot = record(value, keys);
    try { return snapshot && Object.isFrozen(value) ? snapshot : null; } catch { return null; }
}

function venueFor(provider: Provider): Venue {
    return provider === 'ollama_ocr' ? 'local_process' : 'on_device';
}

function evidence(value: unknown): Readonly<{ binding: Binding; receipt: Receipt; provenance: Provenance }> | null {
    const composed = frozenRecord(value, ['status', 'code', 'binding', 'receipt', 'provenance', 'fallback', 'applyPolicy', 'writesPerformed']);
    if (!composed || composed.status !== 'composed' || composed.code !== null || composed.fallback !== 'denied_by_contract' || composed.applyPolicy !== 'none' || composed.writesPerformed !== 0) return null;
    const binding = frozenRecord(composed.binding, ['provider', 'venue', 'egress']);
    const receipt = frozenRecord(composed.receipt, ['schemaVersion', 'provider', 'venue', 'egress', 'authority', 'applyPolicy', 'writesPerformed']);
    const provenance = frozenRecord(composed.provenance, ['schemaVersion', 'provider', 'venue', 'egress', 'receiptProvider']);
    const provider = binding?.provider === 'ollama_ocr' || binding?.provider === 'apple_vision' ? binding.provider : null;
    const venue = provider ? venueFor(provider) : null;
    if (!binding || !receipt || !provenance || !provider || !venue || binding.venue !== venue || binding.egress !== 'none'
        || receipt.schemaVersion !== 'mediflow.ai.local-ocr-provider-receipt.v1' || receipt.provider !== provider || receipt.venue !== venue || receipt.egress !== 'none' || receipt.authority !== 'review_only' || receipt.applyPolicy !== 'none' || receipt.writesPerformed !== 0
        || provenance.schemaVersion !== 'mediflow.ai.local-ocr-provider-provenance.v1' || provenance.provider !== provider || provenance.venue !== venue || provenance.egress !== 'none' || provenance.receiptProvider !== provider) return null;
    return Object.freeze({
        binding: Object.freeze({ provider, venue, egress: 'none' as const }),
        receipt: Object.freeze({ schemaVersion: 'mediflow.ai.local-ocr-provider-receipt.v1' as const, provider, venue, egress: 'none' as const, authority: 'review_only' as const, applyPolicy: 'none' as const, writesPerformed: 0 as const }),
        provenance: Object.freeze({ schemaVersion: 'mediflow.ai.local-ocr-provider-provenance.v1' as const, provider, venue, egress: 'none' as const, receiptProvider: provider }),
    });
}

function image(value: unknown): boolean {
    const input = record(value, ['source', 'mimeType', 'payload']);
    if (!input || input.source !== 'host_attachment' || !['image/png', 'image/jpeg', 'image/webp'].includes(input.mimeType as string) || typeof input.payload !== 'string' || !input.payload || input.payload.startsWith('ENC:') || input.payload.startsWith('data:')) return false;
    const payloadSize = getAttachmentPayloadByteSize(input.payload);
    return payloadSize.ok && payloadSize.size > 0 && payloadSize.size <= resolveMaxAttachmentBytes();
}

function deny(code: LocalOcrExecutionDenialCode): LocalOcrExecutionResult {
    return Object.freeze({ status: 'denied' as const, code, binding: null, mode: null, output: null, receipt: null, provenance: null, fallback: 'denied_by_contract' as const, applyPolicy: 'none' as const, writesPerformed: 0 as const });
}

function failure(): LocalOcrExecutionResult {
    return Object.freeze({ status: 'failed' as const, code: 'provider_failure' as const, binding: null, mode: null, output: null, receipt: null, provenance: null, fallback: 'denied_by_contract' as const, applyPolicy: 'none' as const, writesPerformed: 0 as const });
}

/** Server-only X0: validate a host-attachment, provider-neutral OCR envelope; it never invokes a provider. */
export function createLocalOcrExecutionContract() {
    return Object.freeze({
        freeze(input: unknown): LocalOcrExecutionResult {
            const request = record(input, ['evidence', 'image', 'mode', 'outcome']);
            if (!request || !image(request.image) || (request.mode !== 'full' && request.mode !== 'patient' && request.mode !== 'labs')) return deny('request_invalid');
            const composed = evidence(request.evidence);
            if (!composed) return deny('evidence_invalid');
            const outcome = record(request.outcome, ['kind']) || record(request.outcome, ['kind', 'text']);
            if (!outcome || (outcome.kind !== 'success' && outcome.kind !== 'failure')) return deny('outcome_invalid');
            if (outcome.kind === 'failure') return Object.keys(outcome).length === 1 ? failure() : deny('outcome_invalid');
            if (Object.keys(outcome).length !== 2 || typeof outcome.text !== 'string' || !outcome.text.trim() || outcome.text.length > MAX_TEXT_CHARS[composed.binding.provider]) return deny('outcome_invalid');
            const output = Object.freeze({ kind: 'plain_text' as const, text: outcome.text });
            return Object.freeze({ status: 'succeeded' as const, code: null, binding: composed.binding, mode: request.mode, output, receipt: composed.receipt, provenance: composed.provenance, fallback: 'denied_by_contract' as const, applyPolicy: 'none' as const, writesPerformed: 0 as const });
        },
    });
}
