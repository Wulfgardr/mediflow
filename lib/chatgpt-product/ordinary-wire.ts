/* @Codex — content/provenance DTOs only. No DTO authorizes execution. */
import type { ModelEffort } from '../chatgpt-execution/execution-contract';
export type OrdinaryFunction = 'patient_insight' | 'smart_import' | 'document_synthesis' | 'treatment_reasoning';
export type OrdinaryRemoteReceipt = Readonly<{
    schemaVersion: 'mediflow.ai.chatgpt-receipt.v1'; capability: OrdinaryFunction;
    provider: 'chatgpt_subscription'; venue: 'cloud'; model: string; effort: ModelEffort;
    egress: 'redacted_explicit_consent'; retention: 'chatgpt_service_terms_apply'; fallback: 'none';
    sourceSha256: string; payloadSha256: string; outputSha256: string;
}>;
export type OrdinaryRemoteProvenance = Readonly<{
    schemaVersion: 'mediflow.ai.chatgpt-provenance.v1'; capability: OrdinaryFunction;
    venue: 'cloud'; provider: 'chatgpt_subscription'; model: string;
    preprocessing: readonly ['context_minimization', 'layer1_redaction', 'layer2_redaction', 'envelope_validation'];
    receipt: OrdinaryRemoteReceipt;
}>;
export function ordinaryWireObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
            || Reflect.ownKeys(value).length !== keys.length) return null;
        const v: Record<string, unknown> = {};
        for (const k of keys) { const d = Object.getOwnPropertyDescriptor(value, k); if (!d?.enumerable || !('value' in d)) return null; v[k] = d.value; }
        return v;
    } catch { return null; }
}
export function parseOrdinaryRemoteReceipt(value: unknown, functionId: OrdinaryFunction): OrdinaryRemoteReceipt | null {
    const v = ordinaryWireObject(value, ['schemaVersion', 'capability', 'provider', 'venue', 'model', 'effort', 'egress', 'retention', 'fallback', 'sourceSha256', 'payloadSha256', 'outputSha256']);
    if (!v || v.schemaVersion !== 'mediflow.ai.chatgpt-receipt.v1' || v.capability !== functionId || v.provider !== 'chatgpt_subscription'
        || v.venue !== 'cloud' || typeof v.model !== 'string' || !v.model || v.model.length > 160 || /[\x00-\x1f\x7f]/u.test(v.model)
        || !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(String(v.effort))
        || v.egress !== 'redacted_explicit_consent' || v.retention !== 'chatgpt_service_terms_apply' || v.fallback !== 'none'
        || typeof v.sourceSha256 !== 'string' || !/^sha256_[0-9a-f]{64}$/u.test(v.sourceSha256)
        || !['payloadSha256', 'outputSha256'].every(k => typeof v[k] === 'string' && /^[0-9a-f]{64}$/u.test(v[k] as string))) return null;
    return Object.freeze(v) as OrdinaryRemoteReceipt;
}
export function parseOrdinaryRemoteProvenance(value: unknown, receipt: OrdinaryRemoteReceipt): OrdinaryRemoteProvenance | null {
    const v = ordinaryWireObject(value, ['schemaVersion', 'capability', 'venue', 'provider', 'model', 'preprocessing', 'receipt']);
    const nested = v && parseOrdinaryRemoteReceipt(v.receipt, receipt.capability);
    if (!v || !nested || JSON.stringify(nested) !== JSON.stringify(receipt) || v.schemaVersion !== 'mediflow.ai.chatgpt-provenance.v1'
        || v.capability !== receipt.capability || v.provider !== receipt.provider || v.venue !== receipt.venue || v.model !== receipt.model
        || !Array.isArray(v.preprocessing) || JSON.stringify(v.preprocessing) !== '["context_minimization","layer1_redaction","layer2_redaction","envelope_validation"]') return null;
    return Object.freeze({ schemaVersion: v.schemaVersion, capability: receipt.capability, venue: 'cloud', provider: receipt.provider,
        model: receipt.model, preprocessing: Object.freeze(['context_minimization', 'layer1_redaction', 'layer2_redaction', 'envelope_validation'] as const), receipt: nested });
}
export const ORDINARY_FLOW_SCHEMA = 'mediflow.chatgpt-ordinary-flow.v1' as const;
export const ORDINARY_SELECTION_SCHEMA = 'mediflow.function-model-chatgpt-choice.v1' as const;
export type OrdinaryFlowState = Readonly<{ schema: typeof ORDINARY_FLOW_SCHEMA; attemptId: string; functionId: OrdinaryFunction;
    phase: 'preparing' | 'needs_consent' | 'consented' | 'awaiting_login' | 'connected' | 'ready' | 'generating' | 'closed'; expiresAt: number }>;
