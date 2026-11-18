import type { ClinicalEntry, Observation } from '@/lib/db';
import { classifyObservationRange, toNumericValue } from './observation-range';
import { recordDate } from './patient-therapy-changes';
import { formatMeasureValue, resolveStaticTerminology } from './terminology';

const diaryTypes = [
    ['phone', 'telefonata', 'telefonate'],
    ['remote', 'contatto remoto', 'contatti remoti'],
    ['access', 'accesso', 'accessi'],
    ['note', 'nota', 'note'],
    ['visit', 'visita', 'visite'],
    ['exam', 'esame', 'esami'],
    ['hospitalization', 'ricovero', 'ricoveri'],
    ['scale', 'scala', 'scale'],
] as const;

export function diaryTypeLabel(type: ClinicalEntry['type']) {
    const label = diaryTypes.find(([entryType]) => entryType === type)?.[1] ?? 'voce';
    return label.charAt(0).toUpperCase() + label.slice(1);
}

export function diaryContactsAfter(entries: readonly ClinicalEntry[], reference: Date) {
    const counts = new Map<ClinicalEntry['type'], number>();
    for (const entry of entries) {
        const date = recordDate(entry.createdAt);
        if (!entry.deletedAt && date && date > reference) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
    }
    return diaryTypes.flatMap(([type, singular, plural]) => {
        const count = counts.get(type);
        return count ? [`${count} ${count === 1 ? singular : plural}`] : [];
    });
}

export function outOfRangeAfter(observations: readonly Observation[], reference: Date, readAt: Date) {
    const live = observations.filter(item => !item.deletedAt);
    const series = new Map<string, Observation[]>();
    for (const observation of live) {
        const key = JSON.stringify([observation.codeSystem, observation.code, observation.unitSystem, observation.unitCode]);
        const values = series.get(key) ?? [];
        values.push(observation);
        series.set(key, values);
    }
    return [...series.values()].flatMap(rows => {
        rows.sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
        return rows.flatMap((observation, index) => {
            const date = recordDate(observation.createdAt);
            const observed = recordDate(observation.observedAt);
            const signal = classifyObservationRange(observation.value, observation.refLow, observation.refHigh);
            if (!date || date <= reference || date > readAt || !observed || !signal) return [];
            const previous = rows.slice(0, index).findLast(item => {
                const when = recordDate(item.observedAt);
                return when && when < observed && toNumericValue(item.value) !== null;
            });
            return [{
                id: observation.id,
                display: resolveStaticTerminology(observation.codeSystem, observation.code)?.displayIt ?? observation.display,
                date, observed, signal,
                value: formatMeasureValue(observation.value, observation.unitCode),
                low: toNumericValue(observation.refLow),
                high: toNumericValue(observation.refHigh),
                previous: previous ? { date: new Date(previous.observedAt), value: formatMeasureValue(previous.value, previous.unitCode) } : undefined,
            }];
        });
    });
}
