/* @Codex */
import type { DocumentDiagnosisSuggestion, DocumentQualityLevel } from '../../db';
/* @Codex */
import type { DocumentIntelligenceNegativeReason } from './document-intelligence-case-pack';
/* @Codex */
import { normalizeDocumentInput } from './document-input-normalization';
import { splitDocumentIntoLines } from './document-excerpt';

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
export type DocumentEvidenceSuppressedReason = DocumentIntelligenceNegativeReason;

/* @Codex */
export type DocumentEvidenceSourceFreshness = 'recent' | 'stale' | 'undated';

/* @Codex */
export interface DocumentEvidenceSuppressedCandidate {
    id: string;
    label: string;
    excerpt: string;
    reason: DocumentEvidenceSuppressedReason;
    sourceId: string;
}

/* @Codex */
export interface DocumentEvidenceSourceGovernance {
    sourcePriority: number;
    freshness: DocumentEvidenceSourceFreshness;
    suppressedCandidates: DocumentEvidenceSuppressedCandidate[];
}

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
    sourceGovernance?: DocumentEvidenceSourceGovernance;
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
const MAX_SUPPRESSED_CANDIDATES = 8;
const DOCUMENT_FACT_SENTENCE_SPLIT_REGEX = /(?<=[.;!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9])/u;

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

const QUALITY_SOURCE_PRIORITIES: Partial<Record<DocumentQualityLevel, number>> = { green: 80, yellow: 55, red: 25 };
const SUPPRESSED_TOKEN_STOPWORDS = new Set('alla allo con del della delle dello degli dei di il la le lo nel nella nelle per pregressa pregresso'.split(' '));
const SUPPRESSED_REASON_PATTERNS: Array<[DocumentEvidenceSuppressedReason, RegExp]> = [
    ['administrative_noise', /\b(prenotazion\w*|impegnativ\w*|certificat\w*|ticket|consenso|privacy|accettazione|codice fiscale|documento di identita)\b/],
    ['family_history', /\b(familiarit\w*|anamnesi familiar\w*|madre|padre|fratell\w*|sorell\w*|familiare)\b/],
    ['negated', /\b(nessun\w*|nega\w*|negat\w*|assenza di|assente|non evidenza|non segni|esclud\w*|negativo per)\b/],
    ['uncertain', /\b(sospett\w*|probabil\w*|possibil\w*|da escludere|da valutare|quesito diagnostico|compatibil\w*)\b/],
    ['historical_only', /\b(pregress\w*|anamnesi remota|storic\w*|precedent\w*|remot\w*)\b/],
];
const SUPPRESSED_LABEL_STRIPPERS: Partial<Record<DocumentEvidenceSuppressedReason, RegExp>> = {
    family_history: /^.*?\b(?:familiarit[aà]|anamnesi familiare)\b\s*[:\-]?\s*/i,
    historical_only: /^.*?\b(?:anamnesi remota|storia remota)\b\s*[:\-]?\s*/i,
    negated: /^\s*(?:non evidenza di|assenza di|assente|nessun\w*|nega\w*|negat\w*|esclude\w*|negativo per)\s+/i,
    uncertain: /^\s*(?:sospett\w* di|probabil\w*|possibil\w*|da escludere|da valutare|quesito diagnostico)\s*[:\-]?\s*/i,
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

function significantTokens(value: string): string[] {
    return Array.from(new Set(normalizeComparableText(value)
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !SUPPRESSED_TOKEN_STOPWORDS.has(token))));
}

function splitDocumentLines(value: string): string[] {
    return splitDocumentIntoLines(normalizeDocumentInput(value).normalizedText)
        .flatMap((line) => line.split(DOCUMENT_FACT_SENTENCE_SPLIT_REGEX))
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

function inferSuppressedReason(line: string): DocumentEvidenceSuppressedReason | undefined {
    const normalized = normalizeComparableText(line);
    if (!normalized) return undefined;
    return SUPPRESSED_REASON_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0];
}

function buildSuppressedCandidateLabel(line: string, reason: DocumentEvidenceSuppressedReason): string {
    const base = compactText(line, MAX_LABEL_CHARS);
    if (!base) return '';
    const stripper = SUPPRESSED_LABEL_STRIPPERS[reason];
    const stripped = (stripper ? base.replace(stripper, '') : base).trim();
    return compactText(stripped || base, MAX_LABEL_CHARS);
}

function extractSuppressedCandidates(input: BuildDocumentEvidencePackInput): DocumentEvidenceSuppressedCandidate[] {
    const seen = new Set<string>();
    const candidates: DocumentEvidenceSuppressedCandidate[] = [];

    for (const line of splitDocumentLines(input.rawMarkdown)) {
        const reason = inferSuppressedReason(line);
        if (!reason) continue;

        const label = buildSuppressedCandidateLabel(line, reason);
        const labelTokens = significantTokens(label);
        if (labelTokens.length <= 2 && /[:\-]\s*$/.test(label)) continue;
        const key = `${reason}:${normalizeComparableText(label)}`;
        if (!label || !key || seen.has(key)) continue;
        seen.add(key);

        candidates.push({
            id: `suppressed:${reason}:${candidates.length + 1}`,
            label,
            excerpt: compactText(line, MAX_EXCERPT_CHARS),
            reason,
            sourceId: input.documentInsightId,
        });

        if (candidates.length >= MAX_SUPPRESSED_CANDIDATES) break;
    }

    return candidates;
}

function isSuppressedFactCandidate(
    value: string,
    suppressedCandidates: DocumentEvidenceSuppressedCandidate[],
): boolean {
    const factTokens = significantTokens(value);
    if (factTokens.length === 0) return false;

    return suppressedCandidates.some((candidate) => {
        const candidateText = candidate.label;
        const normalizedFact = normalizeComparableText(value);
        const normalizedCandidate = normalizeComparableText(candidateText);
        if (!normalizedCandidate) return false;
        if (normalizedCandidate.includes(normalizedFact) || normalizedFact.includes(normalizedCandidate)) return true;

        const candidateTokens = new Set(significantTokens(candidateText));
        const sharedCount = factTokens.filter((token) => candidateTokens.has(token)).length;
        return sharedCount >= Math.min(2, factTokens.length);
    });
}

function hasDatedSource(documentDate: string): boolean {
    return Number.isFinite(new Date(documentDate).getTime());
}

function inferSourceFreshness(
    input: BuildDocumentEvidencePackInput,
    facts: DocumentEvidenceFact[],
): DocumentEvidenceSourceFreshness {
    if (!hasDatedSource(input.documentDate)) return 'undated';
    if (facts.some((fact) => fact.temporality === 'current' || fact.temporality === 'planned')) return 'recent';

    const normalized = normalizeComparableText(`${input.summary} ${input.rawMarkdown}`);
    if (/\b(anamnesi remota|pregress\w*|storic\w*|prenotazion\w*|impegnativ\w*|certificat\w*)\b/.test(normalized)) {
        return 'stale';
    }

    return 'recent';
}

function clampSourcePriority(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

function buildSourceGovernance(
    input: BuildDocumentEvidencePackInput,
    facts: DocumentEvidenceFact[],
    suppressedCandidates: DocumentEvidenceSuppressedCandidate[],
): DocumentEvidenceSourceGovernance {
    const basePriority = QUALITY_SOURCE_PRIORITIES[input.qualityLevel || 'yellow'] ?? 45;
    const factBonus = Math.min(12, facts.length * 2);
    const sourceBonus = hasDatedSource(input.documentDate) ? 6 : -6;
    const suppressionPenalty = Math.min(10, suppressedCandidates.length * 2);

    return {
        sourcePriority: clampSourcePriority(basePriority + factBonus + sourceBonus - suppressionPenalty),
        freshness: inferSourceFreshness(input, facts),
        suppressedCandidates,
    };
}

function extractDosage(value: string): string | undefined {
    const match = value.match(/\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u|cp|cps|compress(?:a|e)|caps(?:ule)?|gtt)\b(?:\s*[^\n,;]*)?/i);
    return match ? compactText(match[0], 80) : undefined;
}

function buildDiagnosisFact(
    diagnosis: DocumentDiagnosisSuggestion,
    input: BuildDocumentEvidencePackInput,
    index: number,
    suppressedCandidates: DocumentEvidenceSuppressedCandidate[],
): DocumentEvidenceFact | null {
    const label = compactText(diagnosis.description, MAX_LABEL_CHARS);
    if (!label) return null;

    const excerpt = compactText(diagnosis.evidence || diagnosis.description, MAX_EXCERPT_CHARS);
    const probe = excerpt || label;
    if (isSuppressedFactCandidate(`${label} ${excerpt}`, suppressedCandidates)) return null;

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
    const suppressedCandidates = extractSuppressedCandidates(input);
    const diagnosisFacts = input.diagnoses
        .map((diagnosis, index) => buildDiagnosisFact(diagnosis, input, index, suppressedCandidates))
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

    const facts = [
        ...diagnosisFacts,
        ...medicationFacts,
        ...followupFacts,
        ...careSettingFacts,
        ...functionalFacts,
    ];

    return {
        schemaVersion: DOCUMENT_EVIDENCE_PACK_SCHEMA_VERSION,
        source: {
            documentInsightId: input.documentInsightId,
            fileName: input.fileName,
            documentDate: input.documentDate,
            qualityLevel: input.qualityLevel,
        },
        facts,
        sourceGovernance: buildSourceGovernance(input, facts, suppressedCandidates),
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
    pushLine('Follow-up documentato', byKind.get('followup'));
    pushLine('Stato funzionale', byKind.get('functional_status'));
    pushLine('Setting assistenziale', byKind.get('care_setting'));
    pushLine('Terapie documentate', byKind.get('medication'));

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
