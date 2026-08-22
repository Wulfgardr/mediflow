/* @Codex */
export type SmartImportProjectionErrorCode = 'projection_invalid' | 'projection_stale';

export class SmartImportProjectionError extends Error {
    constructor(readonly code: SmartImportProjectionErrorCode) {
        super(`Smart Import projection rejected: ${code}`);
        this.name = 'SmartImportProjectionError';
    }
}

type Diagnosis = Readonly<{ system: string; code: string; description: string }>;
type ActiveTherapy = Readonly<{
    drugName: string;
    activePrinciple: string | null;
    dosage: string | null;
    aic: string | null;
    atc: string | null;
}>;
type TherapyCandidateHint = Readonly<{ sourceId: string; label: string; excerpt: string }>;
export type SmartImportProjectionSource = Readonly<{
    id: string;
    kind: 'patient-notes' | 'clinical-entry' | 'document-insight' | 'attachment-summary';
    label: string;
    date: string | null;
    content: string;
}>;
export type SmartImportProjection = Readonly<{
    schemaVersion: 'mediflow.smart-import.projection.v1';
    capability: 'smart_import';
    patientRef: string;
    selectionEpoch: number;
    patientRevision: number;
    sourceRevision: number;
    capturedAt: string;
    currentDiagnoses: ReadonlyArray<Diagnosis>;
    currentActiveTherapies: ReadonlyArray<ActiveTherapy>;
    therapyCandidateHints: ReadonlyArray<TherapyCandidateHint>;
    sources: ReadonlyArray<SmartImportProjectionSource>;
}>;

function fail(code: SmartImportProjectionErrorCode): never { throw new SmartImportProjectionError(code); }
function exact(value: unknown, keys: readonly string[]) {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('projection_invalid');
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) fail('projection_invalid');
    const record: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor)) fail('projection_invalid');
        record[key] = descriptor.value;
    }
    return record;
}
function text(value: unknown, max: number, nullable = false): string | null {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || value.trim().length < 1 || value.length > max || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('projection_invalid');
    return value;
}
function opaque(value: unknown) {
    const ref = text(value, 160) as string;
    if (!/^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u.test(ref)) fail('projection_invalid');
    return ref;
}
function positive(value: unknown) {
    if (!Number.isSafeInteger(value) || (value as number) < 1) fail('projection_invalid');
    return value as number;
}
function iso(value: unknown, nullable = false): string | null {
    if (nullable && value === null) return null;
    const timestamp = text(value, 32) as string;
    if (!Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) fail('projection_invalid');
    return timestamp;
}
function list<T>(value: unknown, max: number, snapshot: (entry: unknown) => T): ReadonlyArray<T> {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) fail('projection_invalid');
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1 || ownKeys.some((key) => key !== 'length' && !/^\d+$/u.test(String(key)))) fail('projection_invalid');
    const output: T[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor)) fail('projection_invalid');
        output.push(snapshot(descriptor.value));
    }
    return Object.freeze(output);
}

function snapshot(value: unknown, now: string): SmartImportProjection {
    const root = exact(value, ['schemaVersion', 'capability', 'patientRef', 'selectionEpoch', 'patientRevision', 'sourceRevision', 'capturedAt',
        'currentDiagnoses', 'currentActiveTherapies', 'therapyCandidateHints', 'sources']);
    if (root.schemaVersion !== 'mediflow.smart-import.projection.v1' || root.capability !== 'smart_import') fail('projection_invalid');
    const capturedAt = iso(root.capturedAt) as string;
    const nowMs = Date.parse(iso(now) as string); const capturedMs = Date.parse(capturedAt);
    if (capturedMs > nowMs || nowMs - capturedMs > 300_000) fail('projection_stale');
    const currentDiagnoses = list(root.currentDiagnoses, 64, (entry) => {
        const item = exact(entry, ['system', 'code', 'description']);
        return Object.freeze({ system: text(item.system, 64) as string, code: text(item.code, 64) as string, description: text(item.description, 320) as string });
    });
    const currentActiveTherapies = list(root.currentActiveTherapies, 64, (entry) => {
        const item = exact(entry, ['drugName', 'activePrinciple', 'dosage', 'aic', 'atc']);
        return Object.freeze({ drugName: text(item.drugName, 160) as string, activePrinciple: text(item.activePrinciple, 160, true),
            dosage: text(item.dosage, 160, true), aic: text(item.aic, 32, true), atc: text(item.atc, 32, true) });
    });
    const therapyCandidateHints = list(root.therapyCandidateHints, 32, (entry) => {
        const item = exact(entry, ['sourceId', 'label', 'excerpt']);
        return Object.freeze({ sourceId: opaque(item.sourceId), label: text(item.label, 160) as string, excerpt: text(item.excerpt, 600) as string });
    });
    const kinds = ['patient-notes', 'clinical-entry', 'document-insight', 'attachment-summary'];
    const sources = list(root.sources, 32, (entry) => {
        const item = exact(entry, ['id', 'kind', 'label', 'date', 'content']);
        if (typeof item.kind !== 'string' || !kinds.includes(item.kind)) fail('projection_invalid');
        return Object.freeze({ id: opaque(item.id), kind: item.kind as SmartImportProjectionSource['kind'], label: text(item.label, 160) as string,
            date: iso(item.date, true), content: text(item.content, 900) as string });
    });
    if (sources.length === 0) fail('projection_invalid');
    const sourceIds = new Set(sources.map(({ id }) => id));
    if (sourceIds.size !== sources.length || therapyCandidateHints.some(({ sourceId }) => !sourceIds.has(sourceId))) fail('projection_invalid');
    return Object.freeze({ schemaVersion: 'mediflow.smart-import.projection.v1', capability: 'smart_import', patientRef: opaque(root.patientRef),
        selectionEpoch: positive(root.selectionEpoch), patientRevision: positive(root.patientRevision), sourceRevision: positive(root.sourceRevision), capturedAt,
        currentDiagnoses, currentActiveTherapies, therapyCandidateHints, sources });
}

export function snapshotSmartImportProjection(value: unknown, now: string): SmartImportProjection {
    try { return snapshot(value, now); } catch (error) {
        if (error instanceof SmartImportProjectionError) throw error;
        return fail('projection_invalid');
    }
}
