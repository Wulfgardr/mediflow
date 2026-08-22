/* @Codex */
import 'server-only';

import {
    snapshotSmartImportProjectionAttachment,
    type SmartImportProjection,
} from './smart-import-projection';

export type SmartImportProjectionAttachmentHostErrorCode = 'authority_invalid' | 'source_invalid';
export class SmartImportProjectionAttachmentHostError extends Error {
    constructor(readonly code: SmartImportProjectionAttachmentHostErrorCode) {
        super(`Smart Import projection attachment host rejected: ${code}`);
        this.name = 'SmartImportProjectionAttachmentHostError';
    }
}
export type HostSmartImportProjectionAuthority = Readonly<{ patientRef: string; selectionEpoch: number }>;
export type HostSmartImportProjectionAttacherSources = Readonly<{ clock: () => unknown }>;

const productionSources: HostSmartImportProjectionAttacherSources = Object.freeze({ clock: () => new Date().toISOString() });
function fail(code: SmartImportProjectionAttachmentHostErrorCode): never {
    throw new SmartImportProjectionAttachmentHostError(code);
}
function exact(value: unknown, keys: readonly string[], code: SmartImportProjectionAttachmentHostErrorCode) {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) fail(code);
    const record: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor)) fail(code);
        record[key] = descriptor.value;
    }
    return record;
}
function safeExact(value: unknown, keys: readonly string[], code: SmartImportProjectionAttachmentHostErrorCode) {
    try { return exact(value, keys, code); } catch (error) {
        if (error instanceof SmartImportProjectionAttachmentHostError) throw error;
        return fail(code);
    }
}
function authority(value: unknown): HostSmartImportProjectionAuthority {
    const record = safeExact(value, ['patientRef', 'selectionEpoch'], 'authority_invalid');
    if (typeof record.patientRef !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u.test(record.patientRef)
        || !Number.isSafeInteger(record.selectionEpoch) || (record.selectionEpoch as number) < 1) fail('authority_invalid');
    return Object.freeze({ patientRef: record.patientRef, selectionEpoch: record.selectionEpoch as number });
}
function readClock(clock: () => unknown): string {
    try {
        const value = clock();
        if (typeof value !== 'string' || value.length > 32 || !Number.isFinite(Date.parse(value))
            || new Date(value).toISOString() !== value) return fail('source_invalid');
        return value;
    } catch { return fail('source_invalid'); }
}

export function createHostSmartImportProjectionAttacher(
    authorityValue: HostSmartImportProjectionAuthority,
    sourceValue: HostSmartImportProjectionAttacherSources = productionSources,
) {
    const canonical = authority(authorityValue);
    const source = safeExact(sourceValue, ['clock'], 'source_invalid');
    if (typeof source.clock !== 'function') fail('source_invalid');
    const clock = source.clock as () => unknown;
    return Object.freeze({
        attach(value: unknown): SmartImportProjection {
            const attachment = snapshotSmartImportProjectionAttachment(value, readClock(clock));
            return Object.freeze({
                schemaVersion: 'mediflow.smart-import.projection.v1', capability: 'smart_import',
                patientRef: canonical.patientRef, selectionEpoch: canonical.selectionEpoch,
                patientRevision: attachment.patientRevision, sourceRevision: attachment.sourceRevision,
                capturedAt: attachment.capturedAt, currentDiagnoses: attachment.currentDiagnoses,
                currentActiveTherapies: attachment.currentActiveTherapies,
                therapyCandidateHints: attachment.therapyCandidateHints, sources: attachment.sources,
            });
        },
    });
}
