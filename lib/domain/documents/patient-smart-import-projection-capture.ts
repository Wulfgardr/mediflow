/* @Codex */
import { clinicalRichTextToPlainText } from '../../clinical-rich-text';
import type { ClinicalEntry, Diagnosis, DocumentInsight, Patient, Therapy } from '../../db';
import { normalizeClinicalText } from './clinical-text-normalization';
import { dedupeDocumentInsightsForContext } from './document-insight-context';
import { renderDocumentEvidencePackContext } from './document-evidence-pack';

export type PatientSmartImportEvidenceSourceKind =
    | 'patient-notes'
    | 'clinical-entry'
    | 'document-insight'
    | 'attachment-summary';

export interface PatientSmartImportSourceRecord {
    id: string;
    kind: PatientSmartImportEvidenceSourceKind;
    label: string;
    date?: string;
    content: string;
}

export type PatientSmartImportProjectionCaptureInput = Readonly<{
    patient: Readonly<{ version: Patient['version'] }>;
    currentDiagnoses: ReadonlyArray<Readonly<{ system: string; code: string; description: string }>>;
    currentActiveTherapies: ReadonlyArray<Readonly<{
        drugName: string;
        activePrinciple: string | null;
        dosage: string | null;
        aic: string | null;
        atc: string | null;
    }>>;
    sources: ReadonlyArray<Readonly<{
        kind: PatientSmartImportEvidenceSourceKind;
        originKey: string;
        label: string;
        date: string | null;
        content: string;
    }>>;
    therapyCandidateHints: ReadonlyArray<Readonly<{
        kind: PatientSmartImportEvidenceSourceKind;
        originKey: string;
        label: string;
        excerpt: string;
    }>>;
}>;

type AttachmentSummary = Readonly<{
    id: string;
    name: string;
    summarySnapshot?: string;
    createdAt: Date;
}>;

const THERAPY_HINT_LIMIT = 14;
const DOSAGE_TOKEN_REGEX = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u|cp|cps|cpr|caps(?:ule)?|compress(?:a|e)|gtt|fial(?:a|e)|spruzzi?)\b/i;
const THERAPY_SECTION_HINTS = [
    'terapia',
    'terapia domiciliare',
    'farmaco',
    'farmaci',
    'posologia',
    'prescr',
    'assume',
    'medicazione',
    'schema terapeutico',
];
const DRUG_QUERY_STOPWORDS = new Set([
    'al', 'alla', 'alle', 'con', 'da', 'del', 'della', 'dopo', 'fare', 'giorno', 'giorni',
    'mattino', 'mezza', 'ogni', 'per', 'poi', 'pranzo', 'prima', 'sera', 'volta', 'volte',
    'verificare', 'confermare', 'dose', 'dosi', 'ore', 'uno', 'una', 'due', 'tre', 'quattro',
]);

function tokenize(value: string): string[] {
    return normalizeClinicalText(value)
        .split(/\s+/)
        .filter((token) => token.length > 1);
}

export function trimPatientSmartImportSnippet(value: string, maxLength = 260): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function splitSourceClauses(content: string): string[] {
    return content
        .replace(/\r/g, '\n')
        .split(/[\n;•\u2022|]+/)
        .flatMap((part) => part.split(/(?<=[.!?])\s+/))
        .map((part) => part.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

function isTherapyLikeClause(clause: string): boolean {
    const normalized = normalizeClinicalText(clause);
    if (!normalized) return false;
    if (THERAPY_SECTION_HINTS.some((hint) => normalized.includes(hint))) return true;

    return DOSAGE_TOKEN_REGEX.test(clause)
        && tokenize(clause).some((token) => token.length >= 4 && !DRUG_QUERY_STOPWORDS.has(token));
}

function splitTherapyCandidateClause(clause: string): string[] {
    const compact = clause.replace(/\s+/g, ' ').trim();
    const transitionParts = compact
        .split(/\b(?:poi|quindi|successivamente)\b/i)
        .map((part) => part.trim())
        .filter(Boolean);
    const baseParts = transitionParts.length > 1 ? transitionParts : [compact];

    return baseParts.flatMap((part) => {
        const commaParts = part
            .split(/,(?!\d)/)
            .map((item) => item.trim())
            .filter(Boolean);
        if (commaParts.length > 1 && commaParts.filter(isTherapyLikeClause).length >= 2) return commaParts;
        return [part];
    });
}

function splitPromptSourceSegments(content: string, maxSegments = 4): string[] {
    const segments = content
        .replace(/\r/g, '\n')
        .split(/[\n;•\u2022]+/)
        .map((part) => part.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    if (segments.length <= 1) return [content.replace(/\s+/g, ' ').trim()];
    return segments.slice(0, maxSegments);
}

export function buildPatientSmartImportTherapyCandidateHints(
    sources: PatientSmartImportSourceRecord[],
): Array<{ sourceId: string; label: string; excerpt: string }> {
    const seen = new Set<string>();
    const hints: Array<{ sourceId: string; label: string; excerpt: string }> = [];

    for (const source of sources) {
        for (const clause of splitSourceClauses(source.content)) {
            if (!isTherapyLikeClause(clause)) continue;
            for (const candidate of splitTherapyCandidateClause(clause)) {
                const excerpt = trimPatientSmartImportSnippet(candidate, 180);
                if (!excerpt) continue;
                const key = `${source.id}:${normalizeClinicalText(excerpt)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                hints.push({ sourceId: source.id, label: source.label, excerpt });
                if (hints.length >= THERAPY_HINT_LIMIT) return hints;
            }
        }
    }

    return hints;
}

function parseDocumentInsights(raw: Patient['documentInsights']): DocumentInsight[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string') return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as DocumentInsight[] : [];
    } catch {
        return [];
    }
}

export function parsePatientSmartImportDiagnoses(raw: Patient['diagnoses']): Diagnosis[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string') return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as Diagnosis[] : [];
    } catch {
        return [];
    }
}

function normalizeDate(value: unknown): string | undefined {
    if (!value) return undefined;
    const date = new Date(value as string | number | Date);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function buildPatientSmartImportSourceRecords(
    patient: Patient,
    entries: ClinicalEntry[],
    attachments: AttachmentSummary[],
): PatientSmartImportSourceRecord[] {
    const records: PatientSmartImportSourceRecord[] = [];

    if (patient.notes?.trim()) {
        splitPromptSourceSegments(patient.notes, 6).forEach((segment, index) => {
            records.push({
                id: `patient-notes:${index + 1}`,
                kind: 'patient-notes',
                label: index === 0 ? 'Note paziente' : `Note paziente · segmento ${index + 1}`,
                content: trimPatientSmartImportSnippet(segment, 900),
            });
        });
    }

    entries
        .filter((entry) => !entry.deletedAt && entry.content?.trim())
        .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
        .slice(0, 6)
        .forEach((entry) => {
            splitPromptSourceSegments(clinicalRichTextToPlainText(entry.content), 4).forEach((segment, index) => {
                records.push({
                    id: `entry:${entry.id}:${index + 1}`,
                    kind: 'clinical-entry',
                    label: index === 0
                        ? `${entry.type.toUpperCase()} ${new Date(entry.date).toLocaleDateString('it-IT')}`
                        : `${entry.type.toUpperCase()} ${new Date(entry.date).toLocaleDateString('it-IT')} · segmento ${index + 1}`,
                    date: normalizeDate(entry.date),
                    content: trimPatientSmartImportSnippet(segment, 650),
                });
            });
        });

    const insightFileNames = new Set<string>();
    dedupeDocumentInsightsForContext(
        [...parseDocumentInsights(patient.documentInsights)]
            .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()),
    ).insights.slice(0, 4).forEach((insight) => {
        const fileName = typeof insight.fileName === 'string' ? insight.fileName.trim() : '';
        if (fileName) insightFileNames.add(fileName.toLowerCase());
        const evidencePackContext = insight.evidencePack
            ? renderDocumentEvidencePackContext(insight.evidencePack, 420)
            : '';
        const extractedDiagnoses = !evidencePackContext && Array.isArray(insight.extractedData?.diagnoses)
            ? insight.extractedData.diagnoses.map((item) => `${item.system} ${item.code} ${item.description}`).join(' | ')
            : '';
        const extractedMedications = !evidencePackContext && Array.isArray(insight.extractedData?.medications)
            ? insight.extractedData.medications.join(' | ')
            : '';
        records.push({
            id: `insight:${insight.id}`,
            kind: 'document-insight',
            label: `Documento ${fileName || 'analizzato'}`,
            date: normalizeDate(insight.date),
            content: trimPatientSmartImportSnippet(
                [evidencePackContext, insight.summary, extractedDiagnoses, extractedMedications].filter(Boolean).join('\n'),
                900,
            ),
        });
    });

    attachments
        .filter((attachment) => attachment.summarySnapshot?.trim())
        .filter((attachment) => !insightFileNames.has(attachment.name.trim().toLowerCase()))
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, 3)
        .forEach((attachment) => {
            records.push({
                id: `attachment:${attachment.id}`,
                kind: 'attachment-summary',
                label: `Allegato ${attachment.name}`,
                date: normalizeDate(attachment.createdAt),
                content: trimPatientSmartImportSnippet(attachment.summarySnapshot || '', 500),
            });
        });

    return records;
}

export function countUsableSources(
    patient: Patient,
    entries: ClinicalEntry[] | undefined,
    attachmentSummaryCount: number,
): number {
    const documentInsightCount = Array.isArray(patient.documentInsights) ? patient.documentInsights.length : 0;
    return [
        patient.notes?.trim() ? 1 : 0,
        entries?.filter((entry) => !entry.deletedAt && entry.content?.trim()).length || 0,
        documentInsightCount,
        attachmentSummaryCount,
    ].reduce((total, count) => total + count, 0);
}

/** Preserves every source record; the browser normalizer owns its 32-source rejection. */
export function buildPatientSmartImportProjectionCaptureInput(
    patient: Patient,
    entries: ClinicalEntry[],
    attachments: AttachmentSummary[],
    therapies: Therapy[],
): PatientSmartImportProjectionCaptureInput {
    const sourceRecords = buildPatientSmartImportSourceRecords(patient, entries, attachments);
    const sources = sourceRecords.map((source) => Object.freeze({
        kind: source.kind,
        originKey: source.id,
        label: source.label,
        date: source.date ?? null,
        content: source.content,
    }));
    const byId = new Map(sourceRecords.map((source) => [source.id, source]));
    const therapyCandidateHints = buildPatientSmartImportTherapyCandidateHints(sourceRecords).map((hint) => {
        const source = byId.get(hint.sourceId)!;
        return Object.freeze({ kind: source.kind, originKey: source.id, label: hint.label, excerpt: hint.excerpt });
    });
    return Object.freeze({
        patient: Object.freeze({ version: patient.version }),
        currentDiagnoses: Object.freeze(parsePatientSmartImportDiagnoses(patient.diagnoses).map((diagnosis) => Object.freeze({
            system: diagnosis.system,
            code: diagnosis.code,
            description: diagnosis.description,
        }))),
        currentActiveTherapies: Object.freeze(therapies.filter((therapy) => therapy.status === 'active').map((therapy) => Object.freeze({
            drugName: therapy.drugName,
            activePrinciple: therapy.activePrinciple ?? null,
            dosage: therapy.dosage ?? null,
            aic: therapy.aic ?? null,
            atc: therapy.atc ?? null,
        }))),
        sources: Object.freeze(sources),
        therapyCandidateHints: Object.freeze(therapyCandidateHints),
    });
}
