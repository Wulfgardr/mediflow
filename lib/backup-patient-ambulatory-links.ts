/* @Codex */
import type { BackupArtifact } from './backup-artifact';

export type RestoredPatientAmbulatoryLink = {
    patientId: string;
    ambulatoryId: string;
    assignedAt: Date;
};

type BackupPatientAmbulatoryLinkRow = {
    patientId: string;
    ambulatoryId: string;
    assignedAt: Date | null;
};

type BackupPatientAmbulatoryAssignments = {
    assignedAmbulatoryIds?: string[];
    assignedAmbulatoryMemberships?: Array<{ ambulatoryId: string; assignedAt: Date | null }>;
};

export function enrichBackupPatientsWithAmbulatoryLinks<T extends object>(
    patients: T[],
    rows: BackupPatientAmbulatoryLinkRow[],
): Array<T & BackupPatientAmbulatoryAssignments> {
    const rowsByPatientId = new Map<string, BackupPatientAmbulatoryLinkRow[]>();
    for (const row of rows) {
        const patientRows = rowsByPatientId.get(row.patientId);
        if (patientRows) patientRows.push(row);
        else rowsByPatientId.set(row.patientId, [row]);
    }

    return patients.map((patient) => {
        const record = patient as Record<string, unknown>;
        const fallbackAmbulatoryId = typeof record.ambulatoryId === 'string' && record.ambulatoryId.trim().length > 0
            ? record.ambulatoryId
            : null;
        const fallbackAssignedAt = record.updatedAt instanceof Date
            ? record.updatedAt
            : record.createdAt instanceof Date
                ? record.createdAt
                : null;
        const ids = new Set<string>(fallbackAmbulatoryId ? [fallbackAmbulatoryId] : []);
        const memberships = new Map<string, Date | null>();

        for (const row of typeof record.id === 'string' ? rowsByPatientId.get(record.id) ?? [] : []) {
            if (row.ambulatoryId.trim().length === 0) continue;
            ids.add(row.ambulatoryId);
            memberships.set(row.ambulatoryId, row.assignedAt);
        }
        if (fallbackAmbulatoryId && !memberships.has(fallbackAmbulatoryId)) memberships.set(fallbackAmbulatoryId, fallbackAssignedAt);

        const assignedAmbulatoryIds = Array.from(ids).sort((left, right) => left.localeCompare(right));
        return assignedAmbulatoryIds.length > 0
            ? {
                ...patient,
                assignedAmbulatoryIds,
                assignedAmbulatoryMemberships: Array.from(memberships, ([ambulatoryId, assignedAt]) => ({ ambulatoryId, assignedAt }))
                    .sort((left, right) => left.ambulatoryId.localeCompare(right.ambulatoryId)),
            }
            : patient;
    });
}

function parseAssignedAmbulatoryIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
    ));
}

function parseAssignedAmbulatoryMemberships(value: unknown): Array<{ ambulatoryId: string; assignedAt: unknown }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const membership = item as Record<string, unknown>;
        if (typeof membership.ambulatoryId !== 'string' || membership.ambulatoryId.trim().length === 0) return [];
        return [{ ambulatoryId: membership.ambulatoryId, assignedAt: membership.assignedAt }];
    });
}

function parseAssignedAt(value: unknown, fallback: Date): Date {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : value;
    if (typeof value === 'number') {
        const milliseconds = Number.isInteger(value) && Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
        const parsed = new Date(milliseconds);
        return Number.isNaN(parsed.getTime()) ? fallback : parsed;
    }
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? fallback : parsed;
    }
    return fallback;
}

export function derivePatientAmbulatoryLinks(
    patientsPayload: BackupArtifact['payload']['patients'],
): RestoredPatientAmbulatoryLink[] {
    return patientsPayload.flatMap((patient) => {
        if (typeof patient.id !== 'string') return [];
        const patientId = patient.id;

        const assignedAt = typeof patient.updatedAt === 'string'
            ? new Date(patient.updatedAt)
            : typeof patient.createdAt === 'string'
                ? new Date(patient.createdAt)
                : new Date();
        const normalizedAssignedAt = Number.isNaN(assignedAt.getTime()) ? new Date() : assignedAt;
        const memberships = new Map<string, Date>();
        for (const membership of parseAssignedAmbulatoryMemberships(patient.assignedAmbulatoryMemberships)) {
            memberships.set(membership.ambulatoryId, parseAssignedAt(membership.assignedAt, normalizedAssignedAt));
        }
        for (const ambulatoryId of parseAssignedAmbulatoryIds(patient.assignedAmbulatoryIds)) {
            if (!memberships.has(ambulatoryId)) memberships.set(ambulatoryId, normalizedAssignedAt);
        }
        if (typeof patient.ambulatoryId === 'string' && patient.ambulatoryId.trim().length > 0) {
            if (!memberships.has(patient.ambulatoryId)) memberships.set(patient.ambulatoryId, normalizedAssignedAt);
        }

        return Array.from(memberships, ([ambulatoryId, assignedAt]) => ({
            patientId,
            ambulatoryId,
            assignedAt,
        }));
    });
}
