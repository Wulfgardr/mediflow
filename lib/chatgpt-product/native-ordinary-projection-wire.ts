/* @Codex — closed plaintext transport; the authentic private grant is the authority. */
import { types } from 'node:util';
import { ProductError } from './product-contract';
import type { NativeOrdinaryPreparation } from './native-ordinary-wire';

export const NATIVE_PROJECTION_SCHEMA = 'mediflow.native-ordinary.source-projection.v1' as const;
export const NATIVE_PROJECTION_HEADER = 'X-MediFlow-Ordinary-Projection';
export const NATIVE_PROJECTION_MAX_BYTES = 2 * 1024 * 1024;
export const NATIVE_PROJECTION_FIELDS = Object.freeze({
    patient: ['notes', 'diagnoses'], entries: ['title', 'content'],
    therapies: ['drugName', 'dosage', 'activePrinciple', 'aic', 'atc'],
    observations: ['display', 'value', 'unitCode'], attachments: ['name', 'summarySnapshot'],
    attachment_bytes: ['data'],
} as const);
export type NativeProjectionEntity = keyof typeof NATIVE_PROJECTION_FIELDS;
export type NativeProjectionSelector = Readonly<{ entity: NativeProjectionEntity; id: string; fields: readonly string[] }>;
export type NativeProjectionPlan = Readonly<{
    schemaVersion: typeof NATIVE_PROJECTION_SCHEMA; grantId: string;
    functionId: NativeOrdinaryPreparation['functionId']; expiresAt: number;
    roster: readonly NativeProjectionSelector[];
}>;
export type NativeProjectionRow = Readonly<{ entity: NativeProjectionEntity; id: string;
    fields: readonly Readonly<{ name: string; value: string }>[] }>;
export type NativeProjectionBody = Readonly<{ schemaVersion: typeof NATIVE_PROJECTION_SCHEMA;
    functionId: Exclude<NativeOrdinaryPreparation['functionId'], 'document_synthesis'>;
    rows: readonly NativeProjectionRow[] }>;
const invalid = (): never => { throw new ProductError('invalid_request'); };
export const isNativeProjectionGrantId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return invalid();
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some(k => typeof k !== 'string' || !keys.includes(k))) return invalid();
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
        const d = Object.getOwnPropertyDescriptor(value, key);
        if (!d?.enumerable || !('value' in d)) return invalid();
        result[key] = d.value;
    }
    return result;
}
function array(value: unknown, count: number): unknown[] {
    if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype
        || value.length !== count || Reflect.ownKeys(value).length !== count + 1) return invalid();
    for (let i = 0; i < count; i++) {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d?.enumerable || !('value' in d)) return invalid();
    }
    return value;
}
export function readableNativeProjectionText(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 262144 && !value.includes('ENC:')
        && !value.includes('[LOCKED DATA]') && !/[\x00]/u.test(value) && value.isWellFormed();
}
/** Order and cardinality must agree exactly; host-owned non-ENC values are never submitted. */
export function parseNativeOrdinaryProjection(value: unknown, plan: NativeProjectionPlan): NativeProjectionBody {
    const body = exact(value, ['schemaVersion', 'functionId', 'rows']);
    if (body.schemaVersion !== NATIVE_PROJECTION_SCHEMA || plan.functionId === 'document_synthesis'
        || body.functionId !== plan.functionId) return invalid();
    const rows = array(body.rows, plan.roster.length).map((item, i) => {
        const expected = plan.roster[i]!, row = exact(item, ['entity', 'id', 'fields']);
        if (row.entity !== expected.entity || row.id !== expected.id) return invalid();
        const fields = array(row.fields, expected.fields.length).map((item, j) => {
            const field = exact(item, ['name', 'value']);
            if (field.name !== expected.fields[j] || !readableNativeProjectionText(field.value)) return invalid();
            return Object.freeze({ name: field.name as string, value: field.value });
        });
        return Object.freeze({ entity: expected.entity, id: expected.id, fields: Object.freeze(fields) });
    });
    return Object.freeze({ schemaVersion: NATIVE_PROJECTION_SCHEMA, functionId: plan.functionId, rows: Object.freeze(rows) });
}
