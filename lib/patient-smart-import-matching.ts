import {
    type SmartImportDiagnosisExtraction as ParsedAiDiagnosis,
    type SmartImportTherapyExtraction as ParsedAiTherapy,
} from './ai-task-contracts';
import { type AifaDrug } from './db';

const DOSAGE_TOKEN_GLOBAL_REGEX = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u|cp|cps|cpr|caps(?:ule)?|compress(?:a|e)|gtt|fial(?:a|e)|spruzzi?)\b/gi;
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

function tokenize(value: string): string[] {
    return normalizeText(value)
        .split(/\s+/)
        .filter((token) => token.length > 1);
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

export function hasDrugDosageConflict(candidate: AifaDrug, suggestion: ParsedAiTherapy): boolean {
    const expectedNeedles = extractSuggestionDosageNeedles(suggestion);
    if (expectedNeedles.length === 0) return false;

    const candidateNeedles = extractCandidateDosageNeedles(candidate);
    if (candidateNeedles.length === 0) return false;

    return !candidateNeedles.some((needle) => expectedNeedles.includes(needle));
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

    const best = ranked[0];
    if (!best || best.score < 7 || hasDrugDosageConflict(best.candidate, suggestion)) {
        return undefined;
    }

    return best.candidate;
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
