/* @Codex */
import type { DocumentDiagnosisSuggestion, DocumentQualityLevel } from './db';

/* @Codex */
export const DOCUMENT_EVIDENCE_PACK_SCHEMA_VERSION = 'mediflow.document_evidence_pack.v2';

/* @Codex */
export type DocumentEvidenceKind =
    | 'problem'
    | 'medication'
    | 'followup'
    | 'care_setting'
    | 'functional_status';

/* @Codex */
export type DocumentEvidenceTemporality = 'current' | 'historical' | 'planned' | 'unknown';

/* @Codex */
export type DocumentEvidenceStatus = 'active' | 'suspended' | 'resolved' | 'planned' | 'unknown';

/* @Codex */
export type DocumentEvidenceOrigin = 'documented' | 'inferred';

/* @Codex */
export interface DocumentEvidenceFact {
    id: string;
    kind: DocumentEvidenceKind;
    label: string;
    excerpt: string;
    sourceId: string;
    temporality: DocumentEvidenceTemporality;
    status: DocumentEvidenceStatus;
    origin: DocumentEvidenceOrigin;
    code?: string;
    system?: DocumentDiagnosisSuggestion['system'];
    dosage?: string;
}

/* @Codex */
export interface DocumentEvidencePack {
    schemaVersion: typeof DOCUMENT_EVIDENCE_PACK_SCHEMA_VERSION;
    source: {
        documentInsightId: string;
        fileName: string;
        documentDate: string;
        qualityLevel?: DocumentQualityLevel;
    };
    facts: DocumentEvidenceFact[];
}

/* @Codex */
export interface BuildDocumentEvidencePackInput {
    documentInsightId: string;
    fileName: string;
    documentDate: string;
    qualityLevel?: DocumentQualityLevel;
    summary: string;
    rawMarkdown: string;
    diagnoses: DocumentDiagnosisSuggestion[];
    medications: string[];
}

const MAX_LABEL_CHARS = 160;
const MAX_EXCERPT_CHARS = 220;

const STATUS_LABELS: Record<DocumentEvidenceStatus, string> = {
    active: 'attivo',
    suspended: 'sospeso',
    resolved: 'risolto',
    planned: 'pianificato',
    unknown: 'da chiarire',
};

const TEMPORALITY_LABELS: Record<DocumentEvidenceTemporality, string> = {
    current: 'attuale',
    historical: 'storico',
    planned: 'programmato',
    unknown: 'non definito',
};

function compactText(value: string | null | undefined, maxChars: number): string {
    const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.length <= maxChars
        ? normalized
        : `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function normalizeComparableText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function splitDocumentLines(value: string): string[] {
    return value
        .replace(/\r/g, '\n')
        .split(/\n+/)
        .map((line) => compactText(line, MAX_EXCERPT_CHARS))
        .filter((line) => line.length >= 8);
}

function isGenericHeading(line: string): boolean {
    const normalized = normalizeComparableText(line);
    if (!normalized) return false;
    const tokenCount = normalized.split(/\s+/).length;
    if (tokenCount > 5) return false;
    return /\b(diagnosi|terapia|indicazioni|documento|referto|conclusioni)\b/.test(normalized);
}

function inferTemporality(value: string): DocumentEvidenceTemporality {
    const normalized = normalizeComparableText(value);
    if (!normalized) return 'unknown';
    if (/\b(pregress|anamnesi remota|storic|esiti di|precedent|gia noto)\b/.test(normalized)) return 'historical';
    if (/\b(follow up|followup|controll|rivalut|programma|indicazioni|da ripetere|da effettuare|fkt|riabilit)\b/.test(normalized)) return 'planned';
    return 'current';
}

function inferStatus(value: string, kind: DocumentEvidenceKind): DocumentEvidenceStatus {
    const normalized = normalizeComparableText(value);
    if (!normalized) return kind === 'followup' ? 'planned' : 'unknown';
    if (/\b(sospend\w*|interrott\w*|stop|suspend\w*)\b/.test(normalized)) return 'suspended';
    if (/\b(risolt\w*|guarit\w*|negat\w*|remissione)\b/.test(normalized)) return 'resolved';
    if (kind === 'followup' || /\b(controll|rivalut|programma|da effettuare|proseguire|fkt|riabilit)\b/.test(normalized)) return 'planned';
    return 'active';
}

function extractDosage(value: string): string | undefined {
    const match = value.match(/\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u|cp|cps|compress(?:a|e)|caps(?:ule)?|gtt)\b(?:\s*[^\n,;]*)?/i);
    return match ? compactText(match[0], 80) : undefined;
}

function buildDiagnosisFact(
    diagnosis: DocumentDiagnosisSuggestion,
    input: BuildDocumentEvidencePackInput,
    index: number,
): DocumentEvidenceFact | null {
    const label = compactText(diagnosis.description, MAX_LABEL_CHARS);
    if (!label) return null;

    const excerpt = compactText(diagnosis.evidence || diagnosis.description, MAX_EXCERPT_CHARS);
    const probe = excerpt || label;

    return {
        id: `problem:${diagnosis.system}:${diagnosis.code}:${index + 1}`,
        kind: 'problem',
        label,
        excerpt,
        sourceId: input.documentInsightId,
        temporality: inferTemporality(probe),
        status: inferStatus(probe, 'problem'),
        origin: diagnosis.evidence ? 'documented' : 'inferred',
        code: diagnosis.code,
        system: diagnosis.system,
    };
}

function buildMedicationFact(
    medication: string,
    input: BuildDocumentEvidencePackInput,
    index: number,
): DocumentEvidenceFact | null {
    const label = compactText(medication, MAX_LABEL_CHARS);
    if (!label) return null;

    return {
        id: `medication:${index + 1}:${normalizeComparableText(label).slice(0, 32) || 'item'}`,
        kind: 'medication',
        label,
        excerpt: compactText(medication, MAX_EXCERPT_CHARS),
        sourceId: input.documentInsightId,
        temporality: inferTemporality(medication),
        status: inferStatus(medication, 'medication'),
        origin: 'documented',
        dosage: extractDosage(medication),
    };
}

function pickHeuristicFactLines(
    input: BuildDocumentEvidencePackInput,
    kind: Extract<DocumentEvidenceKind, 'followup' | 'care_setting' | 'functional_status'>,
    predicate: (line: string) => boolean,
): DocumentEvidenceFact[] {
    const seen = new Set<string>();
    const facts: DocumentEvidenceFact[] = [];

    for (const line of splitDocumentLines(input.rawMarkdown)) {
        if (!predicate(line)) continue;
        if (isGenericHeading(line)) continue;
        if (
            kind === 'followup'
            && extractDosage(line)
            && !/\b(controll\w*|visita\w*|fkt|riabilit\w*)\b/i.test(line)
        ) {
            continue;
        }

        const key = normalizeComparableText(line);
        if (!key || seen.has(key)) continue;
        seen.add(key);

        facts.push({
            id: `${kind}:${facts.length + 1}`,
            kind,
            label: compactText(line, MAX_LABEL_CHARS),
            excerpt: compactText(line, MAX_EXCERPT_CHARS),
            sourceId: input.documentInsightId,
            temporality: inferTemporality(line),
            status: inferStatus(line, kind),
            origin: 'documented',
        });

        if (facts.length >= 2) break;
    }

    if (facts.length > 0) return facts;

    if (predicate(input.summary)) {
        facts.push({
            id: `${kind}:summary`,
            kind,
            label: compactText(input.summary, MAX_LABEL_CHARS),
            excerpt: compactText(input.summary, MAX_EXCERPT_CHARS),
            sourceId: input.documentInsightId,
            temporality: inferTemporality(input.summary),
            status: inferStatus(input.summary, kind),
            origin: 'inferred',
        });
    }

    return facts;
}

/* @Codex */
export function buildDocumentEvidencePack(input: BuildDocumentEvidencePackInput): DocumentEvidencePack {
    const diagnosisFacts = input.diagnoses
        .map((diagnosis, index) => buildDiagnosisFact(diagnosis, input, index))
        .filter((fact): fact is DocumentEvidenceFact => Boolean(fact));
    const medicationFacts = input.medications
        .map((medication, index) => buildMedicationFact(medication, input, index))
        .filter((fact): fact is DocumentEvidenceFact => Boolean(fact));
    const followupFacts = pickHeuristicFactLines(
        input,
        'followup',
        (line) => /\b(follow[- ]?up|controll\w*|rivalut\w*|da ripetere|da effettuare|programma\w*|visita\w*|fkt|riabilit\w*)\b/i.test(line),
    );
    const careSettingFacts = pickHeuristicFactLines(
        input,
        'care_setting',
        (line) => /\b(adi|domiciliar|caregiver|rsa|assistenza|setting assistenziale|territorio)\b/i.test(line),
    );
    const functionalFacts = pickHeuristicFactLines(
        input,
        'functional_status',
        (line) => /\b(deambul|cammino|cadut|carrozz|deambulatore|ausilio|barthel|tinetti|mobilit|riabilit)\b/i.test(line),
    );

    return {
        schemaVersion: DOCUMENT_EVIDENCE_PACK_SCHEMA_VERSION,
        source: {
            documentInsightId: input.documentInsightId,
            fileName: input.fileName,
            documentDate: input.documentDate,
            qualityLevel: input.qualityLevel,
        },
        facts: [
            ...diagnosisFacts,
            ...medicationFacts,
            ...followupFacts,
            ...careSettingFacts,
            ...functionalFacts,
        ],
    };
}

function buildFactTag(fact: DocumentEvidenceFact): string {
    const tags: string[] = [];
    if (fact.temporality !== 'current') tags.push(TEMPORALITY_LABELS[fact.temporality]);
    if (fact.status !== 'active') tags.push(STATUS_LABELS[fact.status]);
    if (fact.origin === 'inferred') tags.push('inferito');
    return tags.length > 0 ? ` [${tags.join(', ')}]` : '';
}

function renderFact(fact: DocumentEvidenceFact): string {
    const prefix = fact.code && fact.system
        ? `${fact.system} ${fact.code}: `
        : '';
    return `${prefix}${fact.label}${buildFactTag(fact)}`;
}

/* @Codex */
export function renderDocumentEvidencePackLines(pack: DocumentEvidencePack): string[] {
    const byKind = new Map<DocumentEvidenceKind, DocumentEvidenceFact[]>();
    for (const fact of pack.facts) {
        const bucket = byKind.get(fact.kind) || [];
        bucket.push(fact);
        byKind.set(fact.kind, bucket);
    }

    const lines: string[] = [];
    const pushLine = (label: string, facts: DocumentEvidenceFact[] | undefined) => {
        if (!facts || facts.length === 0) return;
        lines.push(`${label}: ${facts.slice(0, 3).map(renderFact).join('; ')}`);
    };

    pushLine('Problemi documentati', byKind.get('problem'));
    pushLine('Terapie documentate', byKind.get('medication'));
    pushLine('Follow-up documentato', byKind.get('followup'));
    pushLine('Setting assistenziale', byKind.get('care_setting'));
    pushLine('Stato funzionale', byKind.get('functional_status'));

    return lines;
}

/* @Codex */
export function renderDocumentEvidencePackContext(pack: DocumentEvidencePack, maxChars = 600): string {
    const lines = renderDocumentEvidencePackLines(pack);
    if (lines.length === 0) return '';

    const selected: string[] = [];
    for (const line of lines) {
        const candidate = selected.length > 0 ? `${selected.join(' | ')} | ${line}` : line;
        if (candidate.length <= maxChars || selected.length === 0) {
            selected.push(line);
        }
    }

    return selected.join(' | ');
}
