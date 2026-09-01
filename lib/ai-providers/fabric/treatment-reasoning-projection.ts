/* @Codex */
import type { TreatmentReasoningContextInput } from '../../treatment-reasoning-context';
import { buildTreatmentReasoningContextBundle } from '../../treatment-reasoning-context';
import type { TreatmentReasoningEvidenceSourceKind } from '../../treatment-reasoning-contract';

export const TREATMENT_REASONING_PROJECTION_ATTACHMENT_SCHEMA = 'mediflow.ai.treatment-reasoning-projection-attachment.v1' as const;
export const TREATMENT_REASONING_PROJECTION_FRESHNESS_MS = 300_000;

export type TreatmentReasoningProjectionSource = Readonly<{
    id: string;
    sourceKind: TreatmentReasoningEvidenceSourceKind;
    label: string;
    excerpt: string | null;
    date: string | null;
}>;

export type TreatmentReasoningProjectionAttachment = Readonly<{
    schemaVersion: typeof TREATMENT_REASONING_PROJECTION_ATTACHMENT_SCHEMA;
    capability: 'treatment_reasoning';
    patientRevision: number;
    sourceRevision: string;
    capturedAt: string;
    therapyRefs: readonly string[];
    evidenceRefs: readonly string[];
    sources: readonly TreatmentReasoningProjectionSource[];
}>;

export type TreatmentReasoningProjectionErrorCode = 'projection_invalid' | 'projection_stale';

export class TreatmentReasoningProjectionError extends Error {
    constructor(readonly code: TreatmentReasoningProjectionErrorCode) {
        super(`Treatment reasoning projection rejected: ${code}`);
        this.name = 'TreatmentReasoningProjectionError';
    }
}

const ROOT_KEYS = ['schemaVersion', 'capability', 'patientRevision', 'sourceRevision', 'capturedAt', 'therapyRefs', 'evidenceRefs', 'sources'] as const;
const SOURCE_KEYS = ['id', 'sourceKind', 'label', 'excerpt', 'date'] as const;
const REFERENCE = /^[A-Za-z][A-Za-z0-9._:-]{2,159}$/u;
const SOURCE_KINDS = new Set<TreatmentReasoningEvidenceSourceKind>([
    'patient-profile', 'diagnosis', 'therapy', 'observation', 'clinical-entry',
    'document-insight', 'attachment-evidence',
]);
const SOURCE_QUOTAS: Readonly<Record<string, number>> = Object.freeze({
    'patient-profile': 1,
    diagnosis: 3,
    therapy: 4,
    observation: 3,
    'clinical-entry': 2,
    'document-insight': 2,
    'attachment-evidence': 1,
});
const MAX_SOURCES = 16;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function fail(code: TreatmentReasoningProjectionErrorCode): never {
    throw new TreatmentReasoningProjectionError(code);
}

function frozen<T extends Record<string, unknown>>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null) as T, value));
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
    try {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('projection_invalid');
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return fail('projection_invalid');
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length || !keys.every((key) => ownKeys.includes(key))) return fail('projection_invalid');
        const output: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fail('projection_invalid');
            output[key] = descriptor.value;
        }
        return output;
    } catch (error) {
        if (error instanceof TreatmentReasoningProjectionError) throw error;
        return fail('projection_invalid');
    }
}

function positive(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1) return fail('projection_invalid');
    return value as number;
}

function text(value: unknown, maximum: number, nullable = false): string | null {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || value.length === 0 || value.length > maximum || CONTROL.test(value)) return fail('projection_invalid');
    const normalized = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (normalized.length === 0 || normalized.length > maximum) return fail('projection_invalid');
    return normalized;
}

function reference(value: unknown): string {
    const normalized = text(value, 160) as string;
    return REFERENCE.test(normalized) ? normalized : fail('projection_invalid');
}

function timestamp(value: unknown, nullable = false): string | null {
    if (nullable && value === null) return null;
    const normalized = text(value, 32) as string;
    if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) return fail('projection_invalid');
    return normalized;
}

function list<T>(value: unknown, maximum: number, map: (item: unknown) => T, required = false): readonly T[] {
    try {
        if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
            || value.length > maximum || (required && value.length === 0)) return fail('projection_invalid');
        const keys = Reflect.ownKeys(value);
        if (keys.length !== value.length + 1 || !keys.includes('length')) return fail('projection_invalid');
        const output: T[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fail('projection_invalid');
            output.push(map(descriptor.value));
        }
        return Object.freeze(output);
    } catch (error) {
        if (error instanceof TreatmentReasoningProjectionError) throw error;
        return fail('projection_invalid');
    }
}

function selectBoundedSources(input: ReturnType<typeof buildTreatmentReasoningContextBundle>['sources']) {
    const counts = new Map<string, number>();
    const selected: typeof input[number][] = [];
    for (const source of input) {
        const quota = SOURCE_QUOTAS[source.sourceKind] ?? 0;
        const count = counts.get(source.sourceKind) ?? 0;
        if (count >= quota) continue;
        counts.set(source.sourceKind, count + 1);
        selected.push(source);
        if (selected.length === MAX_SOURCES) break;
    }
    return selected;
}

function sourceRevision(input: TreatmentReasoningContextInput, patientRevision: number, count: number): string {
    const records = [input.patient, ...(input.entries ?? []), ...(input.therapies ?? []), ...(input.observations ?? []), ...(input.attachments ?? [])];
    let newest = 0;
    for (const record of records) {
        for (const field of ['updatedAt', 'createdAt', 'date', 'observedAt'] as const) {
            const value = (record as unknown as Record<string, unknown>)[field];
            const time = value instanceof Date ? value.getTime() : typeof value === 'string' || typeof value === 'number' ? Date.parse(String(value)) : Number.NaN;
            if (Number.isFinite(time) && time > newest) newest = time;
        }
    }
    return `source_${patientRevision}_${count}_${newest}`;
}

export function buildTreatmentReasoningProjectionAttachment(input: TreatmentReasoningContextInput): TreatmentReasoningProjectionAttachment {
    const patientRevision = positive(input.patient.version);
    const now = input.now ?? new Date();
    const capturedAt = timestamp(now.toISOString()) as string;
    const bundle = buildTreatmentReasoningContextBundle({ ...input, now });
    const selected = selectBoundedSources(bundle.sources);
    if (selected.length === 0) return fail('projection_invalid');
    const sources = Object.freeze(selected.map((source) => frozen({
        id: reference(source.id),
        sourceKind: source.sourceKind,
        label: text(source.label, 180) as string,
        excerpt: source.excerpt ? text(source.excerpt, 480) : null,
        date: source.date ? timestamp(source.date) : null,
    }))) as readonly TreatmentReasoningProjectionSource[];
    const evidenceRefs = Object.freeze(sources.map(({ id }) => id));
    const therapyRefs = Object.freeze(sources.filter(({ sourceKind }) => sourceKind === 'therapy').map(({ id }) => id));
    return frozen({
        schemaVersion: TREATMENT_REASONING_PROJECTION_ATTACHMENT_SCHEMA,
        capability: 'treatment_reasoning' as const,
        patientRevision,
        sourceRevision: sourceRevision(input, patientRevision, sources.length),
        capturedAt,
        therapyRefs,
        evidenceRefs,
        sources,
    }) as TreatmentReasoningProjectionAttachment;
}

export function snapshotTreatmentReasoningProjectionAttachment(value: unknown, nowValue: string): TreatmentReasoningProjectionAttachment {
    try {
        const root = exact(value, ROOT_KEYS);
        if (root.schemaVersion !== TREATMENT_REASONING_PROJECTION_ATTACHMENT_SCHEMA || root.capability !== 'treatment_reasoning') return fail('projection_invalid');
        const now = timestamp(nowValue) as string;
        const capturedAt = timestamp(root.capturedAt) as string;
        const age = Date.parse(now) - Date.parse(capturedAt);
        if (age < 0 || age >= TREATMENT_REASONING_PROJECTION_FRESHNESS_MS) return fail('projection_stale');
        const sources = list(root.sources, MAX_SOURCES, (item): TreatmentReasoningProjectionSource => {
            const source = exact(item, SOURCE_KEYS);
            if (typeof source.sourceKind !== 'string' || !SOURCE_KINDS.has(source.sourceKind as TreatmentReasoningEvidenceSourceKind)) return fail('projection_invalid');
            return frozen({
                id: reference(source.id),
                sourceKind: source.sourceKind as TreatmentReasoningEvidenceSourceKind,
                label: text(source.label, 180) as string,
                excerpt: text(source.excerpt, 480, true),
                date: timestamp(source.date, true),
            }) as TreatmentReasoningProjectionSource;
        }, true);
        const evidenceRefs = list(root.evidenceRefs, MAX_SOURCES, reference, true);
        const therapyRefs = list(root.therapyRefs, MAX_SOURCES, reference);
        const expectedEvidence = sources.map(({ id }) => id);
        const expectedTherapies = sources.filter(({ sourceKind }) => sourceKind === 'therapy').map(({ id }) => id);
        if (new Set(evidenceRefs).size !== evidenceRefs.length || new Set(therapyRefs).size !== therapyRefs.length
            || evidenceRefs.length !== expectedEvidence.length || evidenceRefs.some((ref, index) => ref !== expectedEvidence[index])
            || therapyRefs.length !== expectedTherapies.length || therapyRefs.some((ref, index) => ref !== expectedTherapies[index])) return fail('projection_invalid');
        return frozen({
            schemaVersion: TREATMENT_REASONING_PROJECTION_ATTACHMENT_SCHEMA,
            capability: 'treatment_reasoning' as const,
            patientRevision: positive(root.patientRevision),
            sourceRevision: reference(root.sourceRevision),
            capturedAt,
            therapyRefs,
            evidenceRefs,
            sources,
        }) as TreatmentReasoningProjectionAttachment;
    } catch (error) {
        if (error instanceof TreatmentReasoningProjectionError) throw error;
        return fail('projection_invalid');
    }
}
