import type { ClinicalEntry, Therapy } from '@/lib/db';
import { patientDiaryWorkflowState } from './patient-diary-metadata';

export type DatedTherapyChange = {
    therapyId: string;
    drugName: string;
    kind: 'start' | 'end';
    date: Date;
};

function validDate(value: Date | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

export function projectTherapyDatesSinceVisit(
    patientId: string,
    entries: readonly ClinicalEntry[],
    therapies: readonly Therapy[],
    now: Date,
) {
    let visitDate: Date | null = null;
    for (const entry of entries) {
        if (entry.patientId !== patientId || entry.type !== 'visit' || entry.deletedAt) continue;
        const state = patientDiaryWorkflowState(entry.metadata);
        if (state !== 'recorded' && state !== 'signed') continue;
        const date = validDate(entry.date);
        if (date && date <= now && (!visitDate || date > visitDate)) visitDate = date;
    }

    if (!visitDate) return null;
    const visitDayEnd = new Date(visitDate);
    visitDayEnd.setHours(23, 59, 59, 999);

    const changes = therapies.flatMap((therapy): DatedTherapyChange[] => {
        if (therapy.patientId !== patientId || therapy.deletedAt) return [];
        const start = validDate(therapy.startDate);
        const end = therapy.status === 'completed' ? validDate(therapy.endDate) : null;
        const row = { therapyId: therapy.id, drugName: therapy.drugName };
        return [
            ...(start && start > visitDayEnd && start <= now ? [{ ...row, kind: 'start' as const, date: start }] : []),
            ...(end && end > visitDayEnd && end <= now ? [{ ...row, kind: 'end' as const, date: end }] : []),
        ];
    }).sort((left, right) => right.date.getTime() - left.date.getTime());

    return { visitDate, changes };
}
