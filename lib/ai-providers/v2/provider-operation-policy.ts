/* @Codex */
import { createHash } from 'node:crypto';
import { snapshotProviderLifecycleV2, type ProviderBindingV2 } from './provider-lifecycle';

export const PROVIDER_POLICY_EVIDENCE_SCHEMA = 'mediflow.ai.provider-policy-evidence.v2' as const;
export const PROVIDER_OPERATION_RECEIPT_SCHEMA = 'mediflow.ai.provider-operation-receipt.v2' as const;

const POLICY_KEYS = ['lifecycle', 'evidence'] as const;
const EVIDENCE_KEYS = ['schemaVersion', 'egressProfileRef', 'retentionProfileRef', 'consentRef', 'egressPromoted', 'retentionEligible', 'consentCurrent', 'redactionReceiptSha256'] as const;
const RESPONSE_KEYS = ['schemaVersion', 'validated', 'payloadSha256', 'outputSha256', 'vendorRequestId', 'latencyMs', 'tokensIn', 'tokensOut', 'completedAt'] as const;
const SHA256 = /^[a-f0-9]{64}$/;
const REF = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const UNPROVEN_ZERO_RETENTION = /(?:zero[._-]data[._-]retention|(?:^|[._-])zdr(?:[._-]|$))/i;

export type ProviderPolicyDenialCode = 'input_invalid' | 'provider_disabled' | 'egress_profile_unsatisfied'
    | 'retention_profile_unsatisfied' | 'consent_missing' | 'redaction_receipt_missing'
    | 'data_class_forbidden' | 'secret_unavailable';
export type ProviderPolicyAuthorizationV2 = Readonly<{
    status: 'admitted'; code: null; secretLease: object;
}> | Readonly<{ status: 'denied'; code: ProviderPolicyDenialCode; secretLease: null }>;

type PolicyEvidence = Readonly<{
    schemaVersion: typeof PROVIDER_POLICY_EVIDENCE_SCHEMA; egressProfileRef: string;
    retentionProfileRef: string; consentRef: string | null; egressPromoted: boolean;
    retentionEligible: boolean; consentCurrent: boolean; redactionReceiptSha256: string | null;
}>;
type AdmissionMetadata = { binding: ProviderBindingV2; used: boolean };
const ADMISSIONS = new WeakMap<object, AdmissionMetadata>();
const RECEIPT_LABELS = new WeakMap<object, string>();

export type ProviderOperationReceiptV2 = Readonly<{
    schemaVersion: typeof PROVIDER_OPERATION_RECEIPT_SCHEMA; operation: ProviderBindingV2['operation'];
    providerId: 'openai' | 'anthropic'; model: string; venue: 'cloud'; endpointClass: 'official_api'; fallbackCount: 0;
    dataClass: ProviderBindingV2['dataClass']; egressProfileRef: string; retentionProfileRef: string;
    consentRefSha256: string | null; vendorRequestId: string | null; latencyMs: number;
    tokensIn: number | null; tokensOut: number | null; payloadSha256: string; outputSha256: string;
    outcome: 'complete'; completedAt: string;
}>;

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    try {
        const prototype = Object.getPrototypeOf(value); const ownKeys = Reflect.ownKeys(value);
        return (prototype === Object.prototype || prototype === null) && ownKeys.length === keys.length
            && ownKeys.every((key) => typeof key === 'string' && keys.includes(key)) ? value as Record<string, unknown> : null;
    } catch { return null; }
}
function materialize(source: Record<string, unknown>, keys: readonly string[]): unknown[] | null {
    try { return keys.map((key) => source[key]); } catch { return null; }
}
function denial(code: ProviderPolicyDenialCode): ProviderPolicyAuthorizationV2 {
    return Object.freeze({ status: 'denied', code, secretLease: null });
}
function evidence(value: unknown): PolicyEvidence | null {
    const source = exact(value, EVIDENCE_KEYS); if (!source) return null;
    const values = materialize(source, EVIDENCE_KEYS); if (!values) return null;
    const [schemaVersion, egressProfileRef, retentionProfileRef, consentRef, egressPromoted, retentionEligible, consentCurrent, redactionReceiptSha256] = values;
    if (schemaVersion !== PROVIDER_POLICY_EVIDENCE_SCHEMA || typeof egressProfileRef !== 'string' || !REF.test(egressProfileRef)
        || typeof retentionProfileRef !== 'string' || !REF.test(retentionProfileRef)
        || (consentRef !== null && (typeof consentRef !== 'string' || !REF.test(consentRef)))
        || typeof egressPromoted !== 'boolean' || typeof retentionEligible !== 'boolean' || typeof consentCurrent !== 'boolean'
        || (redactionReceiptSha256 !== null && (typeof redactionReceiptSha256 !== 'string' || !SHA256.test(redactionReceiptSha256)))) return null;
    return Object.freeze({ schemaVersion, egressProfileRef, retentionProfileRef, consentRef, egressPromoted,
        retentionEligible, consentCurrent, redactionReceiptSha256 } as PolicyEvidence);
}

function baseDenial(binding: ProviderBindingV2, proof: PolicyEvidence): ProviderPolicyDenialCode | null {
    if (binding.kind !== 'cloud' || binding.venue !== 'cloud' || (binding.providerId !== 'openai' && binding.providerId !== 'anthropic')) return 'provider_disabled';
    if (binding.fallback !== 'none') return 'input_invalid';
    if (proof.egressProfileRef !== binding.egressProfileRef) return 'egress_profile_unsatisfied';
    if (UNPROVEN_ZERO_RETENTION.test(binding.retentionProfileRef)) return 'retention_profile_unsatisfied';
    if (proof.retentionProfileRef !== binding.retentionProfileRef) return 'retention_profile_unsatisfied';
    if (proof.consentRef !== binding.consentRef) return 'consent_missing';
    return null;
}

export function authorizeProviderOperationV2(value: unknown, acquireSecretLease: () => unknown): ProviderPolicyAuthorizationV2 {
    const source = exact(value, POLICY_KEYS); const values = source && materialize(source, POLICY_KEYS);
    if (!values || typeof acquireSecretLease !== 'function') return denial('input_invalid');
    let lifecycle;
    try { lifecycle = snapshotProviderLifecycleV2(values[0]); } catch { return denial('input_invalid'); }
    const proof = evidence(values[1]);
    if (!proof) return denial('input_invalid');
    if (lifecycle.status !== 'enabled' || !lifecycle.binding) return denial('provider_disabled');
    const blocked = baseDenial(lifecycle.binding, proof); if (blocked) return denial(blocked);
    if (lifecycle.binding.dataClass === 'clinical_identifiable') return denial('data_class_forbidden');
    if (lifecycle.binding.dataClass === 'redacted_clinical') {
        if (!proof.egressPromoted) return denial('egress_profile_unsatisfied');
        if (!proof.retentionEligible) return denial('retention_profile_unsatisfied');
        if (!proof.consentCurrent || !proof.consentRef) return denial('consent_missing');
        if (!proof.redactionReceiptSha256) return denial('redaction_receipt_missing');
    }
    let secretLease: unknown;
    try { secretLease = acquireSecretLease(); } catch { return denial('secret_unavailable'); }
    let safeLease = false;
    try { safeLease = !!secretLease && typeof secretLease === 'object' && Object.getPrototypeOf(secretLease) === null
        && Object.isFrozen(secretLease) && Reflect.ownKeys(secretLease).length === 0; } catch { return denial('secret_unavailable'); }
    if (!safeLease) return denial('secret_unavailable');
    const admitted = Object.freeze({ status: 'admitted' as const, code: null, secretLease: secretLease as object });
    ADMISSIONS.set(admitted, { binding: lifecycle.binding, used: false });
    return admitted;
}

function count(value: unknown): value is number | null {
    return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

export function createProviderOperationReceiptV2(authorization: unknown, responseValue: unknown): ProviderOperationReceiptV2 | null {
    if (!authorization || typeof authorization !== 'object') return null;
    const metadata = ADMISSIONS.get(authorization as object);
    if (!metadata || metadata.used) return null;
    metadata.used = true;
    const source = exact(responseValue, RESPONSE_KEYS); const values = source && materialize(source, RESPONSE_KEYS);
    if (!values) return null;
    const [schemaVersion, validated, payloadSha256, outputSha256, vendorRequestId, latencyMs, tokensIn, tokensOut, completedAt] = values;
    if (schemaVersion !== 'mediflow.ai.provider-response-validation.v2' || validated !== true
        || typeof payloadSha256 !== 'string' || !SHA256.test(payloadSha256)
        || typeof outputSha256 !== 'string' || !SHA256.test(outputSha256)
        || (vendorRequestId !== null && (typeof vendorRequestId !== 'string' || !/^[\x20-\x7e]{1,128}$/.test(vendorRequestId)))
        || !Number.isSafeInteger(latencyMs) || (latencyMs as number) < 0 || !count(tokensIn) || !count(tokensOut)
        || typeof completedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(completedAt)) return null;
    const binding = metadata.binding;
    const consentRefSha256 = binding.consentRef === null ? null
        : createHash('sha256').update('mediflow-consent-ref-v2\0').update(binding.consentRef).digest('hex');
    const receipt = Object.freeze({ schemaVersion: PROVIDER_OPERATION_RECEIPT_SCHEMA, operation: binding.operation,
        providerId: binding.providerId as 'openai' | 'anthropic', model: binding.model, venue: 'cloud' as const,
        endpointClass: 'official_api' as const, fallbackCount: 0 as const, dataClass: binding.dataClass,
        egressProfileRef: binding.egressProfileRef, retentionProfileRef: binding.retentionProfileRef, consentRefSha256,
        vendorRequestId: vendorRequestId as string | null, latencyMs: latencyMs as number, tokensIn: tokensIn as number | null,
        tokensOut: tokensOut as number | null, payloadSha256, outputSha256, outcome: 'complete' as const, completedAt }) as ProviderOperationReceiptV2;
    RECEIPT_LABELS.set(receipt, binding.providerId === 'openai' ? 'Powered by OpenAI' : 'Powered by Anthropic');
    return receipt;
}

export function poweredByFromProviderReceiptV2(value: unknown): string | null {
    return value && typeof value === 'object' ? RECEIPT_LABELS.get(value as object) ?? null : null;
}
