import type { Therapy } from '@/lib/db';

export type TherapyChangeKind = 'started' | 'updated' | 'suspended' | 'completed';

export interface TherapyChange {
    id: string;
    drugName: string;
    kind: TherapyChangeKind;
    date: Date;
}

export const THERAPY_CHANGE_LABELS: Record<TherapyChangeKind, string> = {
    started: 'Avviata',
    updated: 'Aggiornata',
    suspended: 'Sospesa',
    completed: 'Conclusa',
};

function validDate(value: Date | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function lastRecordedChange(therapy: Therapy): { kind: TherapyChangeKind; date: Date | null } {
    const recorded = validDate(therapy.updatedAt) ?? validDate(therapy.createdAt);
    if (therapy.status === 'completed') return { kind: 'completed', date: validDate(therapy.endDate) ?? recorded };
    if (therapy.status === 'suspended') return { kind: 'suspended', date: recorded };
    if ((therapy.version ?? 1) > 1 && validDate(therapy.updatedAt)) return { kind: 'updated', date: validDate(therapy.updatedAt) };
    return { kind: 'started', date: validDate(therapy.startDate) };
}

export function projectLastRecordedTherapyChanges(therapies: readonly Therapy[], limit = 4): TherapyChange[] {
    return therapies
        .filter((therapy) => !therapy.deletedAt)
        .flatMap((therapy) => {
            const { kind, date } = lastRecordedChange(therapy);
            return date ? [{ id: therapy.id, drugName: therapy.drugName, kind, date }] : [];
        })
        .sort((left, right) => right.date.getTime() - left.date.getTime())
        .slice(0, limit);
}
