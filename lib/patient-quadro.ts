import type { Observation } from './db';
import { classifyObservationRange, toNumericValue } from './observation-range';
import { resolveStaticTerminology } from './terminology';

export function projectQuadroMeasures(observations: Observation[]) {
    const dated = observations.filter(item => !item.deletedAt).toSorted((left, right) =>
        new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime());
    return dated.map((item, index) => {
        const previous = dated.slice(index + 1).find(candidate =>
            candidate.codeSystem === item.codeSystem && candidate.code === item.code
            && candidate.unitSystem === item.unitSystem && candidate.unitCode === item.unitCode
            && new Date(candidate.observedAt).getTime() < new Date(item.observedAt).getTime());
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
