/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { resolveLocalOcrProvider, type LocalOcrProviderResolution } from './local-ocr-provider-contract';

type LocalOcrProvider = 'ollama_ocr' | 'apple_vision';
type LocalOcrVenue = 'local_process' | 'on_device';
type Binding = Readonly<{ provider: LocalOcrProvider; venue: LocalOcrVenue; egress: 'none' }>;
type ResultMeta = Readonly<{ fallback: 'denied_by_contract'; applyPolicy: 'none'; writesPerformed: 0 }>;

export type HostLocalOcrReceiptProvenanceCompositionDenialCode =
    | 'composition_invalid' | 'admission_denied' | 'admission_invalid' | 'evidence_invalid';

export type HostLocalOcrReceiptProvenanceCompositionResult = ResultMeta & (
    | Readonly<{
        status: 'composed';
        code: null;
        binding: Binding;
        receipt: LocalOcrProviderResolution['receipt'];
        provenance: LocalOcrProviderResolution['provenance'];
    }>
    | Readonly<{ status: 'denied'; code: HostLocalOcrReceiptProvenanceCompositionDenialCode; binding: null; receipt: null; provenance: null }>
);

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

function venueFor(provider: LocalOcrProvider): LocalOcrVenue {
    return provider === 'ollama_ocr' ? 'local_process' : 'on_device';
}

function isFrozen(value: unknown): boolean {
    try { return Boolean(value) && typeof value === 'object' && !types.isProxy(value) && Object.isFrozen(value); } catch { return false; }
}

function admittedBinding(value: unknown): Binding | null {
    const admission = record(value, ['status', 'code', 'binding', 'readiness', 'fallback', 'applyPolicy', 'writesPerformed']);
    if (!admission || !isFrozen(value) || admission.status !== 'admitted' || admission.code !== null
        || admission.fallback !== 'denied_by_contract' || admission.applyPolicy !== 'none' || admission.writesPerformed !== 0
        || !isFrozen(admission.binding) || !isFrozen(admission.readiness)) return null;
    const binding = record(admission.binding, ['provider', 'venue', 'egress']);
    const readiness = record(admission.readiness, ['provider', 'venue', 'egress', 'schemaVersion', 'state']);
    const provider = binding?.provider === 'ollama_ocr' || binding?.provider === 'apple_vision' ? binding.provider : null;
    const venue = provider ? venueFor(provider) : null;
    if (!binding || !readiness || !provider || !venue || binding.venue !== venue || binding.egress !== 'none'
        || readiness.provider !== provider || readiness.venue !== binding.venue || readiness.egress !== 'none'
        || readiness.schemaVersion !== 'mediflow.ai.local-ocr-host-readiness.v1' || readiness.state !== 'available') return null;
    return Object.freeze({ provider, venue, egress: 'none' as const });
}

function deniedAdmission(value: unknown): boolean {
    const admission = record(value, ['status', 'code', 'binding', 'readiness', 'fallback', 'applyPolicy', 'writesPerformed']);
    return Boolean(admission && isFrozen(value) && admission.status === 'denied' && typeof admission.code === 'string'
        && admission.binding === null && admission.readiness === null && admission.fallback === 'denied_by_contract'
        && admission.applyPolicy === 'none' && admission.writesPerformed === 0);
}

function deny(code: HostLocalOcrReceiptProvenanceCompositionDenialCode): HostLocalOcrReceiptProvenanceCompositionResult {
    return Object.freeze({ status: 'denied' as const, code, binding: null, receipt: null, provenance: null,
        fallback: 'denied_by_contract' as const, applyPolicy: 'none' as const, writesPerformed: 0 as const });
}

/** Server-only packet B: compose provider evidence from one frozen packet-A admission, never invoke a provider. */
export function createHostLocalOcrReceiptProvenanceComposer() {
    return Object.freeze({
        compose(input: unknown): HostLocalOcrReceiptProvenanceCompositionResult {
            const request = record(input, ['admission', 'receipt', 'provenance']);
            if (!request) return deny('composition_invalid');
            if (deniedAdmission(request.admission)) return deny('admission_denied');
            const binding = admittedBinding(request.admission);
            if (!binding) return deny('admission_invalid');
            const resolution = resolveLocalOcrProvider({
                provider: binding.provider,
                readiness: 'ready',
                receipt: request.receipt,
                provenance: request.provenance,
            });
            if (!resolution || resolution.provider !== binding.provider || resolution.receipt.venue !== binding.venue
                || resolution.provenance.venue !== binding.venue || resolution.provenance.receiptProvider !== binding.provider) {
                return deny('evidence_invalid');
            }
            return Object.freeze({ status: 'composed' as const, code: null, binding,
                receipt: resolution.receipt, provenance: resolution.provenance,
                fallback: 'denied_by_contract' as const, applyPolicy: 'none' as const, writesPerformed: 0 as const });
        },
    });
}
