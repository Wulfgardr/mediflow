export const AMBULATORY_COMMAND_PROTOCOL = 'ambulatory.destructive.v1' as const;
export type AmbulatoryDestructiveOperation = 'ambulatory.clear-test.v1' | 'ambulatory.delete.v1';
export type AmbulatoryCommandMarker = {
    protocol: typeof AMBULATORY_COMMAND_PROTOCOL; commandId: string;
    originalArchiveGeneration: string; originalScopeId: string; ambulatoryId: string;
    expectedVersion: number; operation: AmbulatoryDestructiveOperation; planDigest: string;
};
export type AmbulatoryCommandResult = {
    targetVersion: number | null;
    affectedAmbulatories: Array<{ id: string; version: number }>;
    clear: { tombstonedPatients: number; unlinkedPatients: number; preservedLivePatients: number; removedMembershipRows: number } | null;
};
export type AmbulatoryCommandReceipt = AmbulatoryCommandMarker & {
    outcome: 'applied' | 'rejected' | 'closed'; reason: 'plan_changed' | 'not_admissible' | null;
    committedAt: number; result: AmbulatoryCommandResult | null;
};
export const AMBULATORY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export function commandObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
        && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function commandOpaqueId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value
        && !/[\u0000-\u001f\u007f]/u.test(value);
}
export function commandVersion(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= Number.MAX_SAFE_INTEGER;
}
export function commandOperation(value: unknown): value is AmbulatoryDestructiveOperation {
    return value === 'ambulatory.clear-test.v1' || value === 'ambulatory.delete.v1';
}
export const AMBULATORY_MARKER_FIELDS = ['protocol', 'commandId', 'originalArchiveGeneration', 'originalScopeId', 'ambulatoryId', 'expectedVersion', 'operation', 'planDigest'] as const;
export function parseAmbulatoryCommandMarker(value: unknown): AmbulatoryCommandMarker | null {
    if (!commandObject(value, AMBULATORY_MARKER_FIELDS) || value.protocol !== AMBULATORY_COMMAND_PROTOCOL
        || typeof value.commandId !== 'string' || !AMBULATORY_UUID.test(value.commandId)
        || typeof value.originalArchiveGeneration !== 'string' || !AMBULATORY_UUID.test(value.originalArchiveGeneration)
        || !commandOpaqueId(value.originalScopeId) || !commandOpaqueId(value.ambulatoryId)
        || !commandVersion(value.expectedVersion) || !commandOperation(value.operation)
        || typeof value.planDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(value.planDigest)) return null;
    return value as AmbulatoryCommandMarker;
}
export function parseAmbulatoryCommandResult(value: unknown): AmbulatoryCommandResult | null {
    if (!commandObject(value, ['targetVersion', 'affectedAmbulatories', 'clear'])
        || !(value.targetVersion === null || commandVersion(value.targetVersion)) || !Array.isArray(value.affectedAmbulatories)) return null;
    const seen = new Set<string>();
    for (const row of value.affectedAmbulatories) {
        if (!commandObject(row, ['id', 'version']) || !commandOpaqueId(row.id) || !commandVersion(row.version) || seen.has(row.id)) return null;
        seen.add(row.id);
    }
    if (value.clear !== null) {
        const keys = ['tombstonedPatients', 'unlinkedPatients', 'preservedLivePatients', 'removedMembershipRows'];
        const clear = value.clear;
        if (!commandObject(clear, keys) || keys.some(key => !Number.isSafeInteger(clear[key]) || Object.is(clear[key], -0) || (clear[key] as number) < 0)) return null;
    }
    return value as AmbulatoryCommandResult;
}
export function parseAmbulatoryCommandReceipt(value: unknown): AmbulatoryCommandReceipt | null {
    if (!commandObject(value, [...AMBULATORY_MARKER_FIELDS, 'outcome', 'reason', 'committedAt', 'result'])) return null;
    const marker = Object.fromEntries(AMBULATORY_MARKER_FIELDS.map(key => [key, value[key]]));
    if (!parseAmbulatoryCommandMarker(marker) || !Number.isSafeInteger(value.committedAt) || Object.is(value.committedAt, -0)
        || (value.committedAt as number) < 0 || (value.committedAt as number) > 8640000000000) return null;
    if (value.outcome === 'closed') return value.reason === null && value.result === null ? value as AmbulatoryCommandReceipt : null;
    if (value.outcome === 'rejected') return ['plan_changed', 'not_admissible'].includes(value.reason as string) && value.result === null ? value as AmbulatoryCommandReceipt : null;
    const result = parseAmbulatoryCommandResult(value.result);
    if (value.outcome !== 'applied' || value.reason !== null || !result) return null;
    if (value.operation === 'ambulatory.delete.v1') return result.targetVersion === null && result.clear === null
        && result.affectedAmbulatories.length <= 1 && !result.affectedAmbulatories.some(row => row.id === value.ambulatoryId) ? value as AmbulatoryCommandReceipt : null;
    return result.clear !== null && result.targetVersion === (value.expectedVersion as number) + 1
        && result.affectedAmbulatories.length === 1 && result.affectedAmbulatories[0].id === value.ambulatoryId
        && result.affectedAmbulatories[0].version === result.targetVersion
        && result.clear.removedMembershipRows >= result.clear.tombstonedPatients + result.clear.unlinkedPatients
        && result.clear.preservedLivePatients <= result.clear.unlinkedPatients ? value as AmbulatoryCommandReceipt : null;
}
