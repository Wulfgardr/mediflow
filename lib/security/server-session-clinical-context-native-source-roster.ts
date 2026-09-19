/* @Codex — pure roster/projection mechanics, never an authority issuer or decryptor. */
import { ProductError } from '../chatgpt-product/product-contract';
import { NATIVE_PROJECTION_FIELDS, type NativeProjectionBody, type NativeProjectionSelector } from '../chatgpt-product/native-ordinary-projection-wire';
import type { NativeOrdinarySourceRows } from './server-session-clinical-context-native-source-rows';
const invalid = (): never => { throw new ProductError('invalid_state'); };
const entities = ['patient', 'entries', 'therapies', 'observations', 'attachments'] as const;
export function nativeEncryptedSourceRoster(rows: NativeOrdinarySourceRows): readonly NativeProjectionSelector[] {
    const roster: NativeProjectionSelector[] = [];
    for (const entity of entities) {
        const selected = entity === 'patient' ? [rows.patient] : rows[entity];
        const ids = new Set<string>();
        for (const row of selected) {
            if (ids.has(row.id)) return invalid(); ids.add(row.id);
            const values = row as unknown as Record<string, unknown>;
            const fields: string[] = [];
            for (const name of NATIVE_PROJECTION_FIELDS[entity]) {
                const value = values[name];
                if (typeof value === 'string' && value.trimStart().startsWith('ENC:')) {
                    // Whitespace-prefixed envelopes cannot be decoded by repository Swift crypto.
                    if (!value.startsWith('ENC:')) return invalid();
                    fields.push(name);
                }
                if (typeof value === 'string' && value.includes('[LOCKED DATA]')) return invalid();
            }
            if (fields.length) roster.push(Object.freeze({ entity, id: row.id, fields: Object.freeze(fields) }));
        }
    }
    return Object.freeze(roster);
}
/** Only called after exact parser/roster admission and a fresh host digest comparison. */
export function projectNativeSourceRows(rows: NativeOrdinarySourceRows, body: NativeProjectionBody): NativeOrdinarySourceRows {
    const result = structuredClone(rows);
    for (const projected of body.rows) {
        if (projected.entity === 'attachment_bytes') return invalid();
        const selected = projected.entity === 'patient' ? [result.patient] : result[projected.entity];
        const row = selected.find((row: { id: string }) => row.id === projected.id) as unknown as Record<string, unknown> | undefined;
        if (!row) return invalid();
        for (const field of projected.fields) {
            if (typeof row[field.name] !== 'string' || !(row[field.name] as string).startsWith('ENC:')) return invalid();
            row[field.name] = field.value;
        }
    }
    if (nativeEncryptedSourceRoster(result).length) return invalid();
    return result;
}
