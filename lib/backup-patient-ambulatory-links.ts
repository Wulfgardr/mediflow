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
        const ambulatoryIds = new Set(parseAssignedAmbulatoryIds(patient.assignedAmbulatoryIds));
        if (typeof patient.ambulatoryId === 'string' && patient.ambulatoryId.trim().length > 0) {
            ambulatoryIds.add(patient.ambulatoryId);
        }

        return Array.from(ambulatoryIds).map((ambulatoryId) => ({
            patientId,
            ambulatoryId,
            assignedAt: normalizedAssignedAt,
        }));
    });
}
