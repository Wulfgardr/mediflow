/* @Codex */
import { clinicalRichTextToPlainText } from './clinical-rich-text';
import type {
    Attachment,
    ClinicalEntry,
    Diagnosis,
    DocumentInsight,
    Observation,
    Patient,
    Therapy,
} from './db';
import type {
    TreatmentReasoningEvidenceRef,
    TreatmentReasoningPromptInput,
} from './treatment-reasoning-contract';

export interface TreatmentReasoningSourceSummary {
    profile: number;
    diagnoses: number;
    activeTherapies: number;
    observations: number;
    clinicalEntries: number;
    documentInsights: number;
    attachmentEvidence: number;
    total: number;
}

export interface TreatmentReasoningContextInput {
    patient: Patient;
    entries?: ClinicalEntry[];
    therapies?: Therapy[];
    observations?: Observation[];
    attachments?: Attachment[];
    question?: string;
    now?: Date;
}

export interface TreatmentReasoningContextBundle extends TreatmentReasoningPromptInput {
    sourceSummary: TreatmentReasoningSourceSummary;
}

export const DEFAULT_TREATMENT_REASONING_QUESTION =
    'Rivedi coerenza, rischi e azioni review-only del piano terapeutico corrente sulla base delle fonti disponibili.';

const MAX_SOURCE_EXCERPT_CHARS = 320;
const MAX_CONTEXT_CHARS = 900;

function normalizeWhitespace(value: string): string {
    return value.replace(/\r/g, ' ').replace(/\s+/g, ' ').trim();
}

function trimSnippet(value: unknown, maxChars = MAX_SOURCE_EXCERPT_CHARS): string {
    if (typeof value !== 'string') return '';
    const normalized = normalizeWhitespace(value);
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function parseJsonArray<T>(value: unknown): T[] {
    if (Array.isArray(value)) return value as T[];
    if (typeof value !== 'string' || !value.trim()) return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
        return [];
    }
}

function toDate(value: unknown): Date | null {
    if (!value) return null;
    const date = new Date(value as string | number | Date);
    return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(value: unknown): string | undefined {
    const date = toDate(value);
    return date ? date.toISOString() : undefined;
}

function toDisplayDate(value: unknown): string | undefined {
    const date = toDate(value);
    return date ? date.toLocaleDateString('it-IT') : undefined;
}

function calculateAge(birthDate: unknown, now: Date): number | null {
    const date = toDate(birthDate);
    if (!date) return null;
    let age = now.getFullYear() - date.getFullYear();
    const monthDelta = now.getMonth() - date.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < date.getDate())) {
        age -= 1;
    }
    return age >= 0 && age < 130 ? age : null;
}

function buildPatientContext(patient: Patient, now: Date): string {
    const diagnoses = parseJsonArray<Diagnosis>(patient.diagnoses);
    const age = calculateAge(patient.birthDate, now);
    const parts = [
        age !== null ? `Eta approssimativa: ${age} anni` : undefined,
        patient.isAdi ? 'Percorso ADI attivo' : undefined,
        patient.isArchived ? 'Profilo archiviato' : 'Profilo attivo',
        patient.monitoringProfile ? `Profilo monitoraggio: ${trimSnippet(patient.monitoringProfile, 180)}` : undefined,
        diagnoses.length > 0 ? `Diagnosi codificate: ${diagnoses.length}` : 'Nessuna diagnosi codificata',
        patient.notes ? `Note cliniche sintetiche: ${trimSnippet(patient.notes, 260)}` : undefined,
    ].filter(Boolean);

    return trimSnippet(parts.join(' | '), MAX_CONTEXT_CHARS);
}

function diagnosisLabel(diagnosis: Diagnosis): string {
    return [
        diagnosis.system,
        diagnosis.code,
        diagnosis.description,
    ].filter(Boolean).join(' ');
}

function therapyLabel(therapy: Therapy): string {
    return [
        therapy.drugName,
        therapy.activePrinciple ? `(${therapy.activePrinciple})` : undefined,
        therapy.dosage,
        therapy.status !== 'active' ? `[${therapy.status}]` : undefined,
    ].filter(Boolean).join(' ');
}

function observationLabel(observation: Observation): string {
    return [
        observation.display || observation.code,
        `${observation.value}${observation.unitCode ? ` ${observation.unitCode}` : ''}`,
        toDisplayDate(observation.observedAt),
    ].filter(Boolean).join(' · ');
}

function entryLabel(entry: ClinicalEntry): string {
    return [
        entry.type.toUpperCase(),
        toDisplayDate(entry.date),
        trimSnippet(entry.title, 80),
    ].filter(Boolean).join(' · ');
}

function documentInsightExcerpt(insight: DocumentInsight): string {
    const medications = Array.isArray(insight.extractedData?.medications)
        ? insight.extractedData.medications.join(' | ')
        : '';
    const diagnoses = Array.isArray(insight.extractedData?.diagnoses)
        ? insight.extractedData.diagnoses
            .map((diagnosis) => `${diagnosis.system} ${diagnosis.code} ${diagnosis.description}`)
            .join(' | ')
        : '';
    return trimSnippet([insight.summary, diagnoses, medications].filter(Boolean).join(' | '));
}

function countByKind(sources: TreatmentReasoningEvidenceRef[]): TreatmentReasoningSourceSummary {
    const sourceKindCount = (kind: TreatmentReasoningEvidenceRef['sourceKind']) => (
        sources.filter((source) => source.sourceKind === kind).length
    );

    return {
        profile: sourceKindCount('patient-profile'),
        diagnoses: sourceKindCount('diagnosis'),
        activeTherapies: sourceKindCount('therapy'),
        observations: sourceKindCount('observation'),
        clinicalEntries: sourceKindCount('clinical-entry'),
        documentInsights: sourceKindCount('document-insight'),
        attachmentEvidence: sourceKindCount('attachment-evidence'),
        total: sources.length,
    };
}

function sourceKey(prefix: string, id: string | undefined, index: number): string {
    return `${prefix}:${id?.trim() || index + 1}`;
}

export function buildTreatmentReasoningContextBundle(input: TreatmentReasoningContextInput): TreatmentReasoningContextBundle {
    const now = input.now ?? new Date();
    const patientContext = buildPatientContext(input.patient, now);
    const diagnoses = parseJsonArray<Diagnosis>(input.patient.diagnoses);
    const documentInsights = parseJsonArray<DocumentInsight>(input.patient.documentInsights);
    const therapies = (input.therapies ?? []).filter((therapy) => !therapy.deletedAt);
    const activeTherapies = therapies
        .filter((therapy) => therapy.status === 'active')
        .sort((left, right) => {
            const leftTime = toDate(left.startDate)?.getTime() ?? 0;
            const rightTime = toDate(right.startDate)?.getTime() ?? 0;
            return rightTime - leftTime;
        });
    const observations = (input.observations ?? [])
        .filter((observation) => !('deletedAt' in observation) || !(observation as Observation & { deletedAt?: Date | null }).deletedAt)
        .sort((left, right) => {
            const leftTime = toDate(left.observedAt)?.getTime() ?? 0;
            const rightTime = toDate(right.observedAt)?.getTime() ?? 0;
            return rightTime - leftTime;
        });
    const entries = (input.entries ?? [])
        .filter((entry) => !entry.deletedAt && entry.content?.trim())
        .sort((left, right) => {
            const leftTime = toDate(left.date)?.getTime() ?? 0;
            const rightTime = toDate(right.date)?.getTime() ?? 0;
            return rightTime - leftTime;
        });
    const attachments = (input.attachments ?? [])
        .filter((attachment) => attachment.summarySnapshot?.trim())
        .sort((left, right) => {
            const leftTime = toDate(left.createdAt)?.getTime() ?? 0;
            const rightTime = toDate(right.createdAt)?.getTime() ?? 0;
            return rightTime - leftTime;
        });
    const sources: TreatmentReasoningEvidenceRef[] = [];

    if (patientContext) {
        sources.push({
            id: 'profile:clinical-summary',
            sourceKind: 'patient-profile',
            label: 'Profilo clinico sintetico',
            excerpt: patientContext,
        });
    }

    diagnoses.slice(0, 8).forEach((diagnosis, index) => {
        const label = diagnosisLabel(diagnosis);
        if (!label) return;
        sources.push({
            id: sourceKey('diagnosis', diagnosis.code, index),
            sourceKind: 'diagnosis',
            label,
            excerpt: trimSnippet(diagnosis.description),
            date: toIsoDate(diagnosis.date),
        });
    });

    activeTherapies.slice(0, 12).forEach((therapy, index) => {
        sources.push({
            id: sourceKey('therapy', therapy.id, index),
            sourceKind: 'therapy',
            label: therapyLabel(therapy),
            excerpt: trimSnippet([therapy.diagnosisName, therapy.motivation].filter(Boolean).join(' | ')),
            date: toIsoDate(therapy.startDate),
        });
    });

    observations.slice(0, 8).forEach((observation, index) => {
        sources.push({
            id: sourceKey('observation', observation.id, index),
            sourceKind: 'observation',
            label: observationLabel(observation),
            excerpt: trimSnippet(observation.notes || observation.display),
            date: toIsoDate(observation.observedAt),
        });
    });

    entries.slice(0, 6).forEach((entry, index) => {
        const content = trimSnippet(clinicalRichTextToPlainText(entry.content), 460);
        if (!content) return;
        sources.push({
            id: sourceKey('entry', entry.id, index),
            sourceKind: 'clinical-entry',
            label: entryLabel(entry),
            excerpt: content,
            date: toIsoDate(entry.date),
        });
    });

    documentInsights.slice(0, 4).forEach((insight, index) => {
        const excerpt = documentInsightExcerpt(insight);
        if (!excerpt) return;
        sources.push({
            id: sourceKey('insight', insight.id, index),
            sourceKind: 'document-insight',
            label: `Documento ${trimSnippet(insight.fileName || 'analizzato', 120)}`,
            excerpt,
            date: toIsoDate(insight.date),
        });
    });

    attachments.slice(0, 3).forEach((attachment, index) => {
        sources.push({
            id: sourceKey('attachment', attachment.id, index),
            sourceKind: 'attachment-evidence',
            label: `Allegato ${trimSnippet(attachment.name || 'con sintesi', 120)}`,
            excerpt: trimSnippet(attachment.summarySnapshot),
            date: toIsoDate(attachment.createdAt),
        });
    });

    return {
        question: input.question || DEFAULT_TREATMENT_REASONING_QUESTION,
        patientContext,
        diagnoses: diagnoses.slice(0, 10).map(diagnosisLabel).filter(Boolean),
        activeTherapies: activeTherapies.slice(0, 12).map(therapyLabel).filter(Boolean),
        observations: observations.slice(0, 8).map(observationLabel).filter(Boolean),
        sources,
        sourceSummary: countByKind(sources),
    };
}

export function countTreatmentReasoningSources(input: TreatmentReasoningContextInput): TreatmentReasoningSourceSummary {
    return buildTreatmentReasoningContextBundle(input).sourceSummary;
}
