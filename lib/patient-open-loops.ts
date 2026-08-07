/* @Codex */

import { resolveStaticTerminology } from './terminology';

export const RESULTS_PENDING_AFTER_DAYS = 14;
export const MIN_POINTS = 3;
export const STALL_FACTOR = 1.5;
/* Intervalli sotto un giorno non descrivono una cadenza osservativa. */
export const MIN_TYPICAL_INTERVAL_DAYS = 1;
export const MAX_TYPICAL_INTERVAL_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

export type OpenLoopStatus = {
    sinceDate: Date;
    elapsedDays: number;
    typicalIntervalDays?: number;
};

export type ResultsPendingOpenLoop = {
    kind: 'results_pending';
    patientId: string;
    label: string;
    status: OpenLoopStatus;
    sourceRef: {
        type: 'service_prescription_item';
        id: string;
        prescriptionId: string;
        serviceName: string;
        code?: never;
        codeSystem?: never;
    };
    suggestedAction: 'insert_results';
};

export type SeriesStalledOpenLoop = {
    kind: 'series_stalled';
    patientId: string;
    label: string;
    status: OpenLoopStatus & { typicalIntervalDays: number };
    sourceRef: {
        type: 'observation_series';
        code: string;
        codeSystem: string;
        id?: never;
        prescriptionId?: never;
        serviceName?: never;
    };
    suggestedAction: 'insert_measurement';
};

export type OpenLoop = ResultsPendingOpenLoop | SeriesStalledOpenLoop;

export type OpenLoopGroup = {
    prescriptionId: string;
    prescribedAt: Date;
    loops: ResultsPendingOpenLoop[];
};

export type OpenLoopProjection = {
    groups: OpenLoopGroup[];
    standaloneLoops: OpenLoop[];
};

export type OpenLoopServicePrescriptionItem = {
    id: string;
    patientId: string;
    prescriptionId: string;
    status: string;
    codeSystem?: string;
    serviceCode?: string;
    scheduledAt?: Date | string | null;
    reportReceivedAt?: Date | string | null;
    createdAt?: Date | string | null;
    serviceName: string;
};

export type OpenLoopServicePrescription = {
    id: string;
    prescribedAt: Date | string;
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
        const elapsedDays = Math.floor((input.now.getTime() - referenceDate.getTime()) / DAY_MS);
        if (elapsedDays < RESULTS_PENDING_AFTER_DAYS) continue;
        const terminology = item.codeSystem?.trim().toUpperCase() === 'LOINC' && item.serviceCode
            ? resolveStaticTerminology('LOINC', item.serviceCode)
            : null;
        const serviceName = terminology?.displayIt ?? terminology?.display ?? item.serviceName;

        loops.push({
            kind: 'results_pending',
            patientId: item.patientId,
            label: serviceName,
            status: { sinceDate: referenceDate, elapsedDays },
            sourceRef: {
                type: 'service_prescription_item',
                id: item.id,
                prescriptionId: item.prescriptionId,
                serviceName,
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
            label: latest.display,
            status: {
                sinceDate: latest.observedDate,
                elapsedDays: Math.floor(elapsedDays),
                typicalIntervalDays,
            },
            sourceRef: {
                type: 'observation_series',
                codeSystem: latest.codeSystem,
                code: latest.code,
            },
            suggestedAction: 'insert_measurement',
        });
    }

    return loops.sort((left, right) => left.status.sinceDate.getTime() - right.status.sinceDate.getTime());
}

/** Raggruppa le attese per il contenitore prescrizione senza mutare i record. */
export function deriveOpenLoopProjection(input: {
    items: OpenLoopServicePrescriptionItem[];
    prescriptions: OpenLoopServicePrescription[];
    observations: OpenLoopObservation[];
    now: Date;
}): OpenLoopProjection {
    const loops = deriveOpenLoops(input);
    const pendingByPrescription = new Map<string, ResultsPendingOpenLoop[]>();
    const standaloneLoops: OpenLoop[] = [];

    for (const loop of loops) {
        if (loop.kind === 'series_stalled') {
            standaloneLoops.push(loop);
            continue;
        }
        const groupLoops = pendingByPrescription.get(loop.sourceRef.prescriptionId) ?? [];
        groupLoops.push(loop);
        pendingByPrescription.set(loop.sourceRef.prescriptionId, groupLoops);
    }

    const groups = input.prescriptions
        .map((prescription): OpenLoopGroup | null => {
            const prescribedAt = validDate(prescription.prescribedAt);
            const groupLoops = pendingByPrescription.get(prescription.id);
            if (!prescribedAt || !groupLoops?.length) return null;
            pendingByPrescription.delete(prescription.id);
            return { prescriptionId: prescription.id, prescribedAt, loops: groupLoops };
        })
        .filter((group): group is OpenLoopGroup => group !== null)
        .sort((left, right) => left.prescribedAt.getTime() - right.prescribedAt.getTime());

    for (const orphanedLoops of pendingByPrescription.values()) {
        standaloneLoops.push(...orphanedLoops);
    }

    return { groups, standaloneLoops };
}
