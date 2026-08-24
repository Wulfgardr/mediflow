/* @Codex */
import 'server-only';

import { types } from 'node:util';

type LocalOcrProvider = 'ollama_ocr' | 'apple_vision';
type LocalOcrVenue = 'local_process' | 'on_device';
type Binding = Readonly<{ provider: LocalOcrProvider; venue: LocalOcrVenue; egress: 'none' }>;
type Readiness = Readonly<Binding & {
    schemaVersion: 'mediflow.ai.local-ocr-host-readiness.v1';
    state: 'available';
}>;
type ResultMeta = Readonly<{ fallback: 'denied_by_contract'; applyPolicy: 'none'; writesPerformed: 0 }>;

export type HostLocalOcrAdmissionDenialCode =
    | 'policy_unavailable' | 'policy_invalid' | 'readiness_unavailable' | 'readiness_invalid'
    | 'readiness_mismatch' | 'provider_unavailable';

export type HostLocalOcrAdmissionResult = ResultMeta & (
    | Readonly<{ status: 'admitted'; code: null; binding: Binding; readiness: Readiness }>
    | Readonly<{ status: 'denied'; code: HostLocalOcrAdmissionDenialCode; binding: null; readiness: null }>
);

type Policy = Readonly<{ provider: LocalOcrProvider; venue: LocalOcrVenue }>;
type ReadinessState = Readonly<{ provider: LocalOcrProvider; venue: LocalOcrVenue; state: 'available' | 'unavailable' }>;
type Reader = () => Promise<unknown>;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
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

function policySnapshot(value: unknown): Policy | null {
    const input = record(value, ['provider', 'venue', 'egress', 'authority', 'applyPolicy']);
    if (!input || (input.provider !== 'ollama_ocr' && input.provider !== 'apple_vision')) return null;
    const venue = venueFor(input.provider);
    return input.venue === venue && input.egress === 'none' && input.authority === 'review_only' && input.applyPolicy === 'none'
        ? Object.freeze({ provider: input.provider, venue }) : null;
}

function readinessSnapshot(value: unknown): ReadinessState | null {
    const input = record(value, ['provider', 'venue', 'state']);
    if (!input || (input.provider !== 'ollama_ocr' && input.provider !== 'apple_vision')) return null;
    if ((input.venue !== 'local_process' && input.venue !== 'on_device') || (input.state !== 'available' && input.state !== 'unavailable')) return null;
    return Object.freeze({ provider: input.provider, venue: input.venue, state: input.state });
}

function deny(code: HostLocalOcrAdmissionDenialCode): HostLocalOcrAdmissionResult {
    return Object.freeze({ status: 'denied' as const, code, binding: null, readiness: null,
        fallback: 'denied_by_contract' as const, applyPolicy: 'none' as const, writesPerformed: 0 as const });
}

function decide(policy: Policy, readiness: ReadinessState): HostLocalOcrAdmissionResult {
    if (readiness.provider !== policy.provider || readiness.venue !== policy.venue) return deny('readiness_mismatch');
    if (readiness.state !== 'available') return deny('provider_unavailable');
    const binding = Object.freeze({ provider: policy.provider, venue: policy.venue, egress: 'none' as const });
    const evidence = Object.freeze({ ...binding, schemaVersion: 'mediflow.ai.local-ocr-host-readiness.v1' as const, state: 'available' as const });
    return Object.freeze({ status: 'admitted' as const, code: null, binding, readiness: evidence,
        fallback: 'denied_by_contract' as const, applyPolicy: 'none' as const, writesPerformed: 0 as const });
}

/** Server-only packet A: host readers decide binding/readiness; consumers only call `admit()`. */
export function createHostLocalOcrAdmissionService(options: Readonly<{ readPolicy: Reader; readReadiness: Reader }>) {
    const { readPolicy, readReadiness } = options;
    return Object.freeze({
        async admit(): Promise<HostLocalOcrAdmissionResult> {
            let policy: Policy | null;
            try { policy = policySnapshot(await readPolicy()); } catch { return deny('policy_unavailable'); }
            if (!policy) return deny('policy_invalid');
            let readiness: ReadinessState | null;
            try { readiness = readinessSnapshot(await readReadiness()); } catch { return deny('readiness_unavailable'); }
            return readiness ? decide(policy, readiness) : deny('readiness_invalid');
        },
    });
}
