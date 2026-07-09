export type AmbulatoryConflictSnapshot = {
    id: string;
    version: number;
    isDefault: boolean | null;
    type: string | null;
};

export type AmbulatoryVersionConflictPayload = {
    error: 'Conflict';
    code: 'VERSION_CONFLICT';
    entity: 'ambulatory';
    recordId: string;
    expectedVersion: number;
    currentVersion: number | null;
    currentUpdatedAt: null;
    currentState: 'present' | 'missing';
    currentSnapshot: AmbulatoryConflictSnapshot | null;
};

type AmbulatoryConflictSource = {
    id: string;
    version: number;
    isDefault: boolean | null;
    type: string | null;
};

export function parseExpectedVersion(value: unknown): number | null {
    return Number.isInteger(value) && typeof value === 'number' && value > 0 ? value : null;
}

export function buildAmbulatoryVersionConflictPayload(
    expectedVersion: number,
    recordId: string,
    current: AmbulatoryConflictSource | null,
): AmbulatoryVersionConflictPayload {
    if (!current) {
        return {
            error: 'Conflict', code: 'VERSION_CONFLICT', entity: 'ambulatory', recordId,
            expectedVersion, currentVersion: null, currentUpdatedAt: null,
            currentState: 'missing', currentSnapshot: null,
        };
    }
    return {
        error: 'Conflict', code: 'VERSION_CONFLICT', entity: 'ambulatory', recordId,
        expectedVersion, currentVersion: current.version, currentUpdatedAt: null,
        currentState: 'present',
        currentSnapshot: {
            id: current.id, version: current.version,
            isDefault: current.isDefault ?? null, type: current.type ?? null,
        },
    };
}
