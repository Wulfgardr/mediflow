/* @Codex */
export type CheckupConflictSnapshot = {
    id: string;
    patientId: string;
    version: number;
    updatedAt: string | null;
    deletedAt: string | null;
};

/* @Codex */
export type CheckupVersionConflictPayload = {
    error: 'Conflict';
    code: 'VERSION_CONFLICT';
    entity: 'checkup';
    recordId: string;
    expectedVersion: number;
    currentVersion: number | null;
    currentUpdatedAt: string | null;
    currentState: 'present' | 'missing';
    currentSnapshot: CheckupConflictSnapshot | null;
};

type CheckupConflictSource = {
    id: string;
    patientId: string;
    version: number;
    updatedAt: Date | string | number | null;
    deletedAt?: Date | string | number | null;
};

/* @Codex */
export function parseCheckupExpectedVersion(value: unknown): number | null {
    return Number.isInteger(value) && typeof value === 'number' && value > 0 ? value : null;
}

/* @Codex */
export function buildCheckupVersionConflictPayload(
    expectedVersion: number,
    recordId: string,
    current: CheckupConflictSource | null
): CheckupVersionConflictPayload {
    if (!current) {
        return {
            error: 'Conflict',
            code: 'VERSION_CONFLICT',
            entity: 'checkup',
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
        entity: 'checkup',
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
