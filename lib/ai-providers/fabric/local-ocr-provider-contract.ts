/* @Codex */
export type LocalOcrProvider = 'ollama_ocr' | 'apple_vision';

export type LocalOcrProviderResolution = Readonly<{
    outcome: 'ready';
    provider: LocalOcrProvider;
    receipt: Readonly<{
        schemaVersion: 'mediflow.ai.local-ocr-provider-receipt.v1';
        provider: LocalOcrProvider;
        venue: 'local_process' | 'on_device';
        egress: 'none';
        authority: 'review_only';
        applyPolicy: 'none';
        writesPerformed: 0;
    }>;
    provenance: Readonly<{
        schemaVersion: 'mediflow.ai.local-ocr-provider-provenance.v1';
        provider: LocalOcrProvider;
        venue: 'local_process' | 'on_device';
        egress: 'none';
        receiptProvider: LocalOcrProvider;
    }>;
    writesPerformed: 0;
    applyPolicy: 'none';
}>;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor)) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch {
        return null;
    }
}

/** Resolves explicit, review-only metadata for one ready local OCR provider. */
export function resolveLocalOcrProvider(value: unknown): LocalOcrProviderResolution | null {
    const input = record(value, ['provider', 'readiness', 'receipt', 'provenance']);
    const receipt = input && record(input.receipt, ['schemaVersion', 'provider', 'venue', 'egress', 'authority', 'applyPolicy', 'writesPerformed']);
    const provenance = input && record(input.provenance, ['schemaVersion', 'provider', 'venue', 'egress', 'receiptProvider']);
    const provider = input?.provider === 'ollama_ocr' || input?.provider === 'apple_vision' ? input.provider : null;
    const venue = provider === 'ollama_ocr' ? 'local_process' : provider === 'apple_vision' ? 'on_device' : null;
    if (
        !input || !receipt || !provenance || !provider || !venue || input.readiness !== 'ready'
        || receipt.schemaVersion !== 'mediflow.ai.local-ocr-provider-receipt.v1' || receipt.provider !== provider
        || receipt.venue !== venue || receipt.egress !== 'none' || receipt.authority !== 'review_only'
        || receipt.applyPolicy !== 'none' || receipt.writesPerformed !== 0
        || provenance.schemaVersion !== 'mediflow.ai.local-ocr-provider-provenance.v1' || provenance.provider !== provider
        || provenance.venue !== venue || provenance.egress !== 'none' || provenance.receiptProvider !== provider
    ) return null;
    const receiptSnapshot = Object.freeze({ schemaVersion: 'mediflow.ai.local-ocr-provider-receipt.v1' as const, provider, venue, egress: 'none' as const, authority: 'review_only' as const, applyPolicy: 'none' as const, writesPerformed: 0 as const });
    const provenanceSnapshot = Object.freeze({ schemaVersion: 'mediflow.ai.local-ocr-provider-provenance.v1' as const, provider, venue, egress: 'none' as const, receiptProvider: provider });
    return Object.freeze({ outcome: 'ready' as const, provider, receipt: receiptSnapshot, provenance: provenanceSnapshot, writesPerformed: 0 as const, applyPolicy: 'none' as const });
}
