/* @Codex */
import type { BackupArtifact } from './backup-artifact';

export type RestoredPatientAmbulatoryLink = {
    patientId: string;
    ambulatoryId: string;
    assignedAt: Date;
};

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
