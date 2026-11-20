import type { Observation } from '@/lib/db';
import { toNumericValue } from '@/lib/observation-range';
import { observationSeriesKey } from '@/lib/patient-quadro';
import styles from './twin-synoptic-sheet.module.css';

const width = 64;
const height = 20;

export function measureSeries(observations: readonly Observation[], latestId: string) {
    const latest = observations.find(item => item.id === latestId);
    if (!latest) return [];
    const key = observationSeriesKey(latest);
    return observations.flatMap(item => {
        const time = new Date(item.observedAt).getTime();
        const value = toNumericValue(item.value);
        return !item.deletedAt && item.patientId === latest.patientId && observationSeriesKey(item) === key && Number.isFinite(time) && value !== null
            ? [{ time, value }] : [];
    }).toSorted((left, right) => left.time - right.time).slice(-8);
}

export function MeasureTrend({ series, critical }: { series: readonly { time: number; value: number }[]; critical: boolean }) {
    if (series.length < 2) return null;
    const values = series.map(point => point.value);
    const low = Math.min(...values);
    const span = Math.max(...values) - low || 1;
    const first = series[0].time;
    const range = series[series.length - 1].time - first || 1;
    const points = series.map(point => `${(((point.time - first) / range) * (width - 2) + 1).toFixed(1)},${(height - 2 - ((point.value - low) / span) * (height - 4)).toFixed(1)}`).join(' ');
    return <svg className={styles.trend} data-critical={critical ? 'true' : undefined} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        <polyline points={points} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
}
