import {
    buildVersionConflictPayload,
    parseExpectedVersion,
    type VersionConflictPayload,
    type VersionConflictSource,
} from './version-concurrency';

export type PrescriptionConflictEntity =
    | 'service_prescription'
    | 'service_prescription_item'
    | 'prosthetic_prescription';

export type PrescriptionVersionConflictPayload = VersionConflictPayload & {
    entity: PrescriptionConflictEntity;
};

export const parsePrescriptionExpectedVersion = parseExpectedVersion;

export function buildPrescriptionVersionConflictPayload(
    entity: PrescriptionConflictEntity,
    expectedVersion: number,
    recordId: string,
    current: VersionConflictSource | null
): PrescriptionVersionConflictPayload {
    return buildVersionConflictPayload(entity, expectedVersion, recordId, current) as PrescriptionVersionConflictPayload;
}
