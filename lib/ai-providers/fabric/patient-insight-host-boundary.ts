/* @Codex */
export type PatientInsightProjection = Readonly<{ schemaVersion: 'mediflow.patient-insight.projection.v1'; clinicalFocus: string; activeConditions: readonly string[]; currentTherapies: readonly string[]; recentClinicalEvents: readonly string[] }>;
export type PatientInsightHostResult = Readonly<{ status: 'available'; writesPerformed: 0; applyPolicy: 'none'; receiptReference: string; provenanceReference: string; proposal: Readonly<{ schemaVersion: 'mediflow.patient-insight.review-proposal.v1'; reviewOnly: true; promptFingerprint: string }> }> | Readonly<{ status: 'denied'; code: 'input_invalid'; writesPerformed: 0; applyPolicy: 'none' }>;
export type PatientInsightHostBoundary = Readonly<{ prepare: (request: unknown) => PatientInsightHostResult }>;

const reference = /^(?:(?:lsr|ptr)_[a-f0-9]{32}|(?:receipt|provenance)_[a-f0-9]{32,64})$/;
const denied = Object.freeze({ status: 'denied' as const, code: 'input_invalid' as const, writesPerformed: 0 as const, applyPolicy: 'none' as const });

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value); if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const copy: Record<string, unknown> = {}; for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor)) return null; copy[key] = descriptor.value; }
        return copy;
    } catch { return null; }
}
function text(value: unknown): string | null { return typeof value === 'string' && value.length > 0 && value.length <= 240 && value.trim() === value ? value : null; }
function labels(value: unknown): readonly string[] | null {
    try {
        if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 12 || Reflect.ownKeys(value).length !== value.length + 1) return null;
        const output: string[] = []; for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); const label = descriptor && 'value' in descriptor ? text(descriptor.value) : null; if (!label) return null; output.push(label); }
        return Object.freeze(output);
    } catch { return null; }
}
function projection(value: unknown): PatientInsightProjection | null {
    const input = record(value, ['schemaVersion', 'clinicalFocus', 'activeConditions', 'currentTherapies', 'recentClinicalEvents']); const focus = input && text(input.clinicalFocus); const conditions = input && labels(input.activeConditions); const therapies = input && labels(input.currentTherapies); const events = input && labels(input.recentClinicalEvents);
    return !input || input.schemaVersion !== 'mediflow.patient-insight.projection.v1' || !focus || !conditions || !therapies || !events ? null : Object.freeze({ schemaVersion: 'mediflow.patient-insight.projection.v1', clinicalFocus: focus, activeConditions: conditions, currentTherapies: therapies, recentClinicalEvents: events });
}
function fingerprint(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0; return `pi_${hash.toString(16).padStart(8, '0')}`; }

/** Deterministic host-side construction; route input cannot add text to this prompt. */
function buildPatientInsightPrompt(value: Pick<PatientInsightProjection, 'clinicalFocus' | 'activeConditions' | 'currentTherapies' | 'recentClinicalEvents'>): string {
    return ['Patient Insight review request.', `Clinical focus: ${value.clinicalFocus}`, `Active conditions: ${value.activeConditions.join('; ') || 'none'}`, `Current therapies: ${value.currentTherapies.join('; ') || 'none'}`, `Recent clinical events: ${value.recentClinicalEvents.join('; ') || 'none'}`, 'Return a review-only clinical summary.'].join('\n');
}

function hostContext(value: unknown): Readonly<{ receiptReference: string; provenanceReference: string }> | null {
    const input = record(value, ['binding', 'receipt', 'provenance']); const binding = input && record(input.binding, ['leaseRef', 'patientRef', 'selectionEpoch']); const receipt = input && record(input.receipt, ['schemaVersion', 'reference', 'capability', 'authority', 'writesPerformed', 'applyPolicy']); const provenance = input && record(input.provenance, ['schemaVersion', 'reference', 'capability', 'receiptRef']);
    const lease = binding && text(binding.leaseRef); const patient = binding && text(binding.patientRef); const selectionEpoch = binding?.selectionEpoch; const receiptRef = receipt && text(receipt.reference); const provenanceRef = provenance && text(provenance.reference); const provenanceReceipt = provenance && text(provenance.receiptRef);
    if (!binding || !receipt || !provenance || !lease || !patient || !receiptRef || !provenanceRef || !provenanceReceipt || !reference.test(lease) || !reference.test(patient) || !reference.test(receiptRef) || !reference.test(provenanceRef) || !reference.test(provenanceReceipt) || typeof selectionEpoch !== 'number' || !Number.isSafeInteger(selectionEpoch) || selectionEpoch < 1 || receipt.schemaVersion !== 'mediflow.patient-insight.host-receipt.v1' || receipt.capability !== 'patient_insight' || receipt.authority !== 'host_service' || receipt.writesPerformed !== 0 || receipt.applyPolicy !== 'none' || provenance.schemaVersion !== 'mediflow.patient-insight.host-provenance.v1' || provenance.capability !== 'patient_insight' || provenanceReceipt !== receiptRef) return null;
    return Object.freeze({ receiptReference: receiptRef, provenanceReference: provenanceRef });
}

/** Creates a host-owned, route-facing seam with no binding, identity, patient, or free prompt input. */
export function createPatientInsightHostBoundary(value: unknown): PatientInsightHostBoundary {
    const context = hostContext(value); if (!context) throw new Error('Patient Insight host context is invalid.');
    return Object.freeze({ prepare(request: unknown): PatientInsightHostResult {
        const input = record(request, ['projection']); const minimized = input && projection(input.projection); if (!minimized) return denied;
        const proposal = Object.freeze({ schemaVersion: 'mediflow.patient-insight.review-proposal.v1' as const, reviewOnly: true as const, promptFingerprint: fingerprint(buildPatientInsightPrompt(minimized)) });
        return Object.freeze({ status: 'available' as const, writesPerformed: 0 as const, applyPolicy: 'none' as const, receiptReference: context.receiptReference, provenanceReference: context.provenanceReference, proposal });
    } });
}
