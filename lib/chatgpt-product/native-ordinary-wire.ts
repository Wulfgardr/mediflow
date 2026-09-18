/* @Codex — data only; never authority. */
import { types } from 'node:util';
import { ordinaryWireObject, type OrdinaryFunction } from './ordinary-wire';
import { ProductError } from './product-contract';
export const NATIVE_ORDINARY_SCHEMA = 'mediflow.native-ordinary.v1' as const;
export type NativeOrdinaryPreparation = Readonly<{
    functionId: OrdinaryFunction; patientId: string; ambulatoryId: string; patientRevision: number; input: unknown;
}>;
export function parseNativeOrdinaryPreparation(value: unknown): NativeOrdinaryPreparation {
    if (typeof value !== 'object' || !value || types.isProxy(value)) throw new ProductError('invalid_request');
    const input = ordinaryWireObject(value, ['functionId', 'patientId', 'ambulatoryId', 'patientRevision', 'input']);
    const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0
        && value.length <= 160 && value.trim() === value && !/[\x00-\x1f\x7f]/u.test(value);
    if (!input || typeof input.functionId !== 'string' || !['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'].includes(input.functionId)
        || !id(input.patientId) || !id(input.ambulatoryId) || !Number.isSafeInteger(input.patientRevision)
        || (input.patientRevision as number) < 1 || !input.input || typeof input.input !== 'object'
        || Array.isArray(input.input) || types.isProxy(input.input)) throw new ProductError('invalid_request');
    return Object.freeze(input) as NativeOrdinaryPreparation;
}
