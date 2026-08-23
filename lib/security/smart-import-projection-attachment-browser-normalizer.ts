/* @Codex */
'use client';

import { snapshotSmartImportProjectionAttachment, type SmartImportProjectionAttachment } from '../smart-import-projection';

type Kind = 'patient-notes' | 'clinical-entry' | 'document-insight' | 'attachment-summary';
type Source = Readonly<{ kind: Kind; originKey: string; label: string; date: string | null; content: string }>;
type Hint = Readonly<{ kind: Kind; originKey: string; label: string; excerpt: string }>;
type Sources = Readonly<{ clock?: () => Date }>;
const KINDS: readonly Kind[] = ['patient-notes', 'clinical-entry', 'document-insight', 'attachment-summary'];

export type SmartImportProjectionAttachmentBrowserNormalizerErrorCode = 'capture_invalid' | 'confirmation_required';
export class SmartImportProjectionAttachmentBrowserNormalizerError extends Error {
    constructor(readonly code: SmartImportProjectionAttachmentBrowserNormalizerErrorCode) {
        super('Smart Import projection capture rejected.'); this.name = 'SmartImportProjectionAttachmentBrowserNormalizerError';
    }
}
function fail(code: SmartImportProjectionAttachmentBrowserNormalizerErrorCode = 'capture_invalid'): never { throw new SmartImportProjectionAttachmentBrowserNormalizerError(code); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return fail();
    const own = Reflect.ownKeys(value); if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return fail();
    const result: Record<string, unknown> = {};
    for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor)) return fail(); result[key] = descriptor.value; }
    return result;
}
function values(value: unknown, max: number): unknown[] {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) return fail();
    const own = Reflect.ownKeys(value); if (own.length !== value.length + 1 || own.some((key) => key !== 'length' && !/^\d+$/u.test(String(key)))) return fail();
    return value.map((_, index) => { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); return descriptor && 'value' in descriptor ? descriptor.value : fail(); });
}
function text(value: unknown, max: number, nullable = false): string | null {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || value.trim().length < 1 || value.length > max || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return fail();
    return value;
}
function iso(value: unknown, nullable = false): string | null {
    const result = text(value, 32, nullable); if (result === null) return null;
    return Number.isFinite(Date.parse(result)) && new Date(result).toISOString() === result ? result : fail();
}
function kind(value: unknown): Kind { return typeof value === 'string' && KINDS.includes(value as Kind) ? value as Kind : fail(); }
function origin(value: unknown): string { const result = text(value, 160) as string; return /^[A-Za-z][A-Za-z0-9._:-]{0,159}$/u.test(result) ? result : fail(); }
function source(value: unknown): Source {
    const item = exact(value, ['kind', 'originKey', 'label', 'date', 'content']);
    return Object.freeze({ kind: kind(item.kind), originKey: origin(item.originKey), label: text(item.label, 160) as string, date: iso(item.date, true), content: text(item.content, 900) as string });
}
function hint(value: unknown): Hint {
    const item = exact(value, ['kind', 'originKey', 'label', 'excerpt']);
    return Object.freeze({ kind: kind(item.kind), originKey: origin(item.originKey), label: text(item.label, 160) as string, excerpt: text(item.excerpt, 600) as string });
}
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/* @Codex */
export function createSmartImportProjectionAttachmentBrowserNormalizer(sources: Sources = {}) {
    let nextSourceRevision = 1;
    return Object.freeze({
        capture(value: unknown, confirmed: true): SmartImportProjectionAttachment {
            if (confirmed !== true) return fail('confirmation_required');
            try {
                const root = exact(value, ['patient', 'currentDiagnoses', 'currentActiveTherapies', 'sources', 'therapyCandidateHints']);
                const patient = exact(root.patient, ['version']);
                if (!Number.isSafeInteger(patient.version) || (patient.version as number) < 1) return fail();
                const patientRevision = patient.version as number;
                const copiedSources = values(root.sources, 32).map(source); const copiedHints = values(root.therapyCandidateHints, 32).map(hint);
                const byOrigin = new Map<string, Source>();
                for (const candidate of copiedSources) {
                    const key = `${candidate.kind}\u0000${candidate.originKey}`; const prior = byOrigin.get(key);
                    if (prior && (prior.label !== candidate.label || prior.date !== candidate.date || prior.content !== candidate.content)) return fail();
                    byOrigin.set(key, candidate);
                }
                const normalizedSources = [...byOrigin.values()].sort((left, right) => KINDS.indexOf(left.kind) - KINDS.indexOf(right.kind)
                    || (left.date === right.date ? 0 : left.date === null ? 1 : right.date === null ? -1 : compare(right.date, left.date)) || compare(left.originKey, right.originKey));
                if (normalizedSources.length < 1 || normalizedSources.length > 32) return fail();
                const capturedAt = (sources.clock?.() ?? new Date()).toISOString();
                const sourceIds = new Map<string, string>();
                const ids = normalizedSources.map((candidate, index) => {
                    const id = `source.local.${nextSourceRevision.toString(36).padStart(11, '0')}.${(index + 1).toString(36).padStart(2, '0')}`;
                    sourceIds.set(`${candidate.kind}\u0000${candidate.originKey}`, id); return { id, kind: candidate.kind, label: candidate.label, date: candidate.date, content: candidate.content };
                });
                const dedupHints = new Map<string, { sourceId: string; label: string; excerpt: string }>();
                for (const candidate of copiedHints) {
                    const sourceId = sourceIds.get(`${candidate.kind}\u0000${candidate.originKey}`); if (!sourceId) return fail();
                    dedupHints.set(`${sourceId}\u0000${candidate.label}\u0000${candidate.excerpt}`, { sourceId, label: candidate.label, excerpt: candidate.excerpt });
                }
                const hints = [...dedupHints.values()].sort((left, right) => compare(left.sourceId, right.sourceId) || compare(left.label, right.label) || compare(left.excerpt, right.excerpt));
                if (hints.length > 32 || exact(root.patient, ['version']).version !== patientRevision) return fail();
                const draft = snapshotSmartImportProjectionAttachment({ schemaVersion: 'mediflow.smart-import.projection-attachment.v1', capability: 'smart_import', patientRevision,
                    sourceRevision: 1, capturedAt, currentDiagnoses: root.currentDiagnoses, currentActiveTherapies: root.currentActiveTherapies, therapyCandidateHints: hints, sources: ids }, capturedAt);
                if (exact(root.patient, ['version']).version !== patientRevision || nextSourceRevision >= Number.MAX_SAFE_INTEGER) return fail();
                const sourceRevision = nextSourceRevision; nextSourceRevision += 1;
                /** sourceRevision is a browser-adapter-local ordinal, not canonical revision, content, freshness, order, deduplication, cache, or authority. */
                return Object.freeze({ ...draft, sourceRevision });
            } catch (error) { if (error instanceof SmartImportProjectionAttachmentBrowserNormalizerError) throw error; return fail(); }
        },
    });
}
