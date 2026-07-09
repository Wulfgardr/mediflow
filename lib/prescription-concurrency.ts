/* @Codex */
import {
    buildVersionConflictPayload,
    parseExpectedVersion,
    type VersionConflictPayload,
    type VersionConflictSource,
} from './version-concurrency';

/* @Codex */
export type PrescriptionConflictEntity =
    | 'service_prescription'
    | 'service_prescription_item'
    | 'prosthetic_prescription';

/* @Codex */
export type PrescriptionVersionConflictPayload = VersionConflictPayload & {
    entity: PrescriptionConflictEntity;
};

/* @Codex */
export const parsePrescriptionExpectedVersion = parseExpectedVersion;

/* @Codex */
export function buildPrescriptionVersionConflictPayload(
    entity: PrescriptionConflictEntity,
    expectedVersion: number,
    recordId: string,
    current: VersionConflictSource | null
): PrescriptionVersionConflictPayload {
    return buildVersionConflictPayload(entity, expectedVersion, recordId, current) as PrescriptionVersionConflictPayload;
}
