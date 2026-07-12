/* @Codex */

export const RESULTS_PENDING_AFTER_DAYS = 14;
export const MIN_POINTS = 3;
export const STALL_FACTOR = 1.5;
/* Intervalli sotto un giorno non descrivono una cadenza osservativa. */
export const MIN_TYPICAL_INTERVAL_DAYS = 1;
export const MAX_TYPICAL_INTERVAL_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

export type OpenLoop = {
    kind: 'results_pending' | 'series_stalled';
    patientId: string;
    label: string;
    sinceDate: Date;
    sourceRef: {
        type: 'service_prescription_item' | 'observation_series';
        id?: string;
        code?: string;
        codeSystem?: string;
        serviceName?: string;
    };
    suggestedAction: 'insert_results' | 'insert_measurement';
};

export type OpenLoopServicePrescriptionItem = {
    id: string;
    patientId: string;
    status: string;
    scheduledAt?: Date | string | null;
    reportReceivedAt?: Date | string | null;
    createdAt?: Date | string | null;
    serviceName: string;
};

export type OpenLoopObservation = {
    patientId: string;
    codeSystem: string;
    code: string;
    display: string;
    observedAt: Date | string;
    deletedAt?: Date | string | null;
    servicePrescriptionItemId?: string | null;
};

function validDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function dateLabel(date: Date): string {
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

function median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

/* @Codex Una giornata clinica contribuisce una sola volta alla cadenza. */
function utcDayIndex(date: Date): number {
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS);
}

/**
 * Proietta attese locali dai record gia presenti. Le soglie descrivono solo il
 * calendario dei record, non una priorita o raccomandazione clinica.
 */
export function deriveOpenLoops(input: {
    items: OpenLoopServicePrescriptionItem[];
    observations: OpenLoopObservation[];
    now: Date;
}): OpenLoop[] {
    const linkedItemIds = new Set(
        input.observations
            .filter((observation) => !observation.deletedAt)
            .map((observation) => observation.servicePrescriptionItemId)
            .filter((itemId): itemId is string => typeof itemId === 'string' && itemId.length > 0),
    );
    const loops: OpenLoop[] = [];

    for (const item of input.items) {
        if (item.status !== 'prescribed' && item.status !== 'performed') continue;
        if (validDate(item.reportReceivedAt) || linkedItemIds.has(item.id)) continue;
        const referenceDate = validDate(item.scheduledAt) ?? validDate(item.createdAt);
        if (!referenceDate) continue;
        const sinceDate = new Date(referenceDate.getTime() + RESULTS_PENDING_AFTER_DAYS * DAY_MS);
        if (input.now.getTime() < sinceDate.getTime()) continue;

        loops.push({
            kind: 'results_pending',
            patientId: item.patientId,
            label: `Nessun risultato collegato dal ${dateLabel(referenceDate)}`,
            sinceDate,
            sourceRef: {
                type: 'service_prescription_item',
                id: item.id,
                serviceName: item.serviceName,
            },
            suggestedAction: 'insert_results',
        });
    }

    const observationsBySeries = new Map<string, Array<OpenLoopObservation & { observedDate: Date }>>();
    for (const observation of input.observations) {
        if (observation.deletedAt) continue;
        const observedDate = validDate(observation.observedAt);
        if (!observedDate) continue;
        const key = `${observation.codeSystem}\u0000${observation.code}`;
        const series = observationsBySeries.get(key) ?? [];
        series.push({ ...observation, observedDate });
        observationsBySeries.set(key, series);
    }

    for (const series of observationsBySeries.values()) {
        const chronological = [...series].sort((left, right) => left.observedDate.getTime() - right.observedDate.getTime());
        const observationsByDay = new Map<number, OpenLoopObservation & { observedDate: Date }>();
        for (const observation of chronological) {
            observationsByDay.set(utcDayIndex(observation.observedDate), observation);
        }
        const distinctDates = [...observationsByDay.entries()].sort(([left], [right]) => left - right);
        if (distinctDates.length < MIN_POINTS) continue;
        const intervals = distinctDates
            .slice(1)
            .map(([day], index) => day - distinctDates[index][0])
            .filter((interval) => interval > 0);
        if (intervals.length < MIN_POINTS - 1) continue;
        const typicalIntervalDays = median(intervals);
        if (typicalIntervalDays < MIN_TYPICAL_INTERVAL_DAYS || typicalIntervalDays > MAX_TYPICAL_INTERVAL_DAYS) continue;

        const latest = distinctDates[distinctDates.length - 1][1];
        const thresholdDays = typicalIntervalDays * STALL_FACTOR;
        const elapsedDays = (input.now.getTime() - latest.observedDate.getTime()) / DAY_MS;
        if (elapsedDays <= thresholdDays) continue;

        loops.push({
            kind: 'series_stalled',
            patientId: latest.patientId,
            label: `${latest.display}: ultima misura il ${dateLabel(latest.observedDate)}, intervallo tipico ~${Math.round(typicalIntervalDays)} giorni`,
            sinceDate: new Date(latest.observedDate.getTime() + thresholdDays * DAY_MS),
            sourceRef: {
                type: 'observation_series',
                codeSystem: latest.codeSystem,
                code: latest.code,
            },
            suggestedAction: 'insert_measurement',
        });
    }

    return loops.sort((left, right) => left.sinceDate.getTime() - right.sinceDate.getTime());
}
