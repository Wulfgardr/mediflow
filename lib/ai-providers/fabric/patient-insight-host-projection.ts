/* @Codex */
import 'server-only';

import { types } from 'node:util';

import type { PatientInsightProjection } from './patient-insight-host-boundary';

export type PatientInsightCanonicalHostSources = Readonly<{
    focus: Readonly<{ summary: string }>;
    conditions: readonly Readonly<{ label: string }>[];
    activeTherapies: readonly Readonly<{ label: string }>[];
    recentEvents: readonly Readonly<{ summary: string }>[];
}>;

export type PatientInsightHostProjectionResolver = Readonly<{
    resolve(value: unknown): PatientInsightProjection | null;
}>;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor)) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= 240 && value.trim() === value ? value : null;
}

function labels(value: unknown, key: 'label' | 'summary'): readonly string[] | null {
    try {
        if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 12
            || Reflect.ownKeys(value).length !== value.length + 1) return null;
        const output: string[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            const item = descriptor && 'value' in descriptor ? record(descriptor.value, [key]) : null;
            const label = item && text(item[key]);
            if (!label) return null;
            output.push(label);
        }
        return Object.freeze(output);
    } catch { return null; }
}

function projection(value: unknown): PatientInsightProjection | null {
    const input = record(value, ['focus', 'conditions', 'activeTherapies', 'recentEvents']);
    const focus = input && record(input.focus, ['summary']);
    const clinicalFocus = focus && text(focus.summary);
    const activeConditions = input && labels(input.conditions, 'label');
    const currentTherapies = input && labels(input.activeTherapies, 'label');
    const recentClinicalEvents = input && labels(input.recentEvents, 'summary');
    if (!input || !clinicalFocus || !activeConditions || !currentTherapies || !recentClinicalEvents) return null;
    return Object.freeze({
        schemaVersion: 'mediflow.patient-insight.projection.v1',
        clinicalFocus,
        activeConditions,
        currentTherapies,
        recentClinicalEvents,
    });
}

/** Maps only canonical, host-resolved clinical source fields to the accepted projection. */
export function createPatientInsightHostProjectionResolver(): PatientInsightHostProjectionResolver {
    return Object.freeze({ resolve: projection });
}
