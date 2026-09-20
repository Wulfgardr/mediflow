/* @Codex — selectors only; no caller text, projection, capability or authority. */
import { types } from 'node:util';
import { ProductError } from './product-contract';
export const NATIVE_ORDINARY_SCHEMA = 'mediflow.native-ordinary.v1' as const;
type Context = Readonly<{ patientId: string; ambulatoryId: string; patientRevision: number }>;
export type NativeOrdinaryPreparation = Context & (
    | Readonly<{ functionId: 'patient_insight'; input: Readonly<{ selector: 'current_patient_insight' }> }>
    | Readonly<{ functionId: 'smart_import'; input: Readonly<{ selector: 'current_smart_import' }> }>
    | Readonly<{ functionId: 'treatment_reasoning'; input: Readonly<{ selector: 'current_treatment_reasoning' }> }>
    | Readonly<{ functionId: 'document_synthesis'; input: Readonly<{ attachmentId: string }> }>
);
function invalid(): never { throw new ProductError('invalid_request'); }
/** Descriptors, not property reads: no traps, coercion, getters or inherited fields. */
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
            || Object.getPrototypeOf(value) !== Object.prototype) return invalid();
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return invalid();
        const result: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return invalid();
            result[key] = descriptor.value;
        }
        return result;
    } catch { return invalid(); }
}
function id(value: unknown, maximum = 160): string {
    if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.trim() !== value
        || /[\x00-\x1f\x7f]/u.test(value) || /[\uD800-\uDFFF]/u.test(value)) return invalid();
    return value;
}
export function parseNativeOrdinaryPreparation(value: unknown): NativeOrdinaryPreparation {
    const input = exact(value, ['functionId', 'patientId', 'ambulatoryId', 'patientRevision', 'input']);
    const patientId = id(input.patientId), ambulatoryId = id(input.ambulatoryId);
    if (!Number.isSafeInteger(input.patientRevision) || (input.patientRevision as number) < 1) return invalid();
    const context = { patientId, ambulatoryId, patientRevision: input.patientRevision as number };
    switch (input.functionId) {
        case 'patient_insight': {
            const selector = exact(input.input, ['selector']);
            if (selector.selector !== 'current_patient_insight') return invalid();
            return Object.freeze({ ...context, functionId: 'patient_insight', input: Object.freeze({ selector: 'current_patient_insight' }) });
        }
        case 'smart_import': {
            const selector = exact(input.input, ['selector']);
            if (selector.selector !== 'current_smart_import') return invalid();
            return Object.freeze({ ...context, functionId: 'smart_import', input: Object.freeze({ selector: 'current_smart_import' }) });
        }
        case 'treatment_reasoning': {
            const selector = exact(input.input, ['selector']);
            if (selector.selector !== 'current_treatment_reasoning') return invalid();
            return Object.freeze({ ...context, functionId: 'treatment_reasoning', input: Object.freeze({ selector: 'current_treatment_reasoning' }) });
        }
        case 'document_synthesis': {
            const selector = exact(input.input, ['attachmentId']);
            return Object.freeze({ ...context, functionId: 'document_synthesis', input: Object.freeze({ attachmentId: id(selector.attachmentId, 200) }) });
        }
        default: return invalid();
    }
}
