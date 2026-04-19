import {
    type SmartImportDiagnosisExtraction as ParsedAiDiagnosis,
    type SmartImportTherapyExtraction as ParsedAiTherapy,
} from './ai-task-contracts';
import { type AifaDrug, type Therapy } from './db';

export type SmartImportReviewState =
    | 'new'
    | 'already-present'
    | 'update'
    | 'transition'
    | 'inactive'
    | 'uncertain';

export interface SmartImportReview {
    state: SmartImportReviewState;
    summary: string;
    comparison?: string;
}

export interface TherapyReviewCandidate {
    drugMention: string;
    activePrinciple?: string;
    dosage?: string;
    therapyState: 'active' | 'transition' | 'uncertain' | 'inactive';
    matchType: 'catalog' | 'manual' | 'none';
    match?: Pick<AifaDrug, 'aic' | 'name' | 'activePrinciple'>;
    canApply: boolean;
    blockedReason?: string;
}

type TherapyStateClassificationInput = Pick<
    ParsedAiTherapy,
    'drugMention' | 'drugQuery' | 'activePrinciple' | 'dosage' | 'motivation' | 'reviewNote' | 'evidence' | 'therapyState'
>;

const DOSAGE_TOKEN_GLOBAL_REGEX = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u|cp|cps|cpr|caps(?:ule)?|compress(?:a|e)|gtt|fial(?:a|e)|spruzzi?)\b/gi;
const DRUG_QUERY_STOPWORDS = new Set([
    'al', 'alla', 'alle', 'con', 'da', 'del', 'della', 'dopo', 'fare', 'giorno', 'giorni',
    'mattino', 'mezza', 'ogni', 'per', 'poi', 'pranzo', 'prima', 'sera', 'volta', 'volte',
    'verificare', 'confermare', 'dose', 'dosi', 'ore', 'uno', 'una', 'due', 'tre', 'quattro',
]);
const INGREDIENT_STOPWORDS = new Set([
    'acetato', 'cloridrato', 'fosfato', 'potassio', 'sale', 'sesquidrato', 'sodica', 'sodico',
]);
const NO_NOVELTY_BACKGROUND_MARKERS = /\b(gia noto|gia presente|profilo cronico|cronico|stabile|terapia domiciliare|domiciliar)\b/;
const NO_NOVELTY_FOLLOW_UP_MARKERS = /\b(controllo|follow up|richiesta di visita|impegnativa|rivalutaz|valutare)\b/;
const NO_NOVELTY_CONTINUATION_MARKERS = /\b(continuare|proseguire|mantenere|come da piano in corso|senza variazioni|senza novita|nessuna novita|nessun cambiamento)\b/;
const NO_NOVELTY_CHANGE_MARKERS = /\b(nuov|peggior|riacut|acut|switch|passare a|sostit|sospend|interromp|inizia|introd|increment|aument|ridurr|modifica posolog|titolaz|decrement|dimission)\b/;

function normalizeText(value: string | undefined): string {
    return (value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/* @Codex */
export function hasUsableTherapyDosage(value: string | undefined): boolean {
    const normalized = normalizeText(value);
    if (!normalized) return false;

    return !/da verificare|da confermare|non chiar|non nota|non disponibile|sconosciut|incert|dubb|valutar|\bn a\b/.test(normalized);
}

/* @Codex */
export function isNoClinicalNoveltyContext(value: string | undefined): boolean {
    const normalized = normalizeText(value);
    if (!normalized) return false;
    if (NO_NOVELTY_CHANGE_MARKERS.test(normalized)) return false;

    const hasBackground = NO_NOVELTY_BACKGROUND_MARKERS.test(normalized);
    const hasFollowUp = NO_NOVELTY_FOLLOW_UP_MARKERS.test(normalized);
    const hasContinuation = NO_NOVELTY_CONTINUATION_MARKERS.test(normalized);

    return (hasBackground && hasFollowUp)
        || (hasBackground && hasContinuation)
        || (hasFollowUp && hasContinuation);
}

/* @Codex */
export function classifyExtractedTherapyState(input: TherapyStateClassificationInput): TherapyReviewCandidate['therapyState'] {
    const explicitState = input.therapyState;
    const probe = normalizeText([
        input.drugMention,
        input.drugQuery,
        input.activePrinciple,
        input.dosage,
        input.motivation,
        input.reviewNote,
        input.evidence,
    ].filter(Boolean).join(' '));

    const switchLike = /switch|passa a|passare a|sostit|transizion|scal|titol|sospend(?:ere|e).*(?:iniz|pass|switch|sostit)/.test(probe);
    const consultiveLike = /proporr|propost|considerar|eventual|se necessario|al bisogno|\bprn\b|rivalutar|da rivalutare|monitorare prima|trial terapeutico/.test(probe);
    const titrationLike = /aumentar|incrementar|ridurr|decrementar|modifica posolog|titolaz|titolare|portare a/.test(probe);

    if (explicitState === 'inactive' && switchLike) return 'transition';
    if (consultiveLike && !switchLike) return 'uncertain';
    if (titrationLike && !switchLike && !consultiveLike) return 'active';
    if (explicitState === 'transition') return 'transition';
    if (explicitState === 'uncertain') return 'uncertain';
    if (explicitState === 'inactive') return 'inactive';

    if (switchLike) {
        return 'transition';
    }

    if (consultiveLike) {
        return 'uncertain';
    }

    if (titrationLike) {
        return 'active';
    }

    if (/da verificare|da confermare|incert|non chiar|dubb|valutar|\?/.test(probe)) {
        return 'uncertain';
    }

    if (/sospes|interrott|stop|terminat|conclus|discontinuat/.test(probe)) {
        return 'inactive';
    }

    return explicitState || 'active';
}

function tokenize(value: string): string[] {
    return normalizeText(value)
        .split(/\s+/)
        .filter((token) => token.length > 1);
}

function formatTherapyComparison(therapy: Pick<Therapy, 'drugName' | 'activePrinciple' | 'dosage' | 'status'>): string {
    const details = [
        therapy.activePrinciple?.trim(),
        therapy.dosage?.trim(),
        therapy.status ? `stato ${therapy.status}` : undefined,
    ].filter(Boolean);

    return [therapy.drugName.trim(), details.length > 0 ? `(${details.join(' · ')})` : undefined]
        .filter(Boolean)
        .join(' ');
}

function normalizeTherapyKey(
    therapy: Pick<Therapy, 'drugName' | 'activePrinciple' | 'dosage' | 'aic'>
): string {
    return [
        normalizeText(therapy.aic || ''),
        normalizeText(therapy.activePrinciple || ''),
        normalizeText(therapy.drugName || ''),
        normalizeText(therapy.dosage || ''),
    ].join('|');
}

function findRelatedExistingTherapy(
    existing: Therapy[],
    suggestion: TherapyReviewCandidate
): Therapy | undefined {
    const probeAic = normalizeText(suggestion.match?.aic || '');
    const probePrinciple = normalizeText(suggestion.match?.activePrinciple || suggestion.activePrinciple || '');
    const probeName = normalizeText(suggestion.match?.name || suggestion.drugMention);

    return existing.find((therapy) => {
        const existingAic = normalizeText(therapy.aic || '');
        const existingPrinciple = normalizeText(therapy.activePrinciple || '');
        const existingName = normalizeText(therapy.drugName || '');

        if (probeAic && existingAic === probeAic) return true;
        if (probePrinciple && existingPrinciple === probePrinciple) return true;
        return Boolean(probeName && existingName === probeName);
    });
}

export function buildTherapyReview(
    existing: Therapy[],
    suggestion: TherapyReviewCandidate
): SmartImportReview {
    const exactMatch = existing.find((therapy) => normalizeTherapyKey(therapy) === normalizeTherapyKey({
        drugName: suggestion.match?.name || suggestion.drugMention,
        activePrinciple: suggestion.match?.activePrinciple || suggestion.activePrinciple,
        dosage: suggestion.dosage || '',
        aic: suggestion.match?.aic,
    }));
    const relatedExisting = findRelatedExistingTherapy(existing, suggestion);
    const comparisonCandidate = exactMatch || relatedExisting;

    if (suggestion.therapyState === 'transition') {
        return {
            state: 'transition',
            summary: suggestion.matchType === 'catalog'
                ? 'Transizione terapeutica documentata: richiede conferma manuale prima dell\'import'
                : 'Cambio terapia documentato ma non ancora riconciliato con il catalogo',
            comparison: comparisonCandidate ? formatTherapyComparison(comparisonCandidate) : undefined,
        };
    }

    if (suggestion.therapyState === 'inactive') {
        return {
            state: 'inactive',
            summary: 'Terapia sospesa o conclusa nelle fonti: non proporre import attivo',
            comparison: comparisonCandidate ? formatTherapyComparison(comparisonCandidate) : undefined,
        };
    }

    if (exactMatch) {
        return {
            state: 'already-present',
            summary: 'Terapia gia presente nello storico paziente',
            comparison: formatTherapyComparison(exactMatch),
        };
    }

    if (
        relatedExisting
        && suggestion.therapyState === 'active'
        && suggestion.matchType !== 'none'
    ) {
        return {
            state: 'update',
            summary: 'Possibile aggiornamento di terapia gia presente: richiede revisione manuale',
            comparison: formatTherapyComparison(relatedExisting),
        };
    }

    if (!suggestion.canApply) {
        return {
            state: 'uncertain',
            summary: suggestion.blockedReason || 'Terapia da verificare prima dell\'import',
        };
    }

    return {
        state: 'new',
        summary: suggestion.matchType === 'catalog'
            ? 'Nuova terapia pronta per import con match catalogo AIFA'
            : 'Nuova terapia reviewable con completamento manuale consigliato',
    };
}

function uniqueTokens(values: string[]): string[] {
    return Array.from(new Set(values));
}

function overlapScore(candidate: string, tokens: string[]): number {
    const haystack = normalizeText(candidate);
    return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

export function rankIcdMatch(
    query: string,
    label: string,
    explicitCode: string | undefined,
    candidate: { code: string; description: string }
): number {
    if (!candidate.code || candidate.code === 'N/A') return -1;

    const queryTokens = uniqueTokens(tokenize(query));
    const labelTokens = uniqueTokens(tokenize(label));
    let score = overlapScore(candidate.description, queryTokens) * 6;
    score += overlapScore(candidate.description, labelTokens) * 4;

    if (explicitCode && candidate.code.toUpperCase() === explicitCode.toUpperCase()) {
        score += 100;
    }
    if (normalizeText(candidate.description).includes(normalizeText(label))) {
        score += 15;
    }

    return score;
}

export function sanitizeDrugSearchText(value: string): string {
    return value
        .replace(/\([^)]*\)/g, ' ')
        .replace(DOSAGE_TOKEN_GLOBAL_REGEX, ' ')
        .replace(/\b(?:x|die|bid|tid|ore|mattino|sera|pranzo|colazione|giorno|giorni|settimana|settimane|verificare|confermare|dose|dosi|cp|cps|cpr|caps(?:ule)?|compress(?:a|e)|gtt|fial(?:a|e)|spruzzi?)\b/gi, ' ')
        .replace(/[,:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function buildDrugSearchTerms(suggestion: ParsedAiTherapy): string[] {
    const terms = new Set<string>();
    const sources = [suggestion.activePrinciple, suggestion.drugQuery, suggestion.drugMention];

    for (const source of sources) {
        if (!source?.trim()) continue;

        const raw = source.replace(/\s+/g, ' ').trim();
        const cleaned = sanitizeDrugSearchText(raw);
        const segments = [raw, cleaned, ...raw.split(/\s*\/\s*|\s*\+\s*|,(?!\d)|\b(?:poi|quindi|successivamente)\b/i)];

        for (const segment of segments) {
            const compact = sanitizeDrugSearchText(segment);
            if (compact.length >= 2) {
                terms.add(compact);
            }
        }

        const tokens = tokenize(cleaned).filter((token) => token.length >= 4 && !DRUG_QUERY_STOPWORDS.has(token));
        for (const token of tokens) {
            terms.add(token);
        }
        if (tokens.length >= 2) {
            terms.add(tokens.slice(0, 2).join(' '));
        }
    }

    return Array.from(terms).sort((left, right) => right.length - left.length);
}

function normalizeDosageNeedle(value: string): string {
    return value.toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
}

function extractDosageNeedles(value: string | undefined): string[] {
    if (!value?.trim()) return [];

    const matches = value.match(/\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u)\b/gi) || [];
    return Array.from(new Set(matches.map((item) => normalizeDosageNeedle(item))));
}

export function extractSuggestionDosageNeedles(suggestion: ParsedAiTherapy): string[] {
    return Array.from(new Set([
        ...extractDosageNeedles(suggestion.dosage),
        ...extractDosageNeedles(suggestion.drugMention),
    ]));
}

function extractCandidateDosageNeedles(candidate: Pick<AifaDrug, 'name' | 'packaging'>): string[] {
    return Array.from(new Set([
        ...extractDosageNeedles(candidate.name),
        ...extractDosageNeedles(candidate.packaging),
    ]));
}

function hasAdministrationDoseSyntax(suggestion: ParsedAiTherapy): boolean {
    const probe = normalizeText(`${suggestion.dosage || ''} ${suggestion.drugMention || ''}`);
    return /\b(ai pasti|colazione|pranzo|sera|mattino|ogni|q\d+h|sottocute|ore|die)\b/.test(probe);
}

function candidateRepresentsInjectableConcentration(candidate: Pick<AifaDrug, 'name' | 'packaging'>): boolean {
    const probe = `${candidate.name || ''} ${candidate.packaging || ''}`;
    return /\/\s*ml\b|soluzione iniettabile|siringh|cartucc|pen\b/i.test(probe);
}

function splitIngredientComponents(value: string): string[] {
    return value
        .split(/\s*\/\s*|\s*\+\s*|\s+\be\b\s+/i)
        .map((item) => normalizeText(item))
        .map((item) => item
            .split(/\s+/)
            .filter((token) => token.length > 2 && !INGREDIENT_STOPWORDS.has(token))
            .slice(0, 1)
            .join(' '))
        .filter(Boolean);
}

function suggestionReferencesCatalogBrand(candidate: AifaDrug, suggestion: ParsedAiTherapy): boolean {
    const normalizedCandidateName = normalizeText(candidate.name || '');
    const normalizedMention = normalizeText(sanitizeDrugSearchText(suggestion.drugMention));
    const normalizedQuery = normalizeText(sanitizeDrugSearchText(suggestion.drugQuery));

    return Boolean(
        normalizedCandidateName
        && (normalizedCandidateName === normalizedMention || normalizedCandidateName === normalizedQuery),
    );
}

function suggestionMentionsMultipleIngredients(suggestion: ParsedAiTherapy): boolean {
    const probe = `${suggestion.drugMention || ''} ${suggestion.drugQuery || ''} ${suggestion.activePrinciple || ''}`;
    return /\s*\/\s*|\s*\+\s*|\s+\be\b\s+/i.test(probe);
}

function candidateAddsUnexpectedCombinationIngredient(candidate: AifaDrug, suggestion: ParsedAiTherapy): boolean {
    if (suggestionReferencesCatalogBrand(candidate, suggestion) || suggestionMentionsMultipleIngredients(suggestion)) {
        return false;
    }

    const components = splitIngredientComponents(candidate.activePrinciple || '');
    if (components.length <= 1) return false;

    const suggestionProbe = normalizeText([
        sanitizeDrugSearchText(suggestion.drugMention),
        sanitizeDrugSearchText(suggestion.drugQuery),
        sanitizeDrugSearchText(suggestion.activePrinciple || ''),
    ].join(' '));

    const matched = components.filter((component) => suggestionProbe.includes(component));
    return matched.length > 0 && matched.length < components.length;
}

function overlapCount(candidate: string, tokens: string[]): number {
    const haystack = normalizeText(candidate);
    return tokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0);
}

/* @Codex */
function queryLooksSingleIngredient(query: string): boolean {
    if (/\s*\/\s*|\s*\+\s*|\s+\be\b\s+/i.test(query)) {
        return false;
    }

    const tokens = uniqueTokens(tokenize(sanitizeDrugSearchText(query)))
        .filter((token) => token.length >= 4 && !DRUG_QUERY_STOPWORDS.has(token));

    return tokens.length > 0 && tokens.length <= 2;
}

/* @Codex */
function candidateHasCombinationActivePrinciple(candidate: AifaDrug): boolean {
    return splitIngredientComponents(candidate.activePrinciple || '').length > 1;
}

function hasStrongDrugIdentityMatch(candidate: AifaDrug, suggestion: ParsedAiTherapy): boolean {
    if (candidateAddsUnexpectedCombinationIngredient(candidate, suggestion)) {
        return false;
    }

    const candidateText = `${candidate.name} ${candidate.activePrinciple || ''}`;
    const normalizedCandidateName = normalizeText(candidate.name || '');
    const normalizedCandidatePrinciple = normalizeText(candidate.activePrinciple || '');
    const normalizedMention = normalizeText(sanitizeDrugSearchText(suggestion.drugMention));
    const normalizedPrinciple = normalizeText(sanitizeDrugSearchText(suggestion.activePrinciple || ''));
    const mentionTokens = uniqueTokens(tokenize(sanitizeDrugSearchText(suggestion.drugMention))).filter((token) => token.length >= 4);
    const principleTokens = uniqueTokens(tokenize(sanitizeDrugSearchText(suggestion.activePrinciple || ''))).filter((token) => token.length >= 4);

    if (normalizedMention && (normalizedCandidateName === normalizedMention || normalizedCandidateName.includes(normalizedMention))) {
        return true;
    }
    if (normalizedPrinciple && (normalizedCandidatePrinciple === normalizedPrinciple || normalizedCandidatePrinciple.includes(normalizedPrinciple))) {
        return true;
    }
    if (mentionTokens.length > 0 && overlapCount(candidateText, mentionTokens) >= Math.min(2, mentionTokens.length)) {
        return true;
    }
    if (principleTokens.length > 0 && overlapCount(candidateText, principleTokens) >= Math.min(2, principleTokens.length)) {
        return true;
    }
    return false;
}

export function hasDrugDosageConflict(candidate: AifaDrug, suggestion: ParsedAiTherapy): boolean {
    const expectedNeedles = extractSuggestionDosageNeedles(suggestion);
    if (expectedNeedles.length === 0) return false;

    const candidateNeedles = extractCandidateDosageNeedles(candidate);
    if (candidateNeedles.length === 0) return false;

    if (candidateNeedles.some((needle) => expectedNeedles.includes(needle))) {
        return false;
    }

    if (hasAdministrationDoseSyntax(suggestion) && candidateRepresentsInjectableConcentration(candidate)) {
        return false;
    }

    return true;
}

export function rankDrugMatch(candidate: AifaDrug, suggestion: ParsedAiTherapy): number {
    const queryTokens = uniqueTokens(tokenize(suggestion.drugQuery));
    const principleTokens = uniqueTokens(tokenize(suggestion.activePrinciple || ''));
    const mentionTokens = uniqueTokens(tokenize(suggestion.drugMention));
    const expectedDosageNeedles = extractSuggestionDosageNeedles(suggestion);
    const candidateDosageNeedles = extractCandidateDosageNeedles(candidate);
    const candidateName = `${candidate.name} ${candidate.activePrinciple || ''} ${candidate.packaging || ''}`;
    const normalizedMention = normalizeText(sanitizeDrugSearchText(suggestion.drugMention));
    const normalizedQuery = normalizeText(sanitizeDrugSearchText(suggestion.drugQuery));
    const normalizedPrinciple = normalizeText(sanitizeDrugSearchText(suggestion.activePrinciple || ''));
    const normalizedCandidateName = normalizeText(candidate.name || '');
    const normalizedCandidatePrinciple = normalizeText(candidate.activePrinciple || '');

    let score = overlapScore(candidateName, queryTokens) * 5;
    score += overlapScore(candidateName, principleTokens) * 7;
    score += overlapScore(candidateName, mentionTokens) * 4;

    if (normalizedPrinciple && normalizedCandidatePrinciple === normalizedPrinciple) {
        score += 24;
    }
    if (normalizedMention && normalizedCandidateName === normalizedMention) {
        score += 26;
    } else if (normalizedMention && normalizedCandidateName.includes(normalizedMention)) {
        score += 12;
    }
    if (normalizedQuery && normalizedCandidatePrinciple.includes(normalizedQuery)) {
        score += 12;
    }
    if (normalizedPrinciple && normalizedCandidateName.includes(normalizedPrinciple)) {
        score += 10;
    }
    if (expectedDosageNeedles.length > 0 && candidateDosageNeedles.length > 0) {
        if (candidateDosageNeedles.some((needle) => expectedDosageNeedles.includes(needle))) {
            score += 22;
        } else {
            score -= 12;
        }
    }

    return score;
}

/* @Codex */
export function rankDrugCatalogSearchResult(query: string, candidate: AifaDrug): number {
    const normalizedQuery = normalizeText(sanitizeDrugSearchText(query) || query);
    const queryTokens = uniqueTokens(tokenize(sanitizeDrugSearchText(query) || query))
        .filter((token) => token.length >= 3 && !DRUG_QUERY_STOPWORDS.has(token));
    const candidateText = `${candidate.name} ${candidate.activePrinciple || ''} ${candidate.packaging || ''} ${candidate.atc || ''}`;
    const normalizedCandidateName = normalizeText(candidate.name || '');
    const normalizedCandidatePrinciple = normalizeText(candidate.activePrinciple || '');
    const candidateDosageNeedles = extractCandidateDosageNeedles(candidate);
    const queryDosageNeedles = extractDosageNeedles(query);

    let score = overlapCount(candidateText, queryTokens) * 9;

    if (normalizedQuery) {
        if (normalizeText(candidate.aic || '') === normalizedQuery) {
            score += 120;
        }
        if (normalizedCandidateName === normalizedQuery) {
            score += 90;
        } else if (normalizedCandidateName.startsWith(normalizedQuery)) {
            score += 42;
        } else if (normalizedCandidateName.includes(normalizedQuery)) {
            score += 18;
        }

        if (normalizedCandidatePrinciple === normalizedQuery) {
            score += 110;
        } else if (normalizedCandidatePrinciple.startsWith(normalizedQuery)) {
            score += 64;
        } else if (normalizedCandidatePrinciple.includes(normalizedQuery)) {
            score += 28;
        }

        if (normalizeText(candidate.packaging || '').includes(normalizedQuery)) {
            score += 12;
        }
        if (normalizeText(candidate.atc || '') === normalizedQuery) {
            score += 80;
        }
    }

    if (
        queryDosageNeedles.length > 0
        && candidateDosageNeedles.some((needle) => queryDosageNeedles.includes(needle))
    ) {
        score += 16;
    }

    if (queryLooksSingleIngredient(query)) {
        if (candidateHasCombinationActivePrinciple(candidate)) {
            score -= 40;
        } else if (normalizedQuery && normalizedCandidatePrinciple.startsWith(normalizedQuery)) {
            score += 24;
        }
    }

    return score;
}

/* @Codex */
export function sortDrugCatalogSearchResults(query: string, candidates: AifaDrug[]): AifaDrug[] {
    return [...candidates].sort((left, right) => {
        const scoreDiff = rankDrugCatalogSearchResult(query, right) - rankDrugCatalogSearchResult(query, left);
        if (scoreDiff !== 0) return scoreDiff;

        const nameDiff = (left.name || '').localeCompare(right.name || '', 'it', { sensitivity: 'base' });
        if (nameDiff !== 0) return nameDiff;

        return (left.packaging || '').localeCompare(right.packaging || '', 'it', { sensitivity: 'base' });
    });
}

export function selectTherapyCatalogMatch(
    suggestion: ParsedAiTherapy,
    candidates: AifaDrug[]
): AifaDrug | undefined {
    const ranked = candidates
        .map((candidate) => ({
            candidate,
            score: rankDrugMatch(candidate, suggestion),
        }))
        .sort((left, right) => right.score - left.score);

    for (const entry of ranked) {
        if (entry.score < 7) {
            return undefined;
        }
        if (hasDrugDosageConflict(entry.candidate, suggestion)) {
            continue;
        }
        if (!hasStrongDrugIdentityMatch(entry.candidate, suggestion)) {
            continue;
        }
        return entry.candidate;
    }

    return undefined;
}

export function buildDiagnosisSearchQueries(suggestion: ParsedAiDiagnosis): string[] {
    const candidates = [
        suggestion.explicitCode,
        suggestion.icdQuery,
        suggestion.label,
    ];

    const seen = new Set<string>();
    const queries: string[] = [];

    for (const candidate of candidates) {
        const normalized = candidate?.replace(/\s+/g, ' ').trim();
        if (!normalized || seen.has(normalized.toLowerCase())) continue;
        seen.add(normalized.toLowerCase());
        queries.push(normalized);
    }

    return queries;
}
