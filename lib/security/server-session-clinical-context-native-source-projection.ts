/* @Codex — pure minimization of host rows; not an ingress or authority issuer. */
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { clinicalRichTextToPlainText } from '../clinical-rich-text';
import { parsePatientInsightPreviewRequest, type PatientInsightPreviewRequest } from '../ai-providers/fabric/patient-insight-preview-contract';
import { snapshotSmartImportProjectionAttachment, type SmartImportProjectionAttachment } from '../smart-import-projection';
import { snapshotTreatmentReasoningProjectionAttachment, type TreatmentReasoningProjectionAttachment } from '../ai-providers/fabric/treatment-reasoning-projection';
import { ProductError } from '../chatgpt-product/product-contract';
import type { NativeOrdinarySourceRows, NativeChartFunction } from './server-session-clinical-context-native-source-rows';
export type NativeOrdinaryHostValue =
    | Readonly<{ functionId: 'patient_insight'; input: PatientInsightPreviewRequest }>
    | Readonly<{ functionId: 'smart_import'; input: SmartImportProjectionAttachment }>
    | Readonly<{ functionId: 'treatment_reasoning'; input: TreatmentReasoningProjectionAttachment }>;
const fail = (): never => { throw new ProductError('invalid_state'); };
function text(value: unknown, maximum: number): string | null {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || value.trimStart().startsWith('ENC:') || value.length > 262144) return fail();
    const normalized = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (/[\x00-\x1f\x7f]/u.test(normalized)) return fail();
    // Avoid splitting a UTF-16 surrogate pair at the canonical parser's limit.
    let bounded = normalized.slice(0, maximum);
    if (/[\uD800-\uDBFF]$/u.test(bounded)) bounded = bounded.slice(0, -1);
    return bounded || null;
}
function date(value: Date | null): string | null {
    if (value === null) return null;
    return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : fail();
}
function diagnoses(value: string | null): Array<{ system: string | null; code: string | null; description: string }> {
    if (value == null || value === '') return [];
    text(value, 262144);
    let parsed: unknown; try { parsed = JSON.parse(value); } catch { return fail(); }
    if (!Array.isArray(parsed) || parsed.length > 64) return fail();
    return parsed.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return fail();
        const description = text(item.description, 240); if (!description) return fail();
        return { system: text(item.system, 64), code: text(item.code, 64), description };
    });
}
const ref = (kind: string, id: string) => `source_${createHash('sha256').update(`${kind}\0${id}`).digest('hex').slice(0, 40)}`;
export function buildNativeOrdinaryHostValue(functionId: NativeChartFunction, ambulatoryId: string, rows: NativeOrdinarySourceRows, capturedAt: string): NativeOrdinaryHostValue {
    const patientRevision = rows.patient.version, conditions = diagnoses(rows.patient.diagnoses);
    const notes = text(rows.patient.notes, functionId === 'smart_import' ? 900 : 480);
    const therapyRows = rows.therapies.map(t => ({ ...t, drugName: text(t.drugName, 160), dosage: text(t.dosage, 160),
        activePrinciple: text(t.activePrinciple, 160), aic: text(t.aic, 32), atc: text(t.atc, 32) }));
    const entryRows = rows.entries.map(e => {
        // Ciphertext is rejected BEFORE the rich-text converter can transform it.
        if (typeof e.content !== 'string' || e.content.length > 262144 || e.content.trimStart().startsWith('ENC:')) return fail();
        return { ...e, title: text(e.title, 160), content: text(clinicalRichTextToPlainText(e.content), functionId === 'smart_import' ? 900 : 480) };
    });
    const summaries = rows.attachments.map(a => ({ ...a, name: text(a.name, 160), summarySnapshot: text(a.summarySnapshot, functionId === 'smart_import' ? 900 : 480) }));
    if (functionId === 'patient_insight') {
        const activeTherapies = therapyRows.filter(t => t.drugName).map(t => ({ label: text([t.drugName, t.dosage].filter(Boolean).join(' — '), 240)! }));
        const recentEvents = entryRows.filter(e => e.title || e.content).map(e => ({ summary: text([e.title, e.content].filter(Boolean).join(': '), 240)! }));
        if (!notes && !conditions.length && !activeTherapies.length && !recentEvents.length) return fail();
        const input = parsePatientInsightPreviewRequest({ schemaVersion: 'mediflow.patient-insight.preview-request.v1', requestId: `native_${randomUUID()}`,
            patientId: rows.patient.id, ambulatoryId, patientRevision, capturedAt,
            sources: { focus: { summary: text(notes, 240) ?? 'Valutazione manuale del follow-up clinico attuale' },
                conditions: conditions.slice(0, 12).map(d => ({ label: d.description })), activeTherapies, recentEvents } });
        if (!input) return fail();
        return Object.freeze({ functionId, input });
    }
    if (functionId === 'smart_import') {
        const sources: Array<{ id: string; kind: string; label: string; date: string | null; content: string }> = [];
        if (notes) sources.push({ id: ref('notes', rows.patient.id), kind: 'patient-notes', label: 'Note della cartella', date: date(rows.patient.updatedAt), content: notes });
        for (const e of entryRows) if (e.content) sources.push({ id: ref('entry', e.id), kind: 'clinical-entry', label: e.title ?? 'Evento clinico', date: date(e.date), content: e.content });
        for (const a of summaries) if (a.summarySnapshot) sources.push({ id: ref('summary', a.id), kind: 'attachment-summary', label: a.name ?? 'Sintesi documentale', date: date(a.createdAt), content: a.summarySnapshot });
        if (!sources.length) return fail();
        const input = snapshotSmartImportProjectionAttachment({ schemaVersion: 'mediflow.smart-import.projection-attachment.v1', capability: functionId,
            patientRevision, sourceRevision: patientRevision, capturedAt,
            currentDiagnoses: conditions.filter(d => d.system && d.code).map(d => ({ system: d.system, code: d.code, description: d.description })),
            currentActiveTherapies: therapyRows.filter(t => t.drugName).map(t => ({ drugName: t.drugName, activePrinciple: t.activePrinciple, dosage: t.dosage, aic: t.aic, atc: t.atc })),
            therapyCandidateHints: [], sources }, capturedAt);
        return Object.freeze({ functionId, input });
    }
    const sources: Array<{ id: string; sourceKind: string; label: string; excerpt: string | null; date: string | null }> = [];
    const add = (kind: string, id: string, label: string, excerpt: string | null, at: Date | null) => sources.push({ id: ref(kind, id), sourceKind: kind, label, excerpt, date: date(at) });
    if (notes) add('patient-profile', rows.patient.id, 'Note cliniche', notes, rows.patient.updatedAt);
    conditions.slice(0, 3).forEach((d, i) => add('diagnosis', `${rows.patient.id}_${i}`, text(d.description, 180)!, null, null));
    for (const t of therapyRows) if (t.drugName) add('therapy', t.id, t.drugName, t.dosage, t.updatedAt ?? t.startDate);
    for (const o of rows.observations) {
        const label = text(o.display, 180), value = text(o.value, 320), unit = text(o.unitCode, 80);
        if (label && value) add('observation', o.id, label, [value, unit].filter(Boolean).join(' '), o.observedAt);
    }
    for (const e of entryRows) if (e.title || e.content) add('clinical-entry', e.id, e.title ?? 'Evento clinico', e.content, e.date);
    for (const a of summaries) if (a.summarySnapshot) add('attachment-evidence', a.id, a.name ?? 'Sintesi documentale', a.summarySnapshot, a.createdAt);
    if (!sources.length) return fail();
    const input = snapshotTreatmentReasoningProjectionAttachment({ schemaVersion: 'mediflow.ai.treatment-reasoning-projection-attachment.v1', capability: functionId,
        patientRevision, sourceRevision: `source_${createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`, capturedAt,
        therapyRefs: sources.filter(s => s.sourceKind === 'therapy').map(s => s.id), evidenceRefs: sources.map(s => s.id), sources }, capturedAt);
    return Object.freeze({ functionId, input });
}
