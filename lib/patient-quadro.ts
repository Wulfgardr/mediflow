import type { Observation } from './db';
import { classifyObservationRange, toNumericValue } from './observation-range';
import { resolveStaticTerminology } from './terminology';

export function projectQuadroMeasures(observations: Observation[]) {
    const parameters = new Map<string, { latest: Observation; previous?: Observation }>();
    for (const item of observations) {
        if (item.deletedAt) continue;
        const key = JSON.stringify([item.codeSystem, item.code, item.unitSystem, item.unitCode]);
        const parameter = parameters.get(key);
        if (!parameter) {
            parameters.set(key, { latest: item });
            continue;
        }
        const time = new Date(item.observedAt).getTime();
        const latestTime = new Date(parameter.latest.observedAt).getTime();
        if (time > latestTime) {
            parameter.previous = parameter.latest;
            parameter.latest = item;
        } else if (time < latestTime && (!parameter.previous || time > new Date(parameter.previous.observedAt).getTime())) {
            parameter.previous = item;
        }
    }
    return [...parameters.values()].toSorted((left, right) =>
        new Date(right.latest.observedAt).getTime() - new Date(left.latest.observedAt).getTime())
        .map(({ latest: item, previous }) => {
            const value = toNumericValue(item.value);
            const previousValue = previous ? toNumericValue(previous.value) : null;
            const difference = value !== null && previousValue !== null ? Math.round((value - previousValue) * 100) / 100 : null;
            return {
                id: item.id,
                display: resolveStaticTerminology('LOINC', item.code)?.displayIt ?? item.display,
                valueLabel: `${item.value}${item.unitCode ? ` ${item.unitCode}` : ''}`,
                date: item.observedAt,
                delta: difference !== null && previous ? `${difference > 0 ? '+' : ''}${String(difference).replace('.', ',')} ${item.unitCode} dal ${new Date(previous.observedAt).toLocaleDateString('it-IT')}`.trim() : undefined,
                outOfRange: classifyObservationRange(item.value, item.refLow, item.refHigh),
            };
        });
}
