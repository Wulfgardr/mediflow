import 'server-only';

import { types } from 'node:util';

/* @Codex */
export const TREATMENT_REASONING_ATHENA_ADMISSION_SCHEMA = 'mediflow.ai.treatment-reasoning-athena-admission.v1' as const;
type Binding = Readonly<{ receiptRef: string; provenanceRef: string; evidenceCount: number }>;
export type TreatmentReasoningAthenaAdmissionResult = Readonly<{ status: 'admitted'; code: null; admission: Readonly<{ schema: typeof TREATMENT_REASONING_ATHENA_ADMISSION_SCHEMA; capability: 'treatment_reasoning'; stage: 'preview'; review: 'required'; uncertainty: Readonly<{ level: 'low'; source: 'degraded_default' }>; evidence: Readonly<{ source: 'host_minimized'; count: number }>; provenanceRef: string; receiptRef: string }>; writesPerformed: 0; applyPolicy: 'none' }> | Readonly<{ status: 'denied'; code: 'input_invalid'; admission: null; writesPerformed: 0; applyPolicy: 'none' }>;

const REF = /^[A-Za-z][A-Za-z0-9._:-]{2,159}$/u;
const COMMON = Object.freeze({ writesPerformed: 0 as const, applyPolicy: 'none' as const });
const UNCERTAINTY = Object.freeze({ level: 'low' as const, source: 'degraded_default' as const });

export class TreatmentReasoningAthenaAdmissionConfigurationError extends Error {
    constructor() { super('Treatment reasoning ATHENA admission configuration rejected'); this.name = 'TreatmentReasoningAthenaAdmissionConfigurationError'; }
}

function record(value: unknown, expected: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const keys = Reflect.ownKeys(value);
        if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (!expected.every((key) => { const descriptor = descriptors[key]; return descriptor?.enumerable && 'value' in descriptor; })) return null;
        return value as Record<string, unknown>;
    } catch { return null; }
}

function ref(value: unknown): string | null { return typeof value === 'string' && REF.test(value) ? value : null; }

function evidence(value: unknown): number | null {
    try {
        if (typeof value !== 'object' || value === null || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value); const lengthDescriptor = descriptors['length'] as PropertyDescriptor | undefined;
        if (!lengthDescriptor || lengthDescriptor.enumerable || !('value' in lengthDescriptor) || typeof lengthDescriptor.value !== 'number' || !Number.isInteger(lengthDescriptor.value) || lengthDescriptor.value < 1 || lengthDescriptor.value > 16) return null;
        const length = lengthDescriptor.value; const expected = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
        const keys = Reflect.ownKeys(value);
        if (keys.length !== expected.size || !keys.every((key) => expected.has(String(key)))) return null;
        const seen = new Set<string>();
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)]; const valueRef = descriptor?.enumerable && 'value' in descriptor ? ref(descriptor.value) : null;
            if (!valueRef || seen.has(valueRef)) return null; seen.add(valueRef);
        }
        return length;
    } catch { return null; }
}

function binding(value: unknown): Binding | null {
    const input = record(value, ['readiness', 'receipt', 'provenance', 'evidenceRefs']);
    const readiness = input && record(input.readiness, ['provider', 'locality', 'status']);
    const receipt = input && record(input.receipt, ['schema', 'reference', 'capability', 'provider', 'venue', 'egress', 'fallback']);
    const provenance = input && record(input.provenance, ['schema', 'reference', 'capability', 'provider', 'receiptRef']);
    const receiptRef = receipt && ref(receipt.reference); const provenanceRef = provenance && ref(provenance.reference); const evidenceCount = input && evidence(input.evidenceRefs);
    if (!readiness || !receipt || !provenance || !receiptRef || !provenanceRef || evidenceCount === null
        || readiness.provider !== 'athena_mlx' || readiness.locality !== 'local_process' || readiness.status !== 'available_unqualified'
        || receipt.schema !== 'mediflow.ai.treatment-reasoning-host-receipt.v1' || receipt.capability !== 'treatment_reasoning' || receipt.provider !== 'athena_mlx' || receipt.venue !== 'local_process' || receipt.egress !== 'none' || receipt.fallback !== 'denied_by_contract'
        || provenance.schema !== 'mediflow.ai.treatment-reasoning-host-provenance.v1' || provenance.capability !== 'treatment_reasoning' || provenance.provider !== 'athena_mlx' || provenance.receiptRef !== receiptRef) return null;
    return Object.freeze({ receiptRef, provenanceRef, evidenceCount });
}

function accepted(value: unknown, host: Binding): boolean {
    const input = record(value, ['schema', 'capability', 'stage', 'review', 'uncertainty', 'provenanceRef', 'receiptRef', 'writesPerformed', 'applyPolicy']);
    const uncertainty = input && record(input.uncertainty, ['level', 'source']);
    return input !== null && input.schema === 'mediflow.ai.treatment-reasoning-review-proposal.v1' && input.capability === 'treatment_reasoning' && input.stage === 'preview' && input.review === 'required'
        && uncertainty?.level === UNCERTAINTY.level && uncertainty.source === UNCERTAINTY.source && input.provenanceRef === host.provenanceRef && input.receiptRef === host.receiptRef && input.writesPerformed === 0 && input.applyPolicy === 'none';
}

function deny(): TreatmentReasoningAthenaAdmissionResult { return Object.freeze({ status: 'denied', code: 'input_invalid', admission: null, ...COMMON }); }
function admit(host: Binding): TreatmentReasoningAthenaAdmissionResult {
    const admission = Object.freeze({ schema: TREATMENT_REASONING_ATHENA_ADMISSION_SCHEMA, capability: 'treatment_reasoning' as const, stage: 'preview' as const, review: 'required' as const, uncertainty: UNCERTAINTY, evidence: Object.freeze({ source: 'host_minimized' as const, count: host.evidenceCount }), provenanceRef: host.provenanceRef, receiptRef: host.receiptRef });
    return Object.freeze({ status: 'admitted', code: null, admission, ...COMMON });
}

/** Server-only, host-bound, review-only admission seam; it cannot select a provider or invoke one. */
export function createTreatmentReasoningAthenaAdmission(configuration: unknown): Readonly<{ admit(value: unknown): TreatmentReasoningAthenaAdmissionResult }> {
    const host = binding(configuration);
    if (!host) throw new TreatmentReasoningAthenaAdmissionConfigurationError();
    return Object.freeze({ admit: (value: unknown): TreatmentReasoningAthenaAdmissionResult => accepted(value, host) ? admit(host) : deny() });
}
