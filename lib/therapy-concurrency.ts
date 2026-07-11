import { parseExpectedVersion } from './version-concurrency';

/* @Codex */
export type TherapyConflictSnapshot = {
    id: string;
    patientId: string;
    version: number;
    updatedAt: string | null;
    deletedAt: string | null;
};

/* @Codex */
export type TherapyVersionConflictPayload = {
    error: 'Conflict';
    code: 'VERSION_CONFLICT';
    entity: 'therapy';
    recordId: string;
    expectedVersion: number;
    currentVersion: number | null;
    currentUpdatedAt: string | null;
    currentState: 'present' | 'missing';
    currentSnapshot: TherapyConflictSnapshot | null;
};

type TherapyConflictSource = {
    id: string;
    patientId: string;
    version: number;
    updatedAt: Date | string | number | null;
    deletedAt?: Date | string | number | null;
};

/* @Codex */
export function parseTherapyExpectedVersion(value: unknown): number | null {
    return parseExpectedVersion(value);
}

/* @Codex */
export function buildTherapyVersionConflictPayload(
    expectedVersion: number,
    recordId: string,
    current: TherapyConflictSource | null
): TherapyVersionConflictPayload {
    if (!current) {
        return {
            error: 'Conflict',
            code: 'VERSION_CONFLICT',
            entity: 'therapy',
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
        entity: 'therapy',
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
