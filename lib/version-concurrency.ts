/* @Codex */
export type VersionedConflictEntity =
    | 'patient'
    | 'entry'
    | 'therapy'
    | 'checkup'
    | 'observation'
    | 'service_prescription'
    | 'service_prescription_item'
    | 'prosthetic_prescription';

/* @Codex */
export type VersionConflictSnapshot = {
    id: string;
    patientId?: string;
    version: number;
    updatedAt: string | null;
    deletedAt?: string | null;
};

/* @Codex */
export type VersionConflictPayload = {
    error: 'Conflict';
    code: 'VERSION_CONFLICT';
    entity: VersionedConflictEntity;
    recordId: string;
    expectedVersion: number;
    currentVersion: number | null;
    currentUpdatedAt: string | null;
    currentState: 'present' | 'missing';
    currentSnapshot: VersionConflictSnapshot | null;
};

/* @Codex */
export type VersionConflictSource = {
    id: string;
    patientId?: string | null;
    version: number;
    updatedAt: Date | string | number | null;
    deletedAt?: Date | string | number | null;
};

/* @Codex */
export function parseExpectedVersion(value: unknown): number | null {
    return Number.isInteger(value) && typeof value === 'number' && value > 0 ? value : null;
}

/* @Codex */
export function requireExpectedVersion(value: unknown):
    | { ok: true; expectedVersion: number }
    | { ok: false; status: 400; value: { error: 'Version is required' } } {
    const expectedVersion = parseExpectedVersion(value);
    if (expectedVersion === null) {
        return { ok: false, status: 400, value: { error: 'Version is required' } };
    }
    return { ok: true, expectedVersion };
}

/* @Codex */
export function isVersionConflictPayload(value: unknown): value is VersionConflictPayload {
    if (!value || typeof value !== 'object') return false;
    const payload = value as Partial<VersionConflictPayload>;
    return payload.code === 'VERSION_CONFLICT'
        && typeof payload.entity === 'string'
        && typeof payload.recordId === 'string';
}

/* @Codex */
export function buildVersionConflictPayload(
    entity: VersionedConflictEntity,
    expectedVersion: number,
    recordId: string,
    current: VersionConflictSource | null
): VersionConflictPayload {
    if (!current) {
        return {
            error: 'Conflict',
            code: 'VERSION_CONFLICT',
            entity,
            recordId,
            expectedVersion,
            currentVersion: null,
            currentUpdatedAt: null,
            currentState: 'missing',
            currentSnapshot: null,
        };
    }

    const currentUpdatedAt = toIsoString(current.updatedAt);
    const currentSnapshot: VersionConflictSnapshot = {
        id: current.id,
        version: current.version,
        updatedAt: currentUpdatedAt,
    };
    if (current.patientId !== undefined && current.patientId !== null) {
        currentSnapshot.patientId = current.patientId;
    }
    if (current.deletedAt !== undefined) {
        currentSnapshot.deletedAt = toIsoString(current.deletedAt ?? null);
    }

    return {
        error: 'Conflict',
        code: 'VERSION_CONFLICT',
        entity,
        recordId,
        expectedVersion,
        currentVersion: current.version,
        currentUpdatedAt,
        currentState: 'present',
        currentSnapshot,
    };
}

function toIsoString(value: Date | string | number | null): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
