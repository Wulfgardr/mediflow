/* @Codex */
export type CheckupAgendaStatus =
    | 'overdue'
    | 'today'
    | 'upcoming'
    | 'completed'
    | 'cancelled';

/* @Codex */
export interface CheckupAgendaInput {
    date: Date | string | number;
    status?: 'pending' | 'completed' | 'cancelled' | string | null;
}

const STATUS_PRIORITY: Record<CheckupAgendaStatus, number> = {
    overdue: 0,
    today: 1,
    upcoming: 2,
    completed: 3,
    cancelled: 4,
};

function startOfLocalDay(reference: Date): Date {
    const copy = new Date(reference);
    copy.setHours(0, 0, 0, 0);
    return copy;
}

/* @Codex */
export function classifyCheckupAgendaStatus(
    checkup: CheckupAgendaInput,
    now: Date,
): CheckupAgendaStatus {
    if (checkup.status === 'completed') return 'completed';
    if (checkup.status === 'cancelled') return 'cancelled';

    const date = checkup.date instanceof Date ? checkup.date : new Date(checkup.date);
    if (Number.isNaN(date.getTime())) return 'upcoming';

    const startOfToday = startOfLocalDay(now);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    if (date.getTime() < startOfToday.getTime()) return 'overdue';
    if (date.getTime() < startOfTomorrow.getTime()) return 'today';
    return 'upcoming';
}

/* @Codex */
export function sortCheckupAgenda<T extends CheckupAgendaInput>(
    items: readonly T[],
    now: Date,
): T[] {
    return [...items].sort((left, right) => {
        const leftStatus = classifyCheckupAgendaStatus(left, now);
        const rightStatus = classifyCheckupAgendaStatus(right, now);
        const priorityDelta = STATUS_PRIORITY[leftStatus] - STATUS_PRIORITY[rightStatus];
        if (priorityDelta !== 0) return priorityDelta;
        const leftTime = new Date(left.date).getTime() || 0;
        const rightTime = new Date(right.date).getTime() || 0;
        return leftTime - rightTime;
    });
}

/* @Codex */
export function filterCheckupAgendaByStatus<T extends CheckupAgendaInput>(
    items: readonly T[],
    allowed: ReadonlySet<CheckupAgendaStatus>,
    now: Date,
): T[] {
    return items.filter((item) => allowed.has(classifyCheckupAgendaStatus(item, now)));
}
