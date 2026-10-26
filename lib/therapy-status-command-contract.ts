export const THERAPY_STATUS_PROTOCOL = 'therapy.status.change.v1' as const;
export type TherapyStatus = 'active' | 'suspended' | 'completed';
export type TherapyStatusCommand = {
    commandId: string; protocol: typeof THERAPY_STATUS_PROTOCOL; archiveGeneration: string;
    patientId: string; therapyId: string; expectedVersion: number;
};
export type TherapyStatusExecute = TherapyStatusCommand & { target: TherapyStatus };
export type TherapyStatusReceipt = TherapyStatusCommand & {
    actorRef: string; target: TherapyStatus | null; outcome: 'applied' | 'rejected' | 'closed';
    reason: 'version_conflict' | null; committedAt: number;
    resultVersion: number | null; resultEndDate: number | null; auditEventId: string | null;
};
export const COMMAND_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export function parseTherapyStatusCommand(value: unknown, execute: boolean): TherapyStatusCommand | TherapyStatusExecute | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    const keys = ['commandId', 'protocol', 'archiveGeneration', 'patientId', 'therapyId', 'expectedVersion', ...(execute ? ['target'] : [])];
    if (Object.keys(v).length !== keys.length || !keys.every(key => Object.hasOwn(v, key))
        || typeof v.commandId !== 'string' || !COMMAND_UUID.test(v.commandId)
        || typeof v.archiveGeneration !== 'string' || !COMMAND_UUID.test(v.archiveGeneration)
        || v.protocol !== THERAPY_STATUS_PROTOCOL
        || !['patientId', 'therapyId'].every(key => typeof v[key] === 'string' && (v[key] as string).length >= 1 && (v[key] as string).length <= 256 && v[key] === (v[key] as string).trim())
        || !Number.isSafeInteger(v.expectedVersion) || (v.expectedVersion as number) < 1 || (v.expectedVersion as number) >= Number.MAX_SAFE_INTEGER
        || (execute && !['active', 'suspended', 'completed'].includes(v.target as string))) return null;
    return value as TherapyStatusCommand | TherapyStatusExecute;
}
export function parseTherapyStatusReceipt(value: unknown): TherapyStatusReceipt | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as TherapyStatusReceipt;
    const keys = ['commandId', 'protocol', 'archiveGeneration', 'patientId', 'therapyId', 'expectedVersion', 'actorRef', 'target', 'outcome', 'reason', 'committedAt', 'resultVersion', 'resultEndDate', 'auditEventId'];
    const command = { commandId: row.commandId, protocol: row.protocol, archiveGeneration: row.archiveGeneration, patientId: row.patientId, therapyId: row.therapyId, expectedVersion: row.expectedVersion };
    const second = (n: unknown) => Number.isSafeInteger(n) && !Object.is(n, -0) && (n as number) >= 0 && (n as number) <= 8640000000000;
    if (Object.keys(row).length !== keys.length || !keys.every(key => Object.hasOwn(row, key)) || !parseTherapyStatusCommand(command, false)
        || typeof row.actorRef !== 'string' || row.actorRef.length < 1 || row.actorRef.length > 256 || row.actorRef !== row.actorRef.trim()
        || !second(row.committedAt)) return null;
    if (row.outcome === 'closed') return row.target === null && row.reason === null && row.resultVersion === null && row.resultEndDate === null && row.auditEventId === null ? row : null;
    if (!['active', 'suspended', 'completed'].includes(row.target!)) return null;
    if (row.outcome === 'rejected') return row.reason === 'version_conflict' && row.resultVersion === null && row.resultEndDate === null && row.auditEventId === null ? row : null;
    return row.outcome === 'applied' && row.reason === null && row.resultVersion === row.expectedVersion + 1
        && (row.resultEndDate === null || second(row.resultEndDate)) && (row.target !== 'completed' || row.resultEndDate === row.committedAt)
        && (row.target !== 'active' || row.resultEndDate === null) && typeof row.auditEventId === 'string' && COMMAND_UUID.test(row.auditEventId) ? row : null;
}
