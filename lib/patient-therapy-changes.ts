import type { ClinicalEntry, Therapy } from '@/lib/db';

export function recordDate(value: Date | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

export function projectVisitReference(patientId: string, entries: readonly ClinicalEntry[], readAt: Date) {
    let latest: { id: string; date: Date; author?: string } | null = null;
    let undated = false;
    for (const entry of entries) {
        if (entry.patientId !== patientId || entry.type !== 'visit' || entry.deletedAt) continue;
        const date = recordDate(entry.createdAt);
        if (!date || date > readAt) {
            undated = true;
            continue;
        }
        if (!latest || date > latest.date) latest = { id: entry.id, date, author: entry.recordedBy?.trim() || undefined };
    }
    return { latest, undated };
}

export function projectTherapyRecordUpdates(patientId: string, therapies: readonly Therapy[], readAt: Date) {
    return therapies.flatMap(therapy => {
        if (therapy.patientId !== patientId || therapy.deletedAt) return [];
        const updated = recordDate(therapy.updatedAt);
        const changed = (therapy.version ?? 1) > 1;
        const date = therapy.status !== 'active' || changed ? updated : recordDate(therapy.createdAt);
        if (!date || date > readAt) return [];
        const label = therapy.status === 'suspended' ? 'Sospesa' : therapy.status === 'completed' ? 'Conclusa' : changed ? 'Aggiornata' : 'Avviata';
        return [{ therapy, date, label }];
    }).sort((a, b) => b.date.getTime() - a.date.getTime());
}
