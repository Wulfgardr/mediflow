import { parseExpectedVersion } from './version-concurrency';

/* @Codex */
export type ObservationConflictSnapshot = {
    id: string;
    patientId: string;
    version: number;
    updatedAt: string | null;
    deletedAt: string | null;
};

/* @Codex */
export type ObservationVersionConflictPayload = {
    error: 'Conflict';
    code: 'VERSION_CONFLICT';
    entity: 'observation';
    recordId: string;
    expectedVersion: number;
    currentVersion: number | null;
    currentUpdatedAt: string | null;
    currentState: 'present' | 'missing';
    currentSnapshot: ObservationConflictSnapshot | null;
};

type ObservationConflictSource = {
    id: string;
    patientId: string;
    version: number;
    updatedAt: Date | string | number | null;
    deletedAt?: Date | string | number | null;
};

/* @Codex */
export function parseObservationExpectedVersion(value: unknown): number | null {
    return parseExpectedVersion(value);
}

/* @Codex */
export function buildObservationVersionConflictPayload(
    expectedVersion: number,
    recordId: string,
    current: ObservationConflictSource | null
): ObservationVersionConflictPayload {
    if (!current) {
        return {
            error: 'Conflict',
            code: 'VERSION_CONFLICT',
            entity: 'observation',
            recordId,
            expectedVersion,
            currentVersion: null,
            currentUpdatedAt: null,
            currentState: 'missing',
            currentSnapshot: null,
        };
    }

    const currentUpdatedAt = toIsoString(current.updatedAt);

    return {
        error: 'Conflict',
        code: 'VERSION_CONFLICT',
        entity: 'observation',
        recordId,
        expectedVersion,
        currentVersion: current.version,
        currentUpdatedAt,
        currentState: 'present',
        currentSnapshot: {
            id: current.id,
            patientId: current.patientId,
            version: current.version,
            updatedAt: currentUpdatedAt,
            deletedAt: toIsoString(current.deletedAt ?? null),
        },
    };
}

function toIsoString(value: Date | string | number | null): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
