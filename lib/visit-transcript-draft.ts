/* @Codex WUL-421 */
import type { SmartImportTherapyExtraction, TherapySuggestionState } from './ai-task-contracts';
import type { AifaDrug } from './db';
import {
    buildDrugSearchTerms,
    selectTherapyCatalogMatch,
} from './domain/documents/patient-smart-import-matching';

export const VISIT_TRANSCRIPT_DRAFT_SCHEMA_VERSION = 'mediflow.visit_transcript_draft.v1';

export type VisitSessionEventType = 'start' | 'pause' | 'resume' | 'stop';
export type VisitSessionState = 'idle' | 'recording' | 'paused' | 'stopped';

export interface VisitSessionEvent {
    type: VisitSessionEventType;
    atMs: number;
}

export interface VisitTranscriptSegment {
    speaker?: string;
    text: string;
    atMs?: number;
}

export interface VisitTranscriptDraftInput {
    transcript?: string;
    segments?: VisitTranscriptSegment[];
    events?: VisitSessionEvent[];
    drugCatalog?: AifaDrug[];
}

export interface VisitDraftSections {
    subjective: string[];
    objective: string[];
    assessment: string[];
    plan: string[];
}

export interface VisitMedicationCandidate {
    drugMention: string;
    drugQuery: string;
    activePrinciple?: string;
    dosage?: string;
    therapyState: TherapySuggestionState;
    confidence: 'high' | 'medium' | 'low';
    evidence: string;
    matchType: 'catalog' | 'none';
    match?: Pick<AifaDrug, 'aic' | 'name' | 'activePrinciple' | 'atc'>;
    canApply: false;
    blockedReason: string;
}

export interface VisitSessionSummary {
    state: VisitSessionState;
    eventCount: number;
    pauseCount: number;
    resumeCount: number;
    recordedMs: number;
    pausedMs: number;
    warnings: string[];
}

export interface VisitTranscriptDraftResult {
    schemaVersion: typeof VISIT_TRANSCRIPT_DRAFT_SCHEMA_VERSION;
    draftText: string;
    sections: VisitDraftSections;
    medications: VisitMedicationCandidate[];
    session: VisitSessionSummary;
    safety: {
        reviewRequired: true;
        forbiddenAutoWriteCount: 0;
        rawAudioPersisted: false;
        writesPerformed: [];
    };
}

const MAX_TRANSCRIPT_CHARS = 12_000;
const DRUG_CONTEXT_REGEX = /\b(?:assume|assunzione|prende|continua|prosegue|inizia|introdurre|sospende|interrompe|terapia con|in terapia con|farmaco|farmaci)\s+([^.;\n]+)/gi;
const DOSAGE_REGEX = /\b\d+(?:[,.]\d+)?\s*(?:mg|mcg|g|ml|ui|u|cp|cpr|cps|gtt|fiale?|spruzzi?)\b/gi;
const SECTION_PREFIX_REGEX = /^\s*([SOAP])\s*[:\-]\s*(.+)$/i;

function normalizeText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function compactLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function normalizeTranscript(input: VisitTranscriptDraftInput): string {
    const fromSegments = (input.segments || [])
        .map((segment) => compactLine(segment.text || ''))
        .filter(Boolean)
        .join('\n');

    return [input.transcript, fromSegments]
        .filter(Boolean)
        .join('\n')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim()
        .slice(0, MAX_TRANSCRIPT_CHARS);
}

function splitClinicalSentences(value: string): string[] {
    return value
        .split(/(?<=[.!?])\s+|\n+/)
        .map(compactLine)
        .filter((item) => item.length > 0);
}

function addSectionLine(sections: VisitDraftSections, key: keyof VisitDraftSections, value: string) {
    const line = compactLine(value);
    if (line && !sections[key].includes(line)) {
        sections[key].push(line);
    }
}

function classifySentence(sentence: string): keyof VisitDraftSections {
    const normalized = normalizeText(sentence);
    if (/\b(pa|pressione|fc|fr|sat|spo2|temperatura|febbre|auscult|edem|obiettiv|mmhg|bpm|kg|esame)\b/.test(normalized)) {
        return 'objective';
    }
    if (/\b(valut\w*|compatibil\w*|probabil\w*|diagnos\w*|riacut\w*|scompens\w*|infezion\w*|dolore|quadro)\b/.test(normalized)) {
        return 'assessment';
    }
    if (/\b(piano|prosegu\w*|continua\w*|inizia\w*|sospend\w*|controll\w*|follow|richied\w*|prescriv\w*|rived\w*|monitor\w*|terapia)\b/.test(normalized)) {
        return 'plan';
    }
    return 'subjective';
}

export function buildVisitDraftSections(transcript: string): VisitDraftSections {
    const sections: VisitDraftSections = {
        subjective: [],
        objective: [],
        assessment: [],
        plan: [],
    };

    for (const line of transcript.split(/\n+/)) {
        const match = line.match(SECTION_PREFIX_REGEX);
        if (!match) continue;
        const [, prefix, text] = match;
        const key = prefix.toUpperCase() === 'S'
            ? 'subjective'
            : prefix.toUpperCase() === 'O'
                ? 'objective'
                : prefix.toUpperCase() === 'A'
                    ? 'assessment'
                    : 'plan';
        addSectionLine(sections, key, text);
    }

    if (Object.values(sections).some((items) => items.length > 0)) {
        return sections;
    }

    for (const sentence of splitClinicalSentences(transcript)) {
        addSectionLine(sections, classifySentence(sentence), sentence);
    }

    return sections;
}

function sectionOrPlaceholder(lines: string[], placeholder: string): string {
    return lines.length > 0 ? lines.join(' ') : placeholder;
}

export function formatVisitDraftText(sections: VisitDraftSections): string {
    return [
        `S: ${sectionOrPlaceholder(sections.subjective, 'da completare dopo revisione del colloquio')}`,
        `O: ${sectionOrPlaceholder(sections.objective, 'da completare con esame obiettivo e parametri')}`,
        `A: ${sectionOrPlaceholder(sections.assessment, 'valutazione clinica da formulare e confermare manualmente')}`,
        `P: ${sectionOrPlaceholder(sections.plan, 'piano da definire e confermare manualmente')}`,
    ].join('\n\n');
}

function cleanDrugMention(value: string): string {
    return value
        .replace(/\b(?:la|il|lo|gli|le|un|una|del|della|dei|degli|delle|al|alla|alle|ai)\b/gi, ' ')
        .replace(/\b(?:come da|senza variazioni|domiciliare|abituale|attuale)\b/gi, ' ')
        .replace(/\b(?:due|tre|quattro|cinque|sei|volte?|giorno|giorni|mattino|sera|pranzo|colazione|ogni|ore)\b/gi, ' ')
        .replace(/[,:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function splitDrugMentions(value: string): string[] {
    const mention = cleanDrugMention(value);
    if (!mention) return [];

    const parts = mention
        .split(/\s+(?:e|ed|con|piu|più)\s+|[,;/+]+/i)
        .map(cleanDrugMention)
        .filter((part) => part.length >= 3);

    return parts.length > 1 ? parts : [mention];
}

function classifyTherapyState(sentence: string): TherapySuggestionState {
    const normalized = normalizeText(sentence);
    if (/\b(sospend|interromp|stop|terminat|conclus)\b/.test(normalized)) return 'inactive';
    if (/\b(sostit|switch|passa a|passare a|scal|titol)\b/.test(normalized)) return 'transition';
    if (/\b(valutar|eventual|se necessario|al bisogno|da verificare|da confermare|incert)\b/.test(normalized)) return 'uncertain';
    return 'active';
}

function toTherapyExtraction(candidate: VisitMedicationCandidate): SmartImportTherapyExtraction {
    return {
        drugMention: candidate.drugMention,
        drugQuery: candidate.drugQuery,
        activePrinciple: candidate.activePrinciple,
        dosage: candidate.dosage,
        therapyState: candidate.therapyState,
        confidence: candidate.confidence,
        evidence: candidate.evidence,
    };
}

export function extractVisitMedicationCandidates(
    transcript: string,
    drugCatalog: AifaDrug[] = [],
): VisitMedicationCandidate[] {
    const sentences = splitClinicalSentences(transcript);
    const seen = new Set<string>();
    const candidates: VisitMedicationCandidate[] = [];

    for (const sentence of sentences) {
        const matches = Array.from(sentence.matchAll(DRUG_CONTEXT_REGEX));

        for (const match of matches) {
            const mentions = splitDrugMentions(match[1] || '');

            for (const mention of mentions) {
                const dosage = mention.match(DOSAGE_REGEX)?.[0]?.replace(/\s+/g, ' ');
                const drugQuery = cleanDrugMention(mention.replace(DOSAGE_REGEX, ' '));
                const key = normalizeText(`${drugQuery}|${dosage || ''}|${sentence}`);
                if (!drugQuery || seen.has(key)) continue;
                seen.add(key);

                const baseCandidate: VisitMedicationCandidate = {
                    drugMention: mention,
                    drugQuery,
                    dosage,
                    therapyState: classifyTherapyState(sentence),
                    confidence: dosage ? 'high' : 'medium',
                    evidence: compactLine(sentence),
                    matchType: 'none',
                    canApply: false,
                    blockedReason: 'Candidato derivato da transcript: richiede revisione manuale prima di qualunque import terapia.',
                };

                const terms = buildDrugSearchTerms(toTherapyExtraction(baseCandidate));
                const scopedCatalog = terms.length > 0
                    ? drugCatalog.filter((drug) => {
                        const haystack = normalizeText(`${drug.name} ${drug.activePrinciple || ''} ${drug.packaging || ''} ${drug.aic || ''} ${drug.atc || ''}`);
                        return terms.some((term) => haystack.includes(normalizeText(term)));
                    })
                    : drugCatalog;
                const matchCandidate = selectTherapyCatalogMatch(toTherapyExtraction(baseCandidate), scopedCatalog);

                candidates.push(matchCandidate ? {
                    ...baseCandidate,
                    activePrinciple: matchCandidate.activePrinciple,
                    matchType: 'catalog',
                    match: {
                        aic: matchCandidate.aic,
                        name: matchCandidate.name,
                        activePrinciple: matchCandidate.activePrinciple,
                        atc: matchCandidate.atc,
                    },
                } : baseCandidate);
            }
        }
    }

    return candidates;
}

export function buildVisitSessionSummary(events: VisitSessionEvent[] = []): VisitSessionSummary {
    const sortedEvents = [...events]
        .filter((event) => Number.isFinite(event.atMs) && event.atMs >= 0)
        .sort((left, right) => left.atMs - right.atMs);
    const warnings: string[] = [];
    let state: VisitSessionState = 'idle';
    let startedAt: number | null = null;
    let pausedAt: number | null = null;
    let stoppedAt: number | null = null;
    let pausedMs = 0;
    let pauseCount = 0;
    let resumeCount = 0;

    for (const event of sortedEvents) {
        if (event.type === 'start') {
            if (startedAt !== null) warnings.push('start duplicato ignorato');
            startedAt ??= event.atMs;
            state = 'recording';
            continue;
        }
        if (event.type === 'pause') {
            if (state !== 'recording') {
                warnings.push('pausa senza registrazione attiva');
                continue;
            }
            pausedAt = event.atMs;
            pauseCount += 1;
            state = 'paused';
            continue;
        }
        if (event.type === 'resume') {
            if (state !== 'paused' || pausedAt === null) {
                warnings.push('ripresa senza pausa attiva');
                continue;
            }
            pausedMs += Math.max(0, event.atMs - pausedAt);
            pausedAt = null;
            resumeCount += 1;
            state = 'recording';
            continue;
        }
        if (event.type === 'stop') {
            if (startedAt === null) warnings.push('stop senza start');
            if (pausedAt !== null) {
                pausedMs += Math.max(0, event.atMs - pausedAt);
                pausedAt = null;
            }
            stoppedAt = event.atMs;
            state = 'stopped';
        }
    }

    const lastAt = stoppedAt ?? sortedEvents.at(-1)?.atMs ?? startedAt ?? 0;
    const totalMs = startedAt === null ? 0 : Math.max(0, lastAt - startedAt);

    return {
        state,
        eventCount: sortedEvents.length,
        pauseCount,
        resumeCount,
        recordedMs: Math.max(0, totalMs - pausedMs),
        pausedMs,
        warnings,
    };
}

export function collectVisitTranscriptDrugSearchTerms(input: VisitTranscriptDraftInput): string[] {
    const transcript = normalizeTranscript(input);
    const candidates = extractVisitMedicationCandidates(transcript, []);
    const terms = new Set<string>();
    for (const candidate of candidates) {
        for (const term of buildDrugSearchTerms(toTherapyExtraction(candidate))) {
            terms.add(term);
        }
    }
    return Array.from(terms).slice(0, 12);
}

export function buildVisitTranscriptDraft(input: VisitTranscriptDraftInput): VisitTranscriptDraftResult {
    const transcript = normalizeTranscript(input);
    const sections = buildVisitDraftSections(transcript);
    const medications = extractVisitMedicationCandidates(transcript, input.drugCatalog || []);

    return {
        schemaVersion: VISIT_TRANSCRIPT_DRAFT_SCHEMA_VERSION,
        draftText: formatVisitDraftText(sections),
        sections,
        medications,
        session: buildVisitSessionSummary(input.events),
        safety: {
            reviewRequired: true,
            forbiddenAutoWriteCount: 0,
            rawAudioPersisted: false,
            writesPerformed: [],
        },
    };
}
