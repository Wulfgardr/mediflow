import { regeneratePatientSummary } from './ai-summary-service';
import { AIService } from './ai-service';
import {
    buildSmartImportExtractionPrompt,
    parseSmartImportExtractionResponse,
    type SmartImportConfidence,
    type SmartImportDiagnosisExtraction as ParsedAiDiagnosis,
    type SmartImportExtractionData as ParsedAiPayload,
    type SmartImportTherapyExtraction as ParsedAiTherapy,
    type TherapySuggestionState,
} from './ai-task-contracts';
import { db, type AifaDrug, type ClinicalEntry, type Diagnosis, type DocumentInsight, type Patient, type Therapy } from './db';
/* @Codex */
import { dedupeDocumentInsightsForContext } from './document-insight-context';
/* @Codex */
import { renderDocumentEvidencePackContext } from './document-evidence-pack';
import { searchICDHybrid, type ICDSearchResult } from './icd-service';
import { notifyDbChange } from './live-query';
import {
    buildDiagnosisSearchQueries,
    buildTherapyReview,
    buildDrugSearchTerms,
    hasDrugDosageConflict,
    rankIcdMatch,
    rankDrugMatch,
    selectTherapyCatalogMatch,
    type SmartImportReview,
    type SmartImportReviewState,
} from './patient-smart-import-matching';
import {
    AI_SMART_IMPORT_KILL_SWITCH_KEY,
    assertAiSmartImportEnabledValue,
} from './ai-smart-import-kill-switch';

export type { SmartImportConfidence, TherapySuggestionState, SmartImportReview, SmartImportReviewState };

export interface SmartImportEvidence {
    sourceKind: 'patient-notes' | 'clinical-entry' | 'document-insight' | 'attachment-summary';
    sourceId: string;
    label: string;
    excerpt: string;
    date?: string;
}

export interface DiagnosisResolverCandidate {
    code: string;
    description: string;
    query: string;
    score: number;
    selected: boolean;
}

export interface DiagnosisResolverTrace {
    queries: string[];
    candidates: DiagnosisResolverCandidate[];
}

export interface TherapyResolverCandidate {
    aic: string;
    name: string;
    activePrinciple?: string;
    packaging?: string;
    atc?: string;
    searchTerm: string;
    score: number;
    dosageAligned: boolean;
    selected: boolean;
}

export interface TherapyResolverTrace {
    searchTerms: string[];
    candidates: TherapyResolverCandidate[];
}

export interface DiagnosisSmartImportSuggestion {
    id: string;
    label: string;
    icdQuery: string;
    confidence: SmartImportConfidence;
    evidence: SmartImportEvidence;
    explicitCode?: string;
    match?: {
        code: string;
        description: string;
        system: 'ICD-11';
    };
    canApply: boolean;
    blockedReason?: string;
    review: SmartImportReview;
    resolver: DiagnosisResolverTrace;
    reviewedLabel?: string;
}

export interface TherapySmartImportSuggestion {
    id: string;
    drugMention: string;
    drugQuery: string;
    activePrinciple?: string;
    dosage?: string;
    motivation?: string;
    therapyState: TherapySuggestionState;
    reviewNote?: string;
    confidence: SmartImportConfidence;
    evidence: SmartImportEvidence;
    matchType: 'catalog' | 'manual' | 'none';
    match?: Pick<AifaDrug, 'aic' | 'name' | 'activePrinciple' | 'atc' | 'company'>;
    canApply: boolean;
    blockedReason?: string;
    review: SmartImportReview;
    resolver: TherapyResolverTrace;
    reviewedDrugName?: string;
    reviewedActivePrinciple?: string;
    reviewedDosage?: string;
    reviewedMotivation?: string;
}

type TherapySuggestionMatchType = TherapySmartImportSuggestion['matchType'];

export interface PatientSmartImportAnalysis {
    generatedAt: string;
    model: {
        provider: string;
        model: string;
    };
    sourceSummary: {
        notes: number;
        entries: number;
        documentInsights: number;
        attachmentSummaries: number;
    };
    diagnoses: DiagnosisSmartImportSuggestion[];
    therapies: TherapySmartImportSuggestion[];
}

interface SmartImportSourceRecord {
    id: string;
    kind: SmartImportEvidence['sourceKind'];
    label: string;
    date?: string;
    content: string;
}

type DiagnosisSearchLoader = (query: string) => Promise<ICDSearchResult[]>;
type DrugCatalogSearchLoader = (query: string) => Promise<AifaDrug[]>;

export interface ApplySmartImportResult {
    diagnosesApplied: number;
    therapiesApplied: number;
    appliedDiagnosisIds: string[];
    appliedTherapyIds: string[];
}

const THERAPY_HINT_LIMIT = 14;
const SMART_IMPORT_OUTPUT_MAX_TOKENS = 1100;
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

function normalizeText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function buildDrugCandidateKey(candidate: Pick<AifaDrug, 'aic' | 'name' | 'activePrinciple' | 'packaging'>): string {
    return [
        normalizeText(candidate.aic || ''),
        normalizeText(candidate.activePrinciple || ''),
        normalizeText(candidate.name || ''),
        normalizeText(candidate.packaging || ''),
    ].join('|');
}

function formatDiagnosisComparison(diagnosis: Pick<Diagnosis, 'system' | 'code' | 'description'>): string {
    return `${diagnosis.system} ${diagnosis.code} · ${diagnosis.description}`;
}

function tokenize(value: string): string[] {
    return normalizeText(value)
        .split(/\s+/)
        .filter((token) => token.length > 1);
}

function trimSnippet(value: string, maxLength = 260): string {
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
    const normalized = normalizeText(clause);
    if (!normalized) return false;
    if (THERAPY_SECTION_HINTS.some((hint) => normalized.includes(hint))) {
        return true;
    }

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

        if (commaParts.length > 1 && commaParts.filter(isTherapyLikeClause).length >= 2) {
            return commaParts;
        }

        return [part];
    });
}

/* @Codex */
function splitPromptSourceSegments(content: string, maxSegments = 4): string[] {
    const segments = content
        .replace(/\r/g, '\n')
        .split(/[\n;•\u2022]+/)
        .map((part) => part.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    if (segments.length <= 1) {
        return [content.replace(/\s+/g, ' ').trim()];
    }

    return segments.slice(0, maxSegments);
}

function buildTherapyCandidateHints(sources: SmartImportSourceRecord[]): Array<{ sourceId: string; label: string; excerpt: string }> {
    const seen = new Set<string>();
    const hints: Array<{ sourceId: string; label: string; excerpt: string }> = [];

    for (const source of sources) {
        const clauses = splitSourceClauses(source.content);
        for (const clause of clauses) {
            if (!isTherapyLikeClause(clause)) continue;

            for (const candidate of splitTherapyCandidateClause(clause)) {
                const excerpt = trimSnippet(candidate, 180);
                if (!excerpt) continue;

                const key = `${source.id}:${normalizeText(excerpt)}`;
                if (seen.has(key)) continue;

                seen.add(key);
                hints.push({
                    sourceId: source.id,
                    label: source.label,
                    excerpt,
                });

                if (hints.length >= THERAPY_HINT_LIMIT) {
                    return hints;
                }
            }
        }
    }

    return hints;
}

function parseDocumentInsights(raw: Patient['documentInsights']): DocumentInsight[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;

    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed as DocumentInsight[] : [];
        } catch {
            return [];
        }
    }

    return [];
}

function parseDiagnoses(raw: Patient['diagnoses']): Diagnosis[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;

    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed as Diagnosis[] : [];
        } catch {
            return [];
        }
    }

    return [];
}

function normalizeDate(value: unknown): string | undefined {
    if (!value) return undefined;
    const date = new Date(value as string | number | Date);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function buildSourceRecords(
    patient: Patient,
    entries: ClinicalEntry[],
    attachments: Array<{ id: string; name: string; summarySnapshot?: string; createdAt: Date }>
): SmartImportSourceRecord[] {
    const records: SmartImportSourceRecord[] = [];

    if (patient.notes?.trim()) {
        /* @Codex */
        splitPromptSourceSegments(patient.notes, 6).forEach((segment, index) => {
            records.push({
                id: `patient-notes:${index + 1}`,
                kind: 'patient-notes',
                label: index === 0 ? 'Note paziente' : `Note paziente · segmento ${index + 1}`,
                content: trimSnippet(segment, 900),
            });
        });
    }

    entries
        .filter((entry) => !entry.deletedAt && entry.content?.trim())
        .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
        .slice(0, 6)
        .forEach((entry) => {
            /* @Codex */
            splitPromptSourceSegments(entry.content, 4).forEach((segment, index) => {
                records.push({
                    id: `entry:${entry.id}:${index + 1}`,
                    kind: 'clinical-entry',
                    label: index === 0
                        ? `${entry.type.toUpperCase()} ${new Date(entry.date).toLocaleDateString('it-IT')}`
                        : `${entry.type.toUpperCase()} ${new Date(entry.date).toLocaleDateString('it-IT')} · segmento ${index + 1}`,
                    date: normalizeDate(entry.date),
                    content: trimSnippet(segment, 650),
                });
            });
        });

    const insightFileNames = new Set<string>();
    dedupeDocumentInsightsForContext(
        parseDocumentInsights(patient.documentInsights)
            .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    )
        .insights
        .slice(0, 4)
        .forEach((insight) => {
            const fileName = typeof insight.fileName === 'string' ? insight.fileName.trim() : '';
            if (fileName) insightFileNames.add(fileName.toLowerCase());

            const evidencePackContext = insight.evidencePack
                ? renderDocumentEvidencePackContext(insight.evidencePack, 420)
                : '';
            const extractedDiagnoses = !evidencePackContext && Array.isArray(insight.extractedData?.diagnoses)
                ? insight.extractedData.diagnoses
                    .map((item) => `${item.system} ${item.code} ${item.description}`)
                    .join(' | ')
                : '';
            /* @Codex */
            const extractedMedications = !evidencePackContext && Array.isArray(insight.extractedData?.medications)
                ? insight.extractedData.medications.join(' | ')
                : '';

            records.push({
                id: `insight:${insight.id}`,
                kind: 'document-insight',
                label: `Documento ${fileName || 'analizzato'}`,
                date: normalizeDate(insight.date),
                content: trimSnippet(
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
                content: trimSnippet(attachment.summarySnapshot || '', 500),
            });
        });

    return records;
}

function buildStructuredPrompt(
    patient: Patient,
    currentDiagnoses: Diagnosis[],
    currentTherapies: Therapy[],
    sources: SmartImportSourceRecord[]
): string {
    const therapyCandidateHints = buildTherapyCandidateHints(sources);
    const payload = {
        patientId: patient.id,
        currentDiagnoses: currentDiagnoses.map((diagnosis) => ({
            system: diagnosis.system,
            code: diagnosis.code,
            description: diagnosis.description,
        })),
        currentActiveTherapies: currentTherapies
            .filter((therapy) => therapy.status === 'active')
            .map((therapy) => ({
                drugName: therapy.drugName,
                activePrinciple: therapy.activePrinciple,
                dosage: therapy.dosage,
                aic: therapy.aic,
                atc: therapy.atc,
            })),
        therapyCandidateHints,
        sources: sources.map((source) => ({
            id: source.id,
            kind: source.kind,
            label: source.label,
            date: source.date,
            content: source.content,
        })),
    };

    return buildSmartImportExtractionPrompt(payload);
}

function parseAiPayload(response: string): ParsedAiPayload {
    return parseSmartImportExtractionResponse(response).value.data;
}

async function resolveDiagnosisSuggestion(
    suggestion: ParsedAiDiagnosis,
    sourceMap: Map<string, SmartImportSourceRecord>,
    diagnosisSearch: DiagnosisSearchLoader
): Promise<DiagnosisSmartImportSuggestion> {
    const source = sourceMap.get(suggestion.sourceId || '') || sourceMap.values().next().value as SmartImportSourceRecord | undefined;
    const query = suggestion.icdQuery || suggestion.label;
    const resolverQueries = buildDiagnosisSearchQueries(suggestion);
    let rankedCandidates: Array<{ result: ICDSearchResult; score: number; query: string }> = [];
    let match: DiagnosisSmartImportSuggestion['match'];

    try {
        const rankedByCandidate = new Map<string, { result: ICDSearchResult; score: number; query: string }>();
        for (const candidateQuery of resolverQueries) {
            const results = await diagnosisSearch(candidateQuery);
            for (const result of results) {
                const score = rankIcdMatch(candidateQuery, suggestion.label, suggestion.explicitCode, result);
                const key = `${result.code}|${normalizeText(result.description)}`;
                const previous = rankedByCandidate.get(key);
                if (!previous || score > previous.score) {
                    rankedByCandidate.set(key, { result, score, query: candidateQuery });
                }
            }
        }

        rankedCandidates = Array.from(rankedByCandidate.values())
            .sort((left, right) => right.score - left.score);

        const best = rankedCandidates[0];
        if (best && best.score >= 8 && best.result.code !== 'N/A') {
            match = {
                code: best.result.code,
                description: best.result.description,
                system: 'ICD-11',
            };
        }
    } catch {
        match = undefined;
    }

    return {
        id: `diagnosis:${suggestion.label}:${suggestion.explicitCode || suggestion.icdQuery}`,
        label: suggestion.label,
        icdQuery: query,
        confidence: suggestion.confidence,
        evidence: {
            sourceKind: source?.kind || 'patient-notes',
            sourceId: source?.id || 'patient-notes',
            label: source?.label || 'Fonte paziente',
            excerpt: trimSnippet(suggestion.evidence, 180),
            date: source?.date,
        },
        explicitCode: suggestion.explicitCode,
        match,
        canApply: Boolean(match),
        blockedReason: match ? undefined : 'Nessun match ICD-11 affidabile',
        review: {
            state: 'uncertain',
            summary: '',
        },
        resolver: {
            queries: resolverQueries,
            candidates: rankedCandidates.slice(0, 3).map((candidate) => ({
                code: candidate.result.code,
                description: candidate.result.description,
                query: candidate.query,
                score: candidate.score,
                selected: Boolean(match)
                    && candidate.result.code === match?.code
                    && normalizeText(candidate.result.description) === normalizeText(match?.description || ''),
            })),
        },
    };
}

async function searchDrugCatalog(query: string): Promise<AifaDrug[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const response = await fetch(`/api/drugs?q=${encodeURIComponent(trimmed)}`, { cache: 'no-store' });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload as AifaDrug[] : [];
}

function findExistingDiagnosisMatch(
    existing: Diagnosis[],
    suggestion: DiagnosisSmartImportSuggestion
): Diagnosis | undefined {
    if (!suggestion.match) return undefined;

    return existing.find((diagnosis) => (
        normalizeText(diagnosis.system) === normalizeText(suggestion.match?.system || '')
        && normalizeText(diagnosis.code) === normalizeText(suggestion.match?.code || '')
    ));
}

function sortDiagnosisSuggestions(
    left: DiagnosisSmartImportSuggestion,
    right: DiagnosisSmartImportSuggestion
): number {
    const score = (item: DiagnosisSmartImportSuggestion) => {
        let total = item.canApply ? 30 : 0;
        if (item.match) total += 12;
        if (item.confidence === 'high') total += 8;
        if (item.confidence === 'medium') total += 4;
        if (item.explicitCode) total += 4;
        return total;
    };

    return score(right) - score(left) || left.label.localeCompare(right.label, 'it');
}

function sortTherapySuggestions(
    left: TherapySmartImportSuggestion,
    right: TherapySmartImportSuggestion
): number {
    const score = (item: TherapySmartImportSuggestion) => {
        let total = item.canApply ? 40 : 0;
        if (item.matchType === 'catalog') total += 18;
        if (item.matchType === 'manual') total += 8;
        if (item.therapyState === 'active') total += 10;
        if (item.therapyState === 'transition') total += 4;
        if (item.confidence === 'high') total += 8;
        if (item.confidence === 'medium') total += 4;
        if (item.dosage) total += 6;
        return total;
    };

    return score(right) - score(left) || left.drugMention.localeCompare(right.drugMention, 'it');
}

function classifyTherapyState(
    suggestion: ParsedAiTherapy,
): TherapySuggestionState {
    if (suggestion.therapyState && suggestion.therapyState !== 'active') {
        return suggestion.therapyState;
    }

    const probe = normalizeText([
        suggestion.drugMention,
        suggestion.drugQuery,
        suggestion.activePrinciple,
        suggestion.dosage,
        suggestion.motivation,
        suggestion.reviewNote,
        suggestion.evidence,
    ].filter(Boolean).join(' '));

    if (
        /switch|passa a|passare a|sostit|transizion|scal|titol|sospend(?:ere|e).*(iniz|pass|switch|sostit)/.test(probe)
    ) {
        return 'transition';
    }

    if (/da verificare|da confermare|incert|non chiar|dubb|valutar|\?/.test(probe)) {
        return 'uncertain';
    }

    if (/sospes|interrott|stop|terminat|conclus|discontinuat/.test(probe)) {
        return 'inactive';
    }

    return suggestion.therapyState || 'active';
}

function canDirectlyApplyTherapySuggestion(
    state: TherapySuggestionState,
    matchType: TherapySuggestionMatchType
): boolean {
    return state === 'active' && matchType === 'catalog';
}

function buildTherapyBlockedReason(
    state: TherapySuggestionState,
    matchType: TherapySuggestionMatchType,
    reviewNote: string | undefined
): string | undefined {
    if (state === 'active') {
        if (matchType === 'manual') return 'Match AIFA da confermare prima dell\'import';
        if (matchType === 'none') return 'Nessun match farmaco affidabile';
        return undefined;
    }
    if (reviewNote) return reviewNote;
    if (state === 'transition') return 'Transizione terapeutica da confermare prima dell\'import';
    if (state === 'uncertain') return 'Terapia citata come incerta o da verificare';
    return 'Terapia non attiva nelle fonti correnti';
}

function buildDiagnosisReview(
    suggestion: DiagnosisSmartImportSuggestion,
    existingDiagnosis: Diagnosis | undefined
): SmartImportReview {
    if (existingDiagnosis) {
        return {
            state: 'already-present',
            summary: 'Diagnosi gia presente nel profilo paziente',
            comparison: formatDiagnosisComparison(existingDiagnosis),
        };
    }

    if (!suggestion.canApply || !suggestion.match) {
        return {
            state: 'uncertain',
            summary: suggestion.blockedReason || 'Diagnosi da verificare prima dell\'import',
        };
    }

    return {
        state: 'new',
        summary: suggestion.confidence === 'high'
            ? 'Nuova diagnosi con match ICD-11 pronto per revisione'
            : 'Nuova diagnosi proposta con confidenza da confermare',
        comparison: formatDiagnosisComparison(suggestion.match),
    };
}

async function resolveTherapySuggestion(
    suggestion: ParsedAiTherapy,
    sourceMap: Map<string, SmartImportSourceRecord>,
    drugCatalogSearch: DrugCatalogSearchLoader
): Promise<TherapySmartImportSuggestion> {
    const source = sourceMap.get(suggestion.sourceId || '') || sourceMap.values().next().value as SmartImportSourceRecord | undefined;
    const searchTerms = buildDrugSearchTerms(suggestion).slice(0, 6);
    const rankedByCandidate = new Map<string, {
        candidate: AifaDrug;
        score: number;
        searchTerm: string;
        dosageAligned: boolean;
    }>();
    let match: TherapySmartImportSuggestion['match'];
    let matchType: TherapySmartImportSuggestion['matchType'] = 'none';
    const therapyState = classifyTherapyState(suggestion);

    for (const term of searchTerms) {
        const candidates = await drugCatalogSearch(term);
        if (!candidates.length) continue;

        for (const candidate of candidates) {
            const key = buildDrugCandidateKey(candidate);
            const score = rankDrugMatch(candidate, suggestion);
            const dosageAligned = !hasDrugDosageConflict(candidate, suggestion);
            const previous = rankedByCandidate.get(key);

            if (!previous || score > previous.score) {
                rankedByCandidate.set(key, {
                    candidate,
                    score,
                    searchTerm: term,
                    dosageAligned,
                });
            }
        }
    }

    const rankedCandidates = Array.from(rankedByCandidate.values())
        .sort((left, right) => right.score - left.score);
    const selected = selectTherapyCatalogMatch(
        suggestion,
        rankedCandidates.map((item) => item.candidate),
    );

    if (selected) {
        match = {
            aic: selected.aic,
            name: selected.name,
            activePrinciple: selected.activePrinciple,
            atc: selected.atc,
            company: selected.company,
        };
        matchType = 'catalog';
    }

    if (!match && (suggestion.activePrinciple || suggestion.drugMention)) {
        matchType = 'manual';
    }

    const canApply = canDirectlyApplyTherapySuggestion(therapyState, matchType);
    const blockedReason = buildTherapyBlockedReason(therapyState, matchType, suggestion.reviewNote);

    return {
        id: `therapy:${suggestion.drugMention}:${suggestion.dosage || ''}:${suggestion.activePrinciple || ''}`,
        drugMention: suggestion.drugMention,
        drugQuery: suggestion.drugQuery,
        activePrinciple: suggestion.activePrinciple,
        dosage: suggestion.dosage,
        motivation: suggestion.motivation,
        therapyState,
        reviewNote: suggestion.reviewNote,
        confidence: suggestion.confidence,
        evidence: {
            sourceKind: source?.kind || 'patient-notes',
            sourceId: source?.id || 'patient-notes',
            label: source?.label || 'Fonte paziente',
            excerpt: trimSnippet(suggestion.evidence, 180),
            date: source?.date,
        },
        matchType,
        match,
        canApply,
        blockedReason,
        review: {
            state: 'uncertain',
            summary: '',
        },
        resolver: {
            searchTerms,
            candidates: rankedCandidates.slice(0, 3).map((item) => ({
                aic: item.candidate.aic,
                name: item.candidate.name,
                activePrinciple: item.candidate.activePrinciple,
                packaging: item.candidate.packaging,
                atc: item.candidate.atc,
                searchTerm: item.searchTerm,
                score: item.score,
                dosageAligned: item.dosageAligned,
                selected: Boolean(match) && (
                    (Boolean(match?.aic) && item.candidate.aic === match?.aic)
                    || (
                        normalizeText(item.candidate.name) === normalizeText(match?.name || '')
                        && normalizeText(item.candidate.activePrinciple || '') === normalizeText(match?.activePrinciple || '')
                    )
                ),
            })),
        },
    };
}

export async function generatePatientSmartImportAnalysis(patientId: string): Promise<PatientSmartImportAnalysis> {
    const smartImportKillSwitch = await db.settings.get(AI_SMART_IMPORT_KILL_SWITCH_KEY);
    assertAiSmartImportEnabledValue(smartImportKillSwitch?.value);

    const patient = await db.patients.get(patientId);
    if (!patient) throw new Error('Paziente non trovato');

    const [entries, attachments, currentTherapies] = await Promise.all([
        db.entries.filter((entry: ClinicalEntry) => entry.patientId === patientId).toArray(),
        db.attachments.filter((attachment: { patientId: string }) => attachment.patientId === patientId).toArray(),
        db.therapies.filter((therapy: Therapy) => therapy.patientId === patientId).toArray(),
    ]);

    const sourceRecords = buildSourceRecords(patient, entries, attachments);
    if (sourceRecords.length === 0) {
        throw new Error('Nessuna sorgente disponibile per lo smart import');
    }

    const currentDiagnoses = parseDiagnoses(patient.diagnoses);
    const ai = await AIService.create('clinical');
    const prompt = buildStructuredPrompt(patient, currentDiagnoses, currentTherapies, sourceRecords);
    const response = await ai.generate(prompt, undefined, SMART_IMPORT_OUTPUT_MAX_TOKENS);
    const parsed = parseAiPayload(response);
    const sourceMap = new Map(sourceRecords.map((source) => [source.id, source]));
    const diagnosisSearchCache = new Map<string, Promise<ICDSearchResult[]>>();
    const drugSearchCache = new Map<string, Promise<AifaDrug[]>>();
    const diagnosisSearch: DiagnosisSearchLoader = (query) => {
        const key = query.trim();
        if (!diagnosisSearchCache.has(key)) {
            diagnosisSearchCache.set(key, searchICDHybrid(key));
        }
        return diagnosisSearchCache.get(key)!;
    };
    const drugCatalogSearch: DrugCatalogSearchLoader = (query) => {
        const key = query.trim().toLowerCase();
        if (!drugSearchCache.has(key)) {
            drugSearchCache.set(key, searchDrugCatalog(query));
        }
        return drugSearchCache.get(key)!;
    };

    const [resolvedDiagnoses, resolvedTherapies] = await Promise.all([
        Promise.all(parsed.diagnoses.map((diagnosis) => resolveDiagnosisSuggestion(diagnosis, sourceMap, diagnosisSearch))),
        Promise.all(parsed.therapies.map((therapy) => resolveTherapySuggestion(therapy, sourceMap, drugCatalogSearch))),
    ]);

    const diagnoses = resolvedDiagnoses.map((diagnosis) => {
        const existingDiagnosis = findExistingDiagnosisMatch(currentDiagnoses, diagnosis);
        const canApply = existingDiagnosis ? false : diagnosis.canApply;
        const blockedReason = existingDiagnosis ? 'Diagnosi gia presente in scheda' : diagnosis.blockedReason;
        const nextSuggestion: DiagnosisSmartImportSuggestion = {
            ...diagnosis,
            canApply,
            blockedReason,
            review: buildDiagnosisReview(
                {
                    ...diagnosis,
                    canApply,
                    blockedReason,
                    review: diagnosis.review,
                },
                existingDiagnosis
            ),
        };

        return nextSuggestion;
    }).sort(sortDiagnosisSuggestions);
    const therapySuggestions = resolvedTherapies.map((therapy) => {
        const review = buildTherapyReview(currentTherapies, therapy);
        const canApply = review.state === 'new' ? therapy.canApply : false;
        let blockedReason = therapy.blockedReason;

        if (review.state === 'already-present') {
            blockedReason = 'Terapia gia presente in storico';
        } else if (review.state === 'update') {
            blockedReason = 'Possibile aggiornamento di terapia gia presente';
        } else if (review.state === 'transition') {
            blockedReason = 'Transizione terapeutica documentata: conferma manuale richiesta';
        } else if (review.state === 'inactive') {
            blockedReason = 'Terapia sospesa o conclusa nelle fonti correnti';
        }

        return {
            ...therapy,
            canApply,
            blockedReason,
            review,
        };
    }).sort(sortTherapySuggestions);

    return {
        generatedAt: new Date().toISOString(),
        model: {
            provider: ai.getModelInfo().provider,
            model: ai.getModelInfo().model,
        },
        sourceSummary: {
            notes: patient.notes?.trim() ? 1 : 0,
            entries: sourceRecords.filter((source) => source.kind === 'clinical-entry').length,
            documentInsights: sourceRecords.filter((source) => source.kind === 'document-insight').length,
            attachmentSummaries: sourceRecords.filter((source) => source.kind === 'attachment-summary').length,
        },
        diagnoses,
        therapies: therapySuggestions,
    };
}

function diagnosisExists(existing: Diagnosis[], suggestion: DiagnosisSmartImportSuggestion): boolean {
    return Boolean(findExistingDiagnosisMatch(existing, suggestion));
}

function normalizeTherapyKey(therapy: Pick<Therapy, 'drugName' | 'activePrinciple' | 'dosage' | 'aic'>): string {
    return [
        normalizeText(therapy.aic || ''),
        normalizeText(therapy.activePrinciple || ''),
        normalizeText(therapy.drugName || ''),
        normalizeText(therapy.dosage || ''),
    ].join('|');
}

function therapyExists(existing: Therapy[], suggestion: TherapySmartImportSuggestion): boolean {
    const probe: Pick<Therapy, 'drugName' | 'activePrinciple' | 'dosage' | 'aic'> = {
        drugName: suggestion.match?.name || suggestion.drugMention,
        activePrinciple: suggestion.match?.activePrinciple || suggestion.activePrinciple,
        dosage: suggestion.dosage || '',
        aic: suggestion.match?.aic,
    };
    const probeKey = normalizeTherapyKey(probe);

    return existing.some((therapy) => normalizeTherapyKey(therapy) === probeKey);
}

export async function applyPatientSmartImportSelection(
    patientId: string,
    analysis: PatientSmartImportAnalysis,
    selection: {
        diagnosisIds: string[];
        therapyIds: string[];
    }
): Promise<ApplySmartImportResult> {
    const smartImportKillSwitch = await db.settings.get(AI_SMART_IMPORT_KILL_SWITCH_KEY);
    assertAiSmartImportEnabledValue(smartImportKillSwitch?.value);

    const patient = await db.patients.get(patientId);
    if (!patient) throw new Error('Paziente non trovato');
    if (typeof patient.version !== 'number') {
        throw new Error('Missing patient version for smart import apply.');
    }

    const selectedDiagnoses = analysis.diagnoses.filter((diagnosis) => selection.diagnosisIds.includes(diagnosis.id));
    const selectedTherapies = analysis.therapies.filter((therapy) => selection.therapyIds.includes(therapy.id));

    const existingDiagnoses = parseDiagnoses(patient.diagnoses);
    const existingTherapies = await db.therapies.filter((therapy: Therapy) => therapy.patientId === patientId).toArray();
    const nextDiagnoses = [...existingDiagnoses];
    const appliedDiagnosisIds: string[] = [];

    for (const suggestion of selectedDiagnoses) {
        if (!suggestion.canApply || !suggestion.match) continue;
        if (diagnosisExists(nextDiagnoses, suggestion)) continue;

        nextDiagnoses.push({
            system: suggestion.match.system,
            code: suggestion.match.code,
            description: suggestion.reviewedLabel?.trim() || suggestion.label.trim() || suggestion.match.description,
            date: new Date(),
        });
        appliedDiagnosisIds.push(suggestion.id);
    }

    const therapyItems: Therapy[] = [];
    const appliedTherapyIds: string[] = [];
    for (const suggestion of selectedTherapies) {
        if (!suggestion.canApply || suggestion.matchType !== 'catalog' || !suggestion.match) continue;
        if (therapyExists([...existingTherapies, ...therapyItems], suggestion)) continue;

        therapyItems.push({
            id: crypto.randomUUID(),
            patientId,
            drugName: suggestion.reviewedDrugName?.trim() || suggestion.match?.name || suggestion.drugMention,
            aic: suggestion.match?.aic,
            atc: suggestion.match?.atc,
            activePrinciple: suggestion.reviewedActivePrinciple?.trim() || suggestion.match?.activePrinciple || suggestion.activePrinciple,
            dosage: suggestion.reviewedDosage?.trim() || suggestion.dosage || 'Posologia da verificare',
            motivation: suggestion.reviewedMotivation?.trim() || suggestion.motivation || suggestion.evidence.excerpt,
            status: 'active',
            startDate: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        appliedTherapyIds.push(suggestion.id);
    }

    const createdTherapyIds: string[] = [];
    try {
        for (const therapyItem of therapyItems) {
            await db.therapies.add(therapyItem, { suppressNotify: true });
            createdTherapyIds.push(therapyItem.id);
        }

        if (appliedDiagnosisIds.length > 0) {
            await db.patients.update(patientId, {
                diagnoses: nextDiagnoses,
                version: patient.version,
                updatedAt: new Date(),
            });
        } else if (createdTherapyIds.length > 0) {
            notifyDbChange();
        }
    } catch (error) {
        for (const therapyId of createdTherapyIds) {
            await db.therapies.delete(therapyId, { suppressNotify: true }).catch(() => null);
        }
        if (createdTherapyIds.length > 0) {
            notifyDbChange();
        }
        throw error;
    }

    if (appliedDiagnosisIds.length > 0 || appliedTherapyIds.length > 0) {
        await regeneratePatientSummary(patientId).catch(() => null);
    }

    return {
        diagnosesApplied: appliedDiagnosisIds.length,
        therapiesApplied: appliedTherapyIds.length,
        appliedDiagnosisIds,
        appliedTherapyIds,
    };
}
