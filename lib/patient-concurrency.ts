/* @Codex */
export type PatientConflictSnapshot = {
    id: string;
    version: number;
    updatedAt: string | null;
    isArchived: boolean | null;
};

/* @Codex */
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

/* @Codex */
export function parseExpectedVersion(value: unknown): number | null {
    return Number.isInteger(value) && typeof value === 'number' && value > 0 ? value : null;
}

/* @Codex */
export function isPatientVersionConflictPayload(value: unknown): value is PatientVersionConflictPayload {
    if (!value || typeof value !== 'object') return false;
    const payload = value as Partial<PatientVersionConflictPayload>;
    return payload.code === 'VERSION_CONFLICT' && payload.entity === 'patient' && typeof payload.recordId === 'string';
}

/* @Codex */
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
