import { parseExpectedVersion as parseCanonicalExpectedVersion } from './version-concurrency';

export type PatientConflictSnapshot = {
    id: string;
    version: number;
    updatedAt: string | null;
    isArchived: boolean | null;
};

export type PatientVersionConflictPayload = {
    error: 'Conflict';
    code: 'VERSION_CONFLICT';
    entity: 'patient';
    recordId: string;
    expectedVersion: number;
    currentVersion: number | null;
    currentUpdatedAt: string | null;
    currentState: 'present' | 'missing';
    currentSnapshot: PatientConflictSnapshot | null;
};

type PatientConflictSource = {
    id: string;
    version: number;
    updatedAt: Date | string | number | null;
    isArchived: boolean | null;
};

export function parseExpectedVersion(value: unknown): number | null {
    return parseCanonicalExpectedVersion(value);
}

export function buildPatientVersionConflictPayload(
    expectedVersion: number,
    recordId: string,
    current: PatientConflictSource | null
): PatientVersionConflictPayload {
    if (!current) {
        return {
            error: 'Conflict',
            code: 'VERSION_CONFLICT',
            entity: 'patient',
            recordId,
            expectedVersion,
            currentVersion: null,
            currentUpdatedAt: null,
            currentState: 'missing',
            currentSnapshot: null
        };
    }

    const currentUpdatedAt = toIsoString(current.updatedAt);

    return {
        error: 'Conflict',
        code: 'VERSION_CONFLICT',
        entity: 'patient',
        recordId,
        expectedVersion,
        currentVersion: current.version,
        currentUpdatedAt,
        currentState: 'present',
        currentSnapshot: {
            id: current.id,
            version: current.version,
            updatedAt: currentUpdatedAt,
            isArchived: current.isArchived ?? null
        }
    };
}

function toIsoString(value: Date | string | number | null): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
