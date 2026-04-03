/* @Codex */
import type {
    ExtractedPatientData,
    ExtractedPatientReviewDiagnosis,
    ExtractedPatientReviewTherapy,
} from './pdf-service';
/* @Codex */
import { searchICDHybrid, type ICDSearchResult } from './icd-service';
/* @Codex */
import { type AifaDrug } from './db';
/* @Codex */
import {
    buildDiagnosisSearchQueries,
    buildDrugSearchTerms,
    hasDrugDosageConflict,
    rankDrugMatch,
    rankIcdMatch,
    sanitizeDrugSearchText,
    selectTherapyCatalogMatch,
} from './patient-smart-import-matching';
/* @Codex */
import { splitDocumentIntoLines } from './document-excerpt';
/* @Codex */
import {
    type SmartImportDiagnosisExtraction,
    type SmartImportTherapyExtraction,
} from './ai-task-contracts';

/* @Codex */
const DOSAGE_REGEX = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u|cp|cps|cpr|caps(?:ule)?|compress(?:a|e)|gtt|fial(?:a|e)|spruzzi?)\b(?:\s*[^\n,;]*)?/i;
/* @Codex */
const DOSAGE_NEEDLE_REGEX = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u)\b/gi;
/* @Codex */
const DOSAGE_NEEDLE_COUNT_REGEX = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u)\b/gi;
/* @Codex */
const GENERIC_THERAPY_TOKENS = new Set([
    'abituale',
    'acido',
    'alla',
    'colazione',
    'complesso',
    'capsule',
    'cloridrato',
    'compressa',
    'compresse',
    'dimissione',
    'dolore',
    'domiciliare',
    'emulsione',
    'febbre',
    'fiala',
    'flacone',
    'fino',
    'formula',
    'indicazioni',
    'iniettabile',
    'insulina',
    'mattino',
    'minuti',
    'orale',
    'ore',
    'pasti',
    'poi',
    'prescrizioni',
    'principali',
    'profilassi',
    'ripetibile',
    'ricovero',
    'sera',
    'sesquidrato',
    'siringhe',
    'sodica',
    'sodio',
    'soluzione',
    'sottocute',
    'stop',
    'supporto',
    'terapia',
    'vitaminico',
]);

/* @Codex */
type TherapyDocumentSection = 'discharge' | 'home' | 'inpatient' | 'followup' | 'unknown';

/* @Codex */
const THERAPY_FAMILY_HINTS: Array<{ key: string; tokens: string[] }> = [
    { key: 'diabetes', tokens: ['diabet', 'glicem', 'gliclazide', 'humalog', 'insulin', 'lispro', 'metformin', 'metformina'] },
    { key: 'anticoagulation', tokens: ['clexane', 'eparin', 'enoxaparin', 'ghemaxan'] },
    { key: 'ppi', tokens: ['esomepraz', 'gastroloc', 'omepraz', 'pantopraz'] },
    { key: 'nutrition', tokens: ['becozym', 'nutridrink', 'nutriz', 'vitamin'] },
];

/* @Codex */
const THERAPY_SECTION_CONTEXT_WINDOW = 8;

/* @Codex */
const THERAPY_BULLET_PREFIX_REGEX = /^\s*[-•·]\s*/;

/* @Codex */
const THERAPY_SECTION_HEADING_RULES: Array<{
    section: TherapyDocumentSection;
    label: string;
    pattern: RegExp;
}> = [
    { section: 'discharge', label: 'Terapia alla dimissione', pattern: /^terapia alla dimissione\b[:\-–]?\s*(.*)$/i },
    { section: 'home', label: 'Terapia domiciliare', pattern: /^(?:abituale\s+)?terapia domiciliare\b[:\-–]?\s*(.*)$/i },
    { section: 'followup', label: 'Controlli successivi', pattern: /^controlli successivi\b[:\-–]?\s*(.*)$/i },
    { section: 'followup', label: 'Indicazioni alla dimissione', pattern: /^indicazioni alla dimissione\b[:\-–]?\s*(.*)$/i },
    { section: 'followup', label: 'Altre prescrizioni', pattern: /^altre prescrizioni\b[:\-–]?\s*(.*)$/i },
];

/* @Codex */
const THERAPY_SUBHEADING_RULES: Array<{ label: string; pattern: RegExp }> = [
    { label: 'Altre Terapie', pattern: /^altre terapie\b[:\-–]?\s*(.*)$/i },
];

/* @Codex */
const NON_THERAPY_MENTION_PREFIX_REGEX = /^(?:rx|tc|rm|eco|ecg|visita|referto|v\/p)\b/i;
/* @Codex */
const FALLBACK_THERAPY_SCHEDULE_REGEX = /\b(?:x\s*\d+|ore\s*\d+|ogni\s+\d+\s*ore|ai\s+pasti(?:\s+principali)?|al\s+d[iì]|alla\s+sera|al\s+mattino|a\s+pranzo|se\s+febbre(?:\/dolore)?|ripetibile)\b/gi;

/* @Codex */
interface TherapyContextAnnotation {
    blockedReason?: string;
    evidence?: string;
    motivation?: string;
    section: TherapyDocumentSection;
    therapyState: ExtractedPatientReviewTherapy['therapyState'];
}

/* @Codex */
function normalizeText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/* @Codex */
function compactText(value: string | undefined, maxChars: number): string {
    const normalized = (value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.length <= maxChars
        ? normalized
        : `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

/* @Codex */
function normalizeDosageNeedle(value: string): string {
    return value.toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
}

/* @Codex */
function extractDosageNeedles(value: string | undefined): string[] {
    if (!value?.trim()) return [];
    const matches = value.match(DOSAGE_NEEDLE_REGEX) || [];
    return Array.from(new Set(matches.map((item) => normalizeDosageNeedle(item))));
}

/* @Codex */
function countDosageNeedles(value: string): number {
    return (value.match(DOSAGE_NEEDLE_COUNT_REGEX) || []).length;
}

/* @Codex */
function splitCompoundMedicationSegments(value: string): Array<{ segment: string; evidence: string }> {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return [];

    const colonIndex = normalized.indexOf(':');
    const contextPrefix = colonIndex > 0 && colonIndex < 48
        ? normalized.slice(0, colonIndex + 1).trim()
        : '';
    let body = contextPrefix ? normalized.slice(colonIndex + 1).trim() : normalized;

    let contextSuffix = '';
    const suffixMatch = body.match(/\(([^)]*(?:preesistent|abitual|domiciliar)[^)]*)\)\s*$/i);
    if (suffixMatch?.[0]) {
        contextSuffix = suffixMatch[0];
        body = body.slice(0, -suffixMatch[0].length).trim();
    }

    const shouldSplitBySeparator = countDosageNeedles(body) >= 2 || /;\s*/.test(body);
    const commaSeparated = shouldSplitBySeparator
        ? body
            .split(/\s*[;,]\s*/)
            .map((item) => item.trim())
            .filter(Boolean)
        : [body];

    const segments = commaSeparated.flatMap((item) => {
        if (countDosageNeedles(item) < 2) {
            return [item];
        }

        const split = item
            .split(/\s+(?:e|ed)\s+(?=[A-ZÀ-Ý][^\s]{1,}|[A-Za-zÀ-ÿ]{3,}\s+\d)/)
            .map((part) => part.trim())
            .filter(Boolean);
        return split.length > 1 ? split : [item];
    });

    return segments.map((segment) => ({
        segment,
        evidence: [
            contextPrefix,
            segment,
            contextSuffix,
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
    }));
}

/* @Codex */
function stripTherapyBulletPrefix(value: string): string {
    return value.replace(THERAPY_BULLET_PREFIX_REGEX, '').trim();
}

/* @Codex */
function matchTherapySectionHeading(line: string): {
    section: TherapyDocumentSection;
    heading: string;
    inlineContent?: string;
} | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    for (const rule of THERAPY_SECTION_HEADING_RULES) {
        const match = trimmed.match(rule.pattern)
            || trimmed.match(new RegExp(rule.pattern.source.replace(/^\^/, ''), rule.pattern.flags));
        if (!match) continue;
        const inlineContent = stripTherapyBulletPrefix(match[1] || '');
        return {
            section: rule.section,
            heading: rule.label,
            inlineContent: inlineContent || undefined,
        };
    }

    return null;
}

/* @Codex */
function matchTherapySubheading(line: string): { heading: string; inlineContent?: string } | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    for (const rule of THERAPY_SUBHEADING_RULES) {
        const match = trimmed.match(rule.pattern);
        if (!match) continue;
        const inlineContent = stripTherapyBulletPrefix(match[1] || '');
        return {
            heading: rule.label,
            inlineContent: inlineContent || undefined,
        };
    }

    return null;
}

/* @Codex */
function buildNormalizedTherapyTokenSet(values: Array<string | undefined>, limit = 4): string[] {
    const tokens = new Set<string>();

    for (const value of values) {
        const normalized = normalizeText(sanitizeDrugSearchText(value || ''));
        for (const token of normalized.split(/\s+/)) {
            if (token.length <= 2 || GENERIC_THERAPY_TOKENS.has(token)) continue;
            tokens.add(token);
            if (tokens.size >= limit) {
                return Array.from(tokens);
            }
        }
    }

    return Array.from(tokens);
}

/* @Codex */
function buildFallbackDrugMention(value: string): string {
    const primaryFragment = stripTherapyBulletPrefix(value)
        .replace(/\([^)]*\)/g, ' ')
        .split(/\s*,\s*/)[0]
        .trim();
    const compact = sanitizeDrugSearchText(primaryFragment)
        .replace(FALLBACK_THERAPY_SCHEDULE_REGEX, ' ')
        .replace(/\b(?:dolore|febbre|max|pasti|principali|ripetibile|sottocute|sottocuto)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return compact || sanitizeDrugSearchText(value) || stripTherapyBulletPrefix(value);
}

/* @Codex */
function buildFallbackDrugQuery(value: string): string {
    const primaryFragment = stripTherapyBulletPrefix(value)
        .replace(/\([^)]*\)/g, ' ')
        .split(/\s*,\s*/)[0]
        .trim();
    const mention = buildFallbackDrugMention(primaryFragment);
    const dosageNeedle = primaryFragment.match(DOSAGE_NEEDLE_REGEX)?.[0]?.trim();

    return [mention, dosageNeedle]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim() || mention;
}

/* @Codex */
export function isPlausibleTherapyCandidate(candidate: Pick<SmartImportTherapyExtraction, 'drugMention' | 'drugQuery'>): boolean {
    const mention = stripTherapyBulletPrefix(candidate.drugMention || candidate.drugQuery || '');
    if (!mention) return false;
    if (NON_THERAPY_MENTION_PREFIX_REGEX.test(mention)) return false;
    return true;
}

/* @Codex */
function buildRawTherapyEvidenceKey(candidate: SmartImportTherapyExtraction): string {
    const evidenceStem = buildNormalizedTherapyTokenSet([
        candidate.evidence,
        candidate.drugMention,
        candidate.drugQuery,
        candidate.activePrinciple,
    ], 6).join(' ');
    const dosageKey = extractDosageNeedles(candidate.dosage || candidate.drugMention || candidate.evidence).join('|');
    return [evidenceStem, dosageKey].join('|');
}

/* @Codex */
function buildRawTherapyIdentityKey(candidate: SmartImportTherapyExtraction): string {
    const stem = buildNormalizedTherapyTokenSet([
        candidate.activePrinciple,
        candidate.drugMention,
        candidate.drugQuery,
        candidate.evidence,
    ], 4).join(' ');
    const dosageKey = extractDosageNeedles(candidate.dosage || candidate.drugMention || candidate.evidence).join('|');
    return [stem, dosageKey].join('|');
}

/* @Codex */
function scoreTherapyStateSpecificity(state: SmartImportTherapyExtraction['therapyState'] | ExtractedPatientReviewTherapy['therapyState'] | undefined): number {
    switch (state) {
    case 'inactive':
        return 6;
    case 'transition':
        return 5;
    case 'uncertain':
        return 2;
    default:
        return 0;
    }
}

/* @Codex */
function scoreRawTherapyCandidate(candidate: SmartImportTherapyExtraction): number {
    return (candidate.activePrinciple ? 6 : 0)
        + (candidate.motivation ? 4 : 0)
        + (candidate.confidence === 'high' ? 4 : candidate.confidence === 'medium' ? 2 : 0)
        + (candidate.reviewNote ? 1 : 0)
        + (candidate.evidence ? 2 : 0)
        + (scoreTherapyEvidencePriority(candidate.evidence) > 0 ? 2 : 0)
        + scoreTherapyStateSpecificity(candidate.therapyState);
}

/* @Codex */
function dedupeTherapyCandidatesByKey(
    candidates: SmartImportTherapyExtraction[],
    getKey: (candidate: SmartImportTherapyExtraction) => string,
): SmartImportTherapyExtraction[] {
    const byKey = new Map<string, SmartImportTherapyExtraction>();

    for (const candidate of candidates) {
        const key = getKey(candidate);
        if (!key.replace(/\|/g, '').trim()) {
            continue;
        }
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, candidate);
            continue;
        }

        const currentScore = scoreRawTherapyCandidate(candidate);
        const existingScore = scoreRawTherapyCandidate(existing);

        if (currentScore > existingScore) {
            byKey.set(key, candidate);
        }
    }

    return Array.from(byKey.values());
}

/* @Codex */
export function dedupeTherapyCandidates(candidates: SmartImportTherapyExtraction[]): SmartImportTherapyExtraction[] {
    return dedupeTherapyCandidatesByKey(
        dedupeTherapyCandidatesByKey(candidates, buildRawTherapyEvidenceKey),
        buildRawTherapyIdentityKey,
    );
}

/* @Codex */
function scoreTherapyEvidencePriority(evidence: string | undefined): number {
    const probe = normalizeText(evidence || '');
    if (!probe) return 0;
    if (probe.includes('terapia alla dimissione')) return 14;
    if (probe.includes('terapia domiciliare')) return 8;
    if (
        probe.includes('durante la degenza')
        || probe.includes('profilassi')
        || probe.includes('antibiotic')
        || probe.includes('antifungin')
        || probe.includes('nutrizione enterale')
    ) {
        return -6;
    }
    return 0;
}

/* @Codex */
function classifyTherapySectionFromSnippet(snippet: string): TherapyDocumentSection {
    const probe = normalizeText(snippet);
    if (!probe) return 'unknown';
    if (probe.includes('terapia alla dimissione')) return 'discharge';
    if (probe.includes('terapia domiciliare') || probe.includes('abituale terapia domiciliare')) return 'home';
    if (
        probe.includes('durante la degenza')
        || probe.includes('ricovero')
        || probe.includes('profilassi')
        || probe.includes('antibiotic')
        || probe.includes('antifungin')
        || probe.includes('nutrizione enterale')
        || probe.includes('snd')
    ) {
        return 'inpatient';
    }
    if (
        probe.includes('controlli successivi')
        || probe.includes('indicazioni alla dimissione')
        || probe.includes('altre prescrizioni')
        || probe.includes('rivalutazione')
    ) {
        return 'followup';
    }
    if (probe.includes('dimissione')) return 'discharge';
    return 'unknown';
}

/* @Codex */
function resolveTherapyHeadingContext(
    lines: string[],
    index: number,
): { section: TherapyDocumentSection; heading?: string } {
    let subheading: string | undefined;

    for (let cursor = index; cursor >= Math.max(0, index - THERAPY_SECTION_CONTEXT_WINDOW); cursor -= 1) {
        const headingMatch = matchTherapySectionHeading(lines[cursor]);
        if (headingMatch) {
            return {
                section: headingMatch.section,
                heading: headingMatch.section === 'discharge' || headingMatch.section === 'home'
                    ? headingMatch.heading
                    : undefined,
            };
        }

        const subheadingMatch = matchTherapySubheading(lines[cursor]);
        if (subheadingMatch && !subheading) {
            subheading = subheadingMatch.heading;
        }
    }

    return {
        section: 'unknown',
        heading: subheading,
    };
}

/* @Codex */
function buildAtomicTherapyEvidenceSnippet(
    matchedLine: string,
    therapy: Pick<ExtractedPatientReviewTherapy, 'drugName' | 'activePrinciple' | 'dosage' | 'evidence'>,
    heading?: string,
): string {
    let candidateLine = matchedLine.trim();
    let effectiveHeading = heading;

    const explicitHeading = matchTherapySectionHeading(candidateLine);
    if (explicitHeading?.inlineContent) {
        effectiveHeading ||= explicitHeading.heading;
        candidateLine = explicitHeading.inlineContent;
    } else {
        const normalized = normalizeText(candidateLine);
        for (const label of ['terapia domiciliare', 'terapia alla dimissione']) {
            const headingIndex = normalized.indexOf(label);
            if (headingIndex >= 0) {
                const rawIndex = candidateLine.toLowerCase().indexOf(label);
                if (rawIndex >= 0) {
                    candidateLine = candidateLine.slice(rawIndex);
                    const nestedHeading = matchTherapySectionHeading(candidateLine);
                    if (nestedHeading?.inlineContent) {
                        effectiveHeading ||= nestedHeading.heading;
                        candidateLine = nestedHeading.inlineContent;
                    }
                }
                break;
            }
        }
    }

    const stripped = stripTherapyBulletPrefix(candidateLine);
    const segments = splitCompoundMedicationSegments(stripped);
    const bestSegment = segments
        .map((segment) => ({
            ...segment,
            score: scoreTherapyLineMatch(normalizeText(segment.segment), therapy),
        }))
        .sort((left, right) => right.score - left.score)[0];
    const content = stripTherapyBulletPrefix(bestSegment?.segment || stripped);
    if (!content) return '';

    if (effectiveHeading && !normalizeText(content).includes(normalizeText(effectiveHeading))) {
        return `${effectiveHeading} - ${content}`;
    }

    return content;
}

/* @Codex */
function classifyTimeLimitedTherapy(snippet: string): ExtractedPatientReviewTherapy['therapyState'] | null {
    const probe = normalizeText(snippet);
    if (!probe) return null;
    if (/\b(fino al|per due settimane|per una settimana|per \d+ giorni|x \d+ settimane|x \d+ giorni|max \d+ die)\b/.test(probe)) {
        return 'transition';
    }
    if (/\b(poi stop|sospend|interrott|conclud|terminat|stop terapia)\b/.test(probe)) {
        return 'inactive';
    }
    return null;
}

/* @Codex */
function buildTherapyFamilyKey(
    therapy: Pick<ExtractedPatientReviewTherapy, 'atc' | 'activePrinciple' | 'drugName' | 'motivation' | 'evidence'>,
): string {
    if (therapy.atc?.trim()) {
        return `atc:${normalizeText(therapy.atc.slice(0, 3))}`;
    }

    const probe = normalizeText([
        therapy.drugName,
        therapy.activePrinciple,
        therapy.motivation,
        therapy.evidence,
    ].filter(Boolean).join(' '));
    for (const family of THERAPY_FAMILY_HINTS) {
        if (family.tokens.some((token) => probe.includes(token))) {
            return `area:${family.key}`;
        }
    }

    const source = therapy.activePrinciple || therapy.drugName;
    const tokens = normalizeText(source)
        .split(/\s+/)
        .filter((token) => token.length > 2)
        .slice(0, 2);
    return `text:${tokens.join(' ')}`;
}

/* @Codex */
function scoreTherapyLineMatch(
    normalizedLine: string,
    therapy: Pick<ExtractedPatientReviewTherapy, 'drugName' | 'activePrinciple' | 'dosage' | 'evidence'>
): number {
    const phrases = [therapy.drugName, therapy.activePrinciple]
        .map((value) => normalizeText(value || ''))
        .filter(Boolean);
    const dosageNeedles = extractDosageNeedles(therapy.dosage);
    let score = 0;

    for (const phrase of phrases) {
        if (normalizedLine.includes(phrase)) {
            score += 12;
            continue;
        }

        const phraseTokens = phrase.split(/\s+/).filter((token) => token.length > 2);
        score += phraseTokens.reduce((total, token) => total + (normalizedLine.includes(token) ? 2 : 0), 0);
    }

    for (const needle of dosageNeedles) {
        const compactLine = normalizedLine.replace(/\s+/g, '');
        if (compactLine.includes(needle)) {
            score += 5;
        }
    }

    const evidenceProbe = normalizeText(compactText(therapy.evidence, 80));
    if (evidenceProbe && normalizedLine.includes(evidenceProbe)) {
        score += 4;
    }

    return score;
}

/* @Codex */
function annotateTherapyContext(
    rawText: string,
    therapy: ExtractedPatientReviewTherapy,
): TherapyContextAnnotation {
    const lines = splitDocumentIntoLines(rawText);
    if (lines.length === 0) {
        return {
            section: 'unknown',
            therapyState: therapy.therapyState,
            blockedReason: therapy.blockedReason,
            evidence: therapy.evidence,
            motivation: therapy.motivation,
        };
    }

    let bestIndex = -1;
    let bestScore = 0;
    const normalizedLines = lines.map((line) => normalizeText(line));

    for (let index = 0; index < normalizedLines.length; index += 1) {
        const score = scoreTherapyLineMatch(normalizedLines[index], therapy);
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }

    if (bestIndex < 0 || bestScore < 4) {
        return {
            section: 'unknown',
            therapyState: therapy.therapyState,
            blockedReason: therapy.blockedReason,
            evidence: therapy.evidence,
            motivation: therapy.motivation,
        };
    }

    const matchedLine = lines[bestIndex];
    const headingContext = resolveTherapyHeadingContext(lines, bestIndex);
    const sectionProbe = lines.slice(Math.max(0, bestIndex - THERAPY_SECTION_CONTEXT_WINDOW), bestIndex + 1).join(' ');
    const section = headingContext.section !== 'unknown'
        ? headingContext.section
        : classifyTherapySectionFromSnippet(sectionProbe || matchedLine);
    const snippet = buildAtomicTherapyEvidenceSnippet(matchedLine, therapy, headingContext.heading);
    let therapyState = therapy.therapyState;
    let blockedReason = therapy.blockedReason;
    const timeLimitedState = classifyTimeLimitedTherapy(matchedLine);

    if (therapyState === 'active' && section === 'inpatient') {
        therapyState = 'inactive';
        blockedReason = blockedReason || 'Terapia citata nel decorso di ricovero, non confermata come corrente';
    }

    if (therapyState === 'active' && timeLimitedState) {
        therapyState = timeLimitedState;
        blockedReason = blockedReason || (
            timeLimitedState === 'inactive'
                ? 'Terapia a termine o sospesa nelle indicazioni documentali'
                : 'Terapia temporanea o con rivalutazione ravvicinata'
        );
    }

    return {
        section,
        therapyState,
        blockedReason,
        evidence: compactText(snippet, 220) || therapy.evidence,
        motivation: compactText(therapy.motivation, 180) || undefined,
    };
}

/* @Codex */
export function reconcileTherapyCandidatesWithDocumentContext(
    rawText: string,
    therapies: ExtractedPatientReviewTherapy[],
): ExtractedPatientReviewTherapy[] {
    const documentSuggestsTherapyReset = /impostazione terapia|rivalutazione(?:\s+\w+){0,3}\s+terapia|switch terapeut|modifica terapia|passare a|sostitu/i.test(
        normalizeText(rawText),
    );

    const annotated = therapies.map((therapy) => {
        const context = annotateTherapyContext(rawText, therapy);
        return {
            ...therapy,
            therapyState: context.therapyState,
            blockedReason: context.blockedReason,
            evidence: context.evidence,
            motivation: context.motivation,
            __section: context.section,
        };
    });

    const activeDischargeGroups = new Set(
        annotated
            .filter((therapy) => therapy.__section === 'discharge' && therapy.therapyState === 'active')
            .map((therapy) => buildTherapyFamilyKey(therapy)),
    );

    return annotated.map((therapy) => {
        const familyKey = buildTherapyFamilyKey(therapy);
        if (
            documentSuggestsTherapyReset
            && therapy.__section === 'home'
            && therapy.therapyState === 'active'
            && activeDischargeGroups.has(familyKey)
        ) {
            return {
                ...therapy,
                therapyState: 'transition' as const,
                blockedReason: 'Terapia domiciliare pre-ricovero: presente terapia alla dimissione nello stesso ambito terapeutico',
            };
        }

        if (
            therapy.__section === 'inpatient'
            && therapy.therapyState === 'active'
            && activeDischargeGroups.has(familyKey)
        ) {
            return {
                ...therapy,
                therapyState: 'inactive' as const,
                blockedReason: 'Terapia di degenza non confermata nella terapia alla dimissione',
            };
        }

        return therapy;
    }).map(({ __section, ...therapy }) => therapy);
}

/* @Codex */
function mergeUniqueDiagnoses(
    explicitDiagnoses: ExtractedPatientReviewDiagnosis[],
    resolvedDiagnoses: ExtractedPatientReviewDiagnosis[],
): ExtractedPatientReviewDiagnosis[] {
    const byKey = new Map<string, ExtractedPatientReviewDiagnosis>();

    for (const item of [...explicitDiagnoses, ...resolvedDiagnoses]) {
        const key = `${normalizeText(item.system)}|${normalizeText(item.code)}|${normalizeText(item.description)}`;
        const existing = byKey.get(key);
        if (!existing || existing.sourceType !== 'explicit_document_code') {
            byKey.set(key, item);
        }
    }

    return Array.from(byKey.values());
}

/* @Codex */
function buildTherapySemanticStem(therapy: ExtractedPatientReviewTherapy): string[] {
    return buildNormalizedTherapyTokenSet([
        therapy.drugName,
        therapy.activePrinciple,
    ], 4);
}

/* @Codex */
function hasCompatibleTherapyDosage(
    left: Pick<ExtractedPatientReviewTherapy, 'dosage'>,
    right: Pick<ExtractedPatientReviewTherapy, 'dosage'>,
): boolean {
    const leftDosage = extractDosageNeedles(left.dosage);
    const rightDosage = extractDosageNeedles(right.dosage);
    if (leftDosage.length === 0 || rightDosage.length === 0) return true;
    return leftDosage.some((needle) => rightDosage.includes(needle));
}

/* @Codex */
function sharesTherapySemanticIdentity(
    left: ExtractedPatientReviewTherapy,
    right: ExtractedPatientReviewTherapy,
): boolean {
    if (!hasCompatibleTherapyDosage(left, right)) return false;

    if (left.aic?.trim() && right.aic?.trim()) {
        if (normalizeText(left.aic) === normalizeText(right.aic)) {
            return true;
        }
    }

    const leftPrinciple = normalizeText(left.activePrinciple || '');
    const rightPrinciple = normalizeText(right.activePrinciple || '');
    if (leftPrinciple && rightPrinciple && leftPrinciple === rightPrinciple) {
        return true;
    }

    const leftName = normalizeText(sanitizeDrugSearchText(left.drugName || ''));
    const rightName = normalizeText(sanitizeDrugSearchText(right.drugName || ''));
    if (leftName && rightName && (leftName === rightName || leftName.includes(rightName) || rightName.includes(leftName))) {
        return true;
    }

    const leftTokens = buildTherapySemanticStem(left);
    const rightTokens = buildTherapySemanticStem(right);
    const overlap = leftTokens.filter((token) => rightTokens.includes(token));
    if (overlap.length >= 2) return true;
    if (overlap.length === 1) {
        const [sharedToken] = overlap;
        if (sharedToken.length >= 6 && (leftTokens.length <= 2 || rightTokens.length <= 2)) {
            return true;
        }
    }

    return false;
}

/* @Codex */
function candidateNameSupportsTherapyIdentity(candidate: AifaDrug, therapy: SmartImportTherapyExtraction): boolean {
    const candidateName = normalizeText(candidate.name || '');
    const therapyTokens = buildNormalizedTherapyTokenSet([
        therapy.drugMention,
        therapy.drugQuery,
        therapy.evidence,
    ], 4);

    if (therapyTokens.length === 0) return false;
    const overlap = therapyTokens.filter((token) => candidateName.includes(token));
    return overlap.length >= 1;
}

/* @Codex */
function hasConsistentActivePrincipleSupport(therapy: SmartImportTherapyExtraction, candidates: AifaDrug[]): boolean {
    if (!therapy.activePrinciple?.trim()) return true;

    const normalizedPrinciple = normalizeText(sanitizeDrugSearchText(therapy.activePrinciple));
    if (!normalizedPrinciple) return true;

    return candidates.some((candidate) => {
        const candidatePrinciple = normalizeText(candidate.activePrinciple || '');
        if (!candidatePrinciple) return false;
        const principleMatches = candidatePrinciple.includes(normalizedPrinciple) || normalizedPrinciple.includes(candidatePrinciple);
        return principleMatches && candidateNameSupportsTherapyIdentity(candidate, therapy);
    });
}

/* @Codex */
function sanitizeResolvedTherapyExtraction(
    therapy: SmartImportTherapyExtraction,
    rankedCandidates: AifaDrug[],
): SmartImportTherapyExtraction {
    if (hasConsistentActivePrincipleSupport(therapy, rankedCandidates)) {
        return therapy;
    }

    return {
        ...therapy,
        activePrinciple: undefined,
        motivation: undefined,
    };
}

/* @Codex */
function scoreTherapyClinicalPriority(item: ExtractedPatientReviewTherapy): number {
    return scoreTherapyEvidencePriority(item.evidence) * 5
        + (item.therapyState === 'active' ? 4 : item.therapyState === 'transition' ? 3 : item.therapyState === 'uncertain' ? 1 : 0)
        + (item.motivation ? 2 : 0)
        + (item.blockedReason ? 1 : 0);
}

/* @Codex */
function preferTherapyByScore(
    left: ExtractedPatientReviewTherapy,
    right: ExtractedPatientReviewTherapy,
    score: (item: ExtractedPatientReviewTherapy) => number,
): ExtractedPatientReviewTherapy {
    return score(right) > score(left) ? right : left;
}

/* @Codex */
function mergeTherapyConfidence(
    left: ExtractedPatientReviewTherapy,
    right: ExtractedPatientReviewTherapy,
): ExtractedPatientReviewTherapy['confidence'] {
    return selectBetterConfidence(left.confidence, right.confidence);
}

/* @Codex */
function mergeTherapyCatalogMetadata(
    clinicalPreferred: ExtractedPatientReviewTherapy,
    structuralPreferred: ExtractedPatientReviewTherapy,
    secondary: ExtractedPatientReviewTherapy,
): Pick<ExtractedPatientReviewTherapy, 'aic' | 'atc' | 'activePrinciple' | 'matchType'> {
    const catalogSource = [structuralPreferred, clinicalPreferred, secondary].find((item) => item.matchType === 'catalog');

    return {
        aic: catalogSource?.aic || structuralPreferred.aic || clinicalPreferred.aic || secondary.aic,
        atc: catalogSource?.atc || structuralPreferred.atc || clinicalPreferred.atc || secondary.atc,
        activePrinciple: clinicalPreferred.activePrinciple
            || catalogSource?.activePrinciple
            || structuralPreferred.activePrinciple
            || secondary.activePrinciple,
        matchType: catalogSource ? 'catalog' : structuralPreferred.matchType,
    };
}

/* @Codex */
function mergeTherapyPair(
    left: ExtractedPatientReviewTherapy,
    right: ExtractedPatientReviewTherapy,
): ExtractedPatientReviewTherapy {
    const clinicalPreferred = preferTherapyByScore(left, right, scoreTherapyClinicalPriority);
    const structuralPreferred = preferTherapyByScore(left, right, scoreResolvedTherapy);
    const secondary = clinicalPreferred === left ? right : left;
    const catalogMetadata = mergeTherapyCatalogMetadata(clinicalPreferred, structuralPreferred, secondary);

    return {
        ...secondary,
        ...structuralPreferred,
        ...clinicalPreferred,
        drugName: clinicalPreferred.drugName || structuralPreferred.drugName || secondary.drugName,
        dosage: clinicalPreferred.dosage || structuralPreferred.dosage || secondary.dosage,
        activePrinciple: catalogMetadata.activePrinciple,
        motivation: clinicalPreferred.motivation || structuralPreferred.motivation || secondary.motivation,
        aic: catalogMetadata.aic,
        atc: catalogMetadata.atc,
        confidence: mergeTherapyConfidence(clinicalPreferred, structuralPreferred),
        therapyState: clinicalPreferred.therapyState,
        matchType: catalogMetadata.matchType,
        evidence: clinicalPreferred.evidence || structuralPreferred.evidence || secondary.evidence,
        blockedReason: clinicalPreferred.blockedReason || structuralPreferred.blockedReason || secondary.blockedReason,
        sourceType: clinicalPreferred.sourceType || structuralPreferred.sourceType || secondary.sourceType,
    };
}

/* @Codex */
function scoreResolvedTherapy(item: ExtractedPatientReviewTherapy): number {
    return (item.matchType === 'catalog' ? 30 : item.matchType === 'manual' ? 20 : 0)
        + (item.sourceType === 'document_explicit' ? 10 : 0)
        + (item.confidence === 'high' ? 8 : item.confidence === 'medium' ? 4 : 0)
        + (item.aic ? 5 : 0)
        + (item.atc ? 3 : 0)
        + (item.activePrinciple ? 2 : 0)
        + scoreTherapyEvidencePriority(item.evidence)
        + scoreTherapyStateSpecificity(item.therapyState);
}

/* @Codex */
function selectBetterConfidence(
    left: ExtractedPatientReviewTherapy['confidence'],
    right: ExtractedPatientReviewTherapy['confidence'],
): ExtractedPatientReviewTherapy['confidence'] {
    const score = (value: ExtractedPatientReviewTherapy['confidence']) => (
        value === 'high' ? 3 : value === 'medium' ? 2 : value === 'low' ? 1 : 0
    );
    return score(left) >= score(right) ? left : right;
}

/* @Codex */
export function mergeUniqueTherapies(items: ExtractedPatientReviewTherapy[]): ExtractedPatientReviewTherapy[] {
    const merged: ExtractedPatientReviewTherapy[] = [];

    for (const item of items) {
        const existingIndex = merged.findIndex((existing) => sharesTherapySemanticIdentity(existing, item));
        if (existingIndex < 0) {
            merged.push(item);
            continue;
        }

        merged[existingIndex] = mergeTherapyPair(merged[existingIndex], item);
    }

    return merged;
}

/* @Codex */
function extractTherapyIdentityTokens(therapy: ExtractedPatientReviewTherapy): string[] {
    const sources = [therapy.drugName, therapy.activePrinciple];
    const tokens = new Set<string>();

    for (const source of sources) {
        const normalized = normalizeText(sanitizeDrugSearchText(source || ''));
        for (const token of normalized.split(/\s+/)) {
            if (token.length <= 2 || GENERIC_THERAPY_TOKENS.has(token)) continue;
            tokens.add(token);
            if (tokens.size >= 3) break;
        }
        if (tokens.size >= 3) break;
    }

    return Array.from(tokens);
}

/* @Codex */
function shouldCollapseAgainstCatalog(
    probe: ExtractedPatientReviewTherapy,
    catalogItem: ExtractedPatientReviewTherapy,
): boolean {
    if (catalogItem.matchType !== 'catalog' || probe.matchType === 'catalog') return false;
    if (probe.therapyState !== catalogItem.therapyState) return false;

    const probeTokens = extractTherapyIdentityTokens(probe);
    const catalogTokens = extractTherapyIdentityTokens(catalogItem);
    const overlap = probeTokens.some((token) => catalogTokens.includes(token));
    if (!overlap) return false;

    const probeDosage = extractDosageNeedles(probe.dosage).join('|');
    const catalogDosage = extractDosageNeedles(catalogItem.dosage).join('|');
    return !probeDosage || !catalogDosage || probeDosage === catalogDosage;
}

/* @Codex */
function collapseManualTherapiesAgainstCatalog(items: ExtractedPatientReviewTherapy[]): ExtractedPatientReviewTherapy[] {
    const catalogItems = items.filter((item) => item.matchType === 'catalog');
    return items.filter((item) => !catalogItems.some((catalogItem) => shouldCollapseAgainstCatalog(item, catalogItem)));
}

/* @Codex */
export function shouldRetainReviewTherapy(item: ExtractedPatientReviewTherapy): boolean {
    return !(
        item.matchType === 'manual'
        && item.therapyState === 'inactive'
    );
}

/* @Codex */
function toExplicitDiagnosisCandidates(data: ExtractedPatientData): ExtractedPatientReviewDiagnosis[] {
    return (data.diagnoses || []).map((diagnosis) => ({
        label: diagnosis.description,
        code: diagnosis.code,
        description: diagnosis.description,
        system: diagnosis.system,
        evidence: diagnosis.evidence,
        confidence: diagnosis.confidence,
        sourceType: 'explicit_document_code',
    }));
}

/* @Codex */
function extractTherapyCandidatesFromRawSections(rawText: string): SmartImportTherapyExtraction[] {
    const lines = splitDocumentIntoLines(rawText);
    const candidates: SmartImportTherapyExtraction[] = [];
    let currentSection: TherapyDocumentSection = 'unknown';
    let currentHeading: string | undefined;

    const pushLine = (line: string, heading?: string, splitCompoundLine = false) => {
        const stripped = stripTherapyBulletPrefix(line);
        if (!stripped) return;

        const items = splitCompoundLine
            ? splitCompoundMedicationSegments(heading ? `${heading}: ${stripped}` : stripped)
            : [{
                segment: stripped,
                evidence: heading ? `${heading} - ${stripped}` : stripped,
            }];

        for (const item of items) {
            const drugMention = buildFallbackDrugMention(item.segment);
            const drugQuery = buildFallbackDrugQuery(item.segment);
            if (!drugMention) continue;

            candidates.push({
                drugMention,
                drugQuery,
                dosage: item.segment.match(DOSAGE_REGEX)?.[0]?.trim(),
                confidence: 'medium',
                evidence: item.evidence,
                therapyState: 'active',
            });
        }
    };

    for (const line of lines) {
        const headingMatch = matchTherapySectionHeading(line);
        if (headingMatch) {
            currentSection = headingMatch.section;
            currentHeading = headingMatch.section === 'discharge' || headingMatch.section === 'home'
                ? headingMatch.heading
                : undefined;
            if (
                headingMatch.inlineContent
                && (currentSection === 'discharge' || currentSection === 'home')
            ) {
                pushLine(headingMatch.inlineContent, currentHeading, true);
            }
            continue;
        }

        const subheadingMatch = matchTherapySubheading(line);
        if (subheadingMatch) {
            if (
                subheadingMatch.inlineContent
                && (currentSection === 'discharge' || currentSection === 'home')
            ) {
                pushLine(subheadingMatch.inlineContent, currentHeading, true);
            }
            continue;
        }

        if (currentSection !== 'discharge' && currentSection !== 'home') {
            continue;
        }

        if (!THERAPY_BULLET_PREFIX_REGEX.test(line)) {
            continue;
        }

        pushLine(line, currentHeading, false);
    }

    return candidates;
}

/* @Codex */
export function fallbackTherapyCandidates(data: ExtractedPatientData): SmartImportTherapyExtraction[] {
    const candidates: SmartImportTherapyExtraction[] = [];

    for (const medication of data.medications || []) {
        const normalized = compactText(medication, 180);
        if (!normalized) continue;

        for (const item of splitCompoundMedicationSegments(normalized)) {
            const dosage = item.segment.match(DOSAGE_REGEX)?.[0]?.trim();
            const drugMention = buildFallbackDrugMention(item.segment);
            const drugQuery = buildFallbackDrugQuery(item.segment);

            candidates.push({
                drugMention,
                drugQuery,
                dosage,
                confidence: 'medium',
                evidence: item.evidence,
                therapyState: 'active',
            });
        }
    }

    if (data.rawText?.trim()) {
        candidates.push(...extractTherapyCandidatesFromRawSections(data.rawText));
    }

    return candidates;
}

/* @Codex */
async function resolveDiagnosisCandidates(
    rawText: string,
    problemStatements: SmartImportDiagnosisExtraction[],
): Promise<ExtractedPatientReviewDiagnosis[]> {
    const cache = new Map<string, Promise<ICDSearchResult[]>>();

    const search = (query: string) => {
        const key = query.trim();
        if (!cache.has(key)) {
            cache.set(key, searchICDHybrid(key));
        }
        return cache.get(key)!;
    };

    const resolved: Array<ExtractedPatientReviewDiagnosis | null> = await Promise.all(problemStatements.map(async (problem) => {
        const queries = buildDiagnosisSearchQueries(problem);
        let ranked: Array<{ result: ICDSearchResult; score: number }> = [];

        for (const query of queries) {
            const results = await search(query);
            const next = results.map((result) => ({
                result,
                score: rankIcdMatch(query, problem.label, problem.explicitCode, result),
            }));
            ranked = [...ranked, ...next];
        }

        ranked.sort((left, right) => right.score - left.score);
        const best = ranked.find((candidate) => candidate.score >= 8 && candidate.result.code !== 'N/A');
        if (!best) {
            return {
                label: problem.label,
                code: '',
                description: problem.label,
                system: 'ICD-11' as const,
                evidence: problem.evidence,
                confidence: problem.confidence,
                blockedReason: 'Nessun match ICD-11 locale affidabile',
                sourceType: 'reviewable_local_match' as const,
            };
        }

        return {
            label: problem.label,
            code: best.result.code,
            description: best.result.description,
            system: 'ICD-11' as const,
            evidence: problem.evidence,
            confidence: problem.confidence,
            blockedReason: undefined,
            sourceType: 'reviewable_local_match' as const,
        };
    }));

    return resolved.filter((item) => Boolean(item)) as ExtractedPatientReviewDiagnosis[];
}

/* @Codex */
async function searchDrugCatalog(query: string): Promise<AifaDrug[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const response = await fetch(`/api/drugs?q=${encodeURIComponent(trimmed)}`, { cache: 'no-store' });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload as AifaDrug[] : [];
}

/* @Codex */
async function resolveTherapyCandidates(
    rawText: string,
    therapyCandidates: SmartImportTherapyExtraction[],
): Promise<ExtractedPatientReviewTherapy[]> {
    const searchCache = new Map<string, Promise<AifaDrug[]>>();
    const search = (query: string) => {
        const key = query.trim().toLowerCase();
        if (!searchCache.has(key)) {
            searchCache.set(key, searchDrugCatalog(query));
        }
        return searchCache.get(key)!;
    };

    const resolved = await Promise.all(therapyCandidates.map(async (therapy) => {
        const searchTerms = buildDrugSearchTerms(therapy).slice(0, 6);
        const rankedByCandidate = new Map<string, { candidate: AifaDrug; score: number }>();

        for (const term of searchTerms) {
            const candidates = await search(term);
            for (const candidate of candidates) {
                const key = [
                    normalizeText(candidate.aic),
                    normalizeText(candidate.activePrinciple || ''),
                    normalizeText(candidate.name),
                    normalizeText(candidate.packaging || ''),
                ].join('|');
                const score = rankDrugMatch(candidate, therapy) + (hasDrugDosageConflict(candidate, therapy) ? -8 : 0);
                const previous = rankedByCandidate.get(key);
                if (!previous || score > previous.score) {
                    rankedByCandidate.set(key, { candidate, score });
                }
            }
        }

        const ranked = Array.from(rankedByCandidate.values())
            .sort((left, right) => right.score - left.score)
            .map((item) => item.candidate);
        const sanitizedTherapy = sanitizeResolvedTherapyExtraction(therapy, ranked);
        const selected = selectTherapyCatalogMatch(sanitizedTherapy, ranked);
        const drugName = selected?.name || sanitizedTherapy.drugMention;
        const dosage = sanitizedTherapy.dosage || undefined;
        const matchType = selected
            ? 'catalog'
            : (sanitizedTherapy.activePrinciple || sanitizedTherapy.drugMention ? 'manual' : 'none');

        return {
            drugName,
            dosage,
            activePrinciple: selected?.activePrinciple || sanitizedTherapy.activePrinciple,
            motivation: sanitizedTherapy.motivation,
            aic: selected?.aic,
            atc: selected?.atc,
            confidence: sanitizedTherapy.confidence,
            therapyState: sanitizedTherapy.therapyState || 'active',
            matchType,
            evidence: sanitizedTherapy.evidence,
            blockedReason: sanitizedTherapy.therapyState && sanitizedTherapy.therapyState !== 'active'
                ? (sanitizedTherapy.reviewNote || 'Terapia da confermare o non attiva nelle fonti correnti')
                : undefined,
            sourceType: 'reviewable_local_match',
        } satisfies ExtractedPatientReviewTherapy;
    }));

    return reconcileTherapyCandidatesWithDocumentContext(
        rawText,
        resolved.filter((item) => Boolean(item.drugName)),
    );
}

/* @Codex */
export async function enrichExtractedPatientDataForReview(data: ExtractedPatientData): Promise<ExtractedPatientData> {
    if (!data.rawText?.trim()) {
        return data;
    }

    const problemStatements = data.problemStatements || [];
    const therapyCandidates = dedupeTherapyCandidates([
        ...(data.therapyCandidates || []),
        ...fallbackTherapyCandidates(data),
    ]).filter(isPlausibleTherapyCandidate);

    const [reviewDiagnoses, reviewTherapies] = await Promise.all([
        resolveDiagnosisCandidates(data.rawText, problemStatements),
        resolveTherapyCandidates(data.rawText, therapyCandidates),
    ]);

    return {
        ...data,
        reviewDiagnoses: mergeUniqueDiagnoses(
            toExplicitDiagnosisCandidates(data),
            reviewDiagnoses.map((diagnosis) => ({
                ...diagnosis,
                evidence: diagnosis.evidence ? `${diagnosis.evidence}` : undefined,
            })),
        ).map((diagnosis) => ({
            ...diagnosis,
            evidence: diagnosis.evidence ? compactText(diagnosis.evidence, 220) : undefined,
            blockedReason: diagnosis.blockedReason,
        })),
        reviewTherapies: collapseManualTherapiesAgainstCatalog(
            mergeUniqueTherapies(reviewTherapies).map((therapy) => ({
                ...therapy,
                evidence: therapy.evidence ? compactText(therapy.evidence, 220) : undefined,
                blockedReason: therapy.blockedReason,
                motivation: compactText(therapy.motivation, 180) || undefined,
            }))
        ).filter(shouldRetainReviewTherapy),
        documentSummary: data.documentSummary || compactText(data.rawText, 700),
        notes: data.notes || compactText(data.rawText, 500),
    };
}
