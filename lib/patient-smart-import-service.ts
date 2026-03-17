import { regeneratePatientSummary } from './ai-summary-service';
import { AIService } from './ai-service';
import { db, type AifaDrug, type ClinicalEntry, type Diagnosis, type DocumentInsight, type Patient, type Therapy } from './db';
import { searchICDHybrid } from './icd-service';
import { notifyDbChange } from './live-query';

export type SmartImportConfidence = 'high' | 'medium' | 'low';
export type TherapySuggestionState = 'active' | 'transition' | 'uncertain' | 'inactive';

export interface SmartImportEvidence {
    sourceKind: 'patient-notes' | 'clinical-entry' | 'document-insight' | 'attachment-summary';
    sourceId: string;
    label: string;
    excerpt: string;
    date?: string;
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
}

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

interface ParsedAiDiagnosis {
    label: string;
    icdQuery: string;
    confidence: SmartImportConfidence;
    evidence: string;
    sourceId?: string;
    explicitCode?: string;
}

interface ParsedAiTherapy {
    drugMention: string;
    drugQuery: string;
    activePrinciple?: string;
    dosage?: string;
    motivation?: string;
    therapyState?: TherapySuggestionState;
    reviewNote?: string;
    confidence: SmartImportConfidence;
    evidence: string;
    sourceId?: string;
}

interface ParsedAiPayload {
    diagnoses: ParsedAiDiagnosis[];
    therapies: ParsedAiTherapy[];
}

export interface ApplySmartImportResult {
    diagnosesApplied: number;
    therapiesApplied: number;
    appliedDiagnosisIds: string[];
    appliedTherapyIds: string[];
}

const MAX_SMART_IMPORT_DIAGNOSES = 5;
const MAX_SMART_IMPORT_THERAPIES = 10;
const THERAPY_HINT_LIMIT = 14;
const DOSAGE_TOKEN_REGEX = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u|cp|cps|cpr|caps(?:ule)?|compress(?:a|e)|gtt|fial(?:a|e)|spruzzi?)\b/i;
const DOSAGE_TOKEN_GLOBAL_REGEX = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u|cp|cps|cpr|caps(?:ule)?|compress(?:a|e)|gtt|fial(?:a|e)|spruzzi?)\b/gi;
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

const SMART_IMPORT_PROMPT = `Sei un assistente clinico locale per MediFlow.

Ricevi dati gia presenti della scheda paziente e fonti recenti (note paziente, diario clinico, documenti gia analizzati).

Obiettivo: proporre suggerimenti REVIEWABLE da importare nel profilo paziente.

Restituisci SOLO JSON valido con questa forma:
{
  "diagnoses": [
    {
      "label": "patologia in italiano",
      "icdQuery": "query breve in inglese per cercare ICD-11",
      "confidence": "high|medium|low",
      "evidence": "breve evidenza testuale locale",
      "sourceId": "id della fonte usata",
      "explicitCode": "solo se la fonte contiene gia un codice esplicito"
    }
  ],
  "therapies": [
    {
      "drugMention": "farmaco o principio attivo menzionato",
      "drugQuery": "query breve per catalogo farmaci/AIFA",
      "activePrinciple": "principio attivo se disponibile",
      "dosage": "posologia se disponibile",
      "motivation": "indicazione/contesto clinico se disponibile",
      "therapyState": "active|transition|uncertain|inactive",
      "reviewNote": "motivo breve se la terapia e in transizione/incerta/non applicabile subito",
      "confidence": "high|medium|low",
      "evidence": "breve evidenza testuale locale",
      "sourceId": "id della fonte usata"
    }
  ]
}

Regole:
- Non inventare dati non supportati dalle fonti.
- Non proporre diagnosi o terapie gia presenti nella scheda se equivalenti.
- Per le diagnosi free-text NON inventare codici ICD: usa label + icdQuery.
- Escludi negazioni e familiarita.
- Per le terapie restituisci SEMPRE un oggetto per ogni farmaco distinto: non fondere piu farmaci nella stessa entry.
- Se il contesto include "therapyCandidateHints", usali per mantenere atomiche le terapie anche quando una nota contiene liste o posologie miste.
- Non scartare automaticamente transizioni terapeutiche o elementi "da verificare": restituiscili con therapyState="transition" o "uncertain" e reviewNote esplicita.
- Usa therapyState="active" solo quando la terapia appare plausibilmente corrente e applicabile.
- Segna therapyState="inactive" solo per terapie chiaramente sospese/interrotte/concluse.
- Preferisci condizioni attive/rilevanti.
- Massimo 5 diagnosi e massimo 10 terapie.

CONTESTO STRUTTURATO:
`;

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

function trimSnippet(value: string, maxLength = 260): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function normalizeTherapyState(value: unknown): TherapySuggestionState | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'active' || normalized === 'transition' || normalized === 'uncertain' || normalized === 'inactive') {
        return normalized;
    }
    return undefined;
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

function extractJsonBlock(response: string): string | null {
    const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();

    const firstBrace = response.indexOf('{');
    const lastBrace = response.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return null;
    }

    return response.slice(firstBrace, lastBrace + 1).trim();
}

function normalizeConfidence(value: unknown): SmartImportConfidence {
    if (typeof value !== 'string') return 'medium';
    const normalized = value.trim().toLowerCase();
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
        return normalized;
    }
    return 'medium';
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
    parseDocumentInsights(patient.documentInsights)
        .slice(0, 4)
        .forEach((insight) => {
            const fileName = typeof insight.fileName === 'string' ? insight.fileName.trim() : '';
            if (fileName) insightFileNames.add(fileName.toLowerCase());

            const extractedDiagnoses = Array.isArray(insight.extractedData?.diagnoses)
                ? insight.extractedData.diagnoses
                    .map((item) => `${item.system} ${item.code} ${item.description}`)
                    .join(' | ')
                : '';
            /* @Codex */
            const extractedMedications = Array.isArray(insight.extractedData?.medications)
                ? insight.extractedData.medications.join(' | ')
                : '';

            records.push({
                id: `insight:${insight.id}`,
                kind: 'document-insight',
                label: `Documento ${fileName || 'analizzato'}`,
                date: normalizeDate(insight.date),
                content: trimSnippet(
                    [insight.summary, extractedDiagnoses, extractedMedications].filter(Boolean).join('\n'),
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

    return `${SMART_IMPORT_PROMPT}${JSON.stringify(payload, null, 2)}`;
}

function parseAiPayload(response: string): ParsedAiPayload {
    const rawJson = extractJsonBlock(response);
    if (!rawJson) return { diagnoses: [], therapies: [] };

    try {
        const parsed = JSON.parse(rawJson) as { diagnoses?: unknown; therapies?: unknown };

        const diagnoses: ParsedAiDiagnosis[] = [];
        if (Array.isArray(parsed.diagnoses)) {
            for (const value of parsed.diagnoses) {
                if (!value || typeof value !== 'object') continue;
                const record = value as Record<string, unknown>;
                const label = typeof record.label === 'string' ? record.label.trim() : '';
                const icdQuery = typeof record.icdQuery === 'string' ? record.icdQuery.trim() : '';
                const evidence = typeof record.evidence === 'string' ? record.evidence.trim() : '';
                if (!label || !evidence) continue;

                diagnoses.push({
                    label,
                    icdQuery: icdQuery || label,
                    evidence,
                    sourceId: typeof record.sourceId === 'string' ? record.sourceId.trim() : undefined,
                    explicitCode: typeof record.explicitCode === 'string' ? record.explicitCode.trim().toUpperCase() : undefined,
                    confidence: normalizeConfidence(record.confidence),
                });
                if (diagnoses.length >= MAX_SMART_IMPORT_DIAGNOSES) break;
            }
        }

        const therapies: ParsedAiTherapy[] = [];
        if (Array.isArray(parsed.therapies)) {
            for (const value of parsed.therapies) {
                if (!value || typeof value !== 'object') continue;
                const record = value as Record<string, unknown>;
                const drugMention = typeof record.drugMention === 'string' ? record.drugMention.trim() : '';
                const evidence = typeof record.evidence === 'string' ? record.evidence.trim() : '';
                if (!drugMention || !evidence) continue;

                therapies.push({
                    drugMention,
                    drugQuery: typeof record.drugQuery === 'string' && record.drugQuery.trim()
                        ? record.drugQuery.trim()
                        : drugMention,
                    activePrinciple: typeof record.activePrinciple === 'string' ? record.activePrinciple.trim() : undefined,
                    dosage: typeof record.dosage === 'string' ? record.dosage.trim() : undefined,
                    motivation: typeof record.motivation === 'string' ? record.motivation.trim() : undefined,
                    therapyState: normalizeTherapyState(record.therapyState),
                    reviewNote: typeof record.reviewNote === 'string' ? record.reviewNote.trim() : undefined,
                    evidence,
                    sourceId: typeof record.sourceId === 'string' ? record.sourceId.trim() : undefined,
                    confidence: normalizeConfidence(record.confidence),
                });
                if (therapies.length >= MAX_SMART_IMPORT_THERAPIES) break;
            }
        }

        return { diagnoses, therapies: dedupeParsedTherapies(therapies) };
    } catch {
        return { diagnoses: [], therapies: [] };
    }
}

function normalizeParsedTherapyKey(therapy: Pick<ParsedAiTherapy, 'drugMention' | 'activePrinciple' | 'dosage' | 'therapyState'>): string {
    return [
        normalizeText(therapy.drugMention || ''),
        normalizeText(therapy.activePrinciple || ''),
        normalizeText(therapy.dosage || ''),
        therapy.therapyState || 'active',
    ].join('|');
}

function dedupeParsedTherapies(therapies: ParsedAiTherapy[]): ParsedAiTherapy[] {
    const seen = new Set<string>();
    const deduped: ParsedAiTherapy[] = [];

    for (const therapy of therapies) {
        const key = normalizeParsedTherapyKey(therapy);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(therapy);
        if (deduped.length >= MAX_SMART_IMPORT_THERAPIES) break;
    }

    return deduped;
}

function overlapScore(candidate: string, tokens: string[]): number {
    const haystack = normalizeText(candidate);
    return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function rankIcdMatch(
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

async function resolveDiagnosisSuggestion(
    suggestion: ParsedAiDiagnosis,
    sourceMap: Map<string, SmartImportSourceRecord>
): Promise<DiagnosisSmartImportSuggestion> {
    const source = sourceMap.get(suggestion.sourceId || '') || sourceMap.values().next().value as SmartImportSourceRecord | undefined;
    const query = suggestion.icdQuery || suggestion.label;
    let match: DiagnosisSmartImportSuggestion['match'];

    try {
        const results = await searchICDHybrid(query);
        const ranked = results
            .map((result) => ({
                result,
                score: rankIcdMatch(query, suggestion.label, suggestion.explicitCode, result),
            }))
            .sort((left, right) => right.score - left.score);

        const best = ranked[0];
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

function sanitizeDrugSearchText(value: string): string {
    return value
        .replace(/\([^)]*\)/g, ' ')
        .replace(DOSAGE_TOKEN_GLOBAL_REGEX, ' ')
        .replace(/\b(?:x|die|bid|tid|ore|mattino|sera|pranzo|colazione|giorno|giorni|settimana|settimane|verificare|confermare|dose|dosi|cp|cps|cpr|caps(?:ule)?|compress(?:a|e)|gtt|fial(?:a|e)|spruzzi?)\b/gi, ' ')
        .replace(/[,:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildDrugSearchTerms(suggestion: ParsedAiTherapy): string[] {
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

function rankDrugMatch(
    candidate: AifaDrug,
    drugQuery: string,
    activePrinciple: string | undefined,
    drugMention: string
): number {
    const queryTokens = uniqueTokens(tokenize(drugQuery));
    const principleTokens = uniqueTokens(tokenize(activePrinciple || ''));
    const mentionTokens = uniqueTokens(tokenize(drugMention));
    const candidateName = `${candidate.name} ${candidate.activePrinciple || ''} ${candidate.packaging || ''}`;
    const normalizedMention = normalizeText(sanitizeDrugSearchText(drugMention));
    const normalizedQuery = normalizeText(sanitizeDrugSearchText(drugQuery));
    const normalizedPrinciple = normalizeText(sanitizeDrugSearchText(activePrinciple || ''));
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

    return score;
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

function buildTherapyBlockedReason(state: TherapySuggestionState, reviewNote: string | undefined): string | undefined {
    if (state === 'active') return undefined;
    if (reviewNote) return reviewNote;
    if (state === 'transition') return 'Transizione terapeutica da confermare prima dell\'import';
    if (state === 'uncertain') return 'Terapia citata come incerta o da verificare';
    return 'Terapia non attiva nelle fonti correnti';
}

async function resolveTherapySuggestion(
    suggestion: ParsedAiTherapy,
    sourceMap: Map<string, SmartImportSourceRecord>
): Promise<TherapySmartImportSuggestion> {
    const source = sourceMap.get(suggestion.sourceId || '') || sourceMap.values().next().value as SmartImportSourceRecord | undefined;
    const searchTerms = buildDrugSearchTerms(suggestion);
    let match: TherapySmartImportSuggestion['match'];
    let matchType: TherapySmartImportSuggestion['matchType'] = 'none';
    const therapyState = classifyTherapyState(suggestion);

    for (const term of searchTerms) {
        const candidates = await searchDrugCatalog(term);
        if (!candidates.length) continue;

        const ranked = candidates
            .map((candidate) => ({
                candidate,
                score: rankDrugMatch(candidate, suggestion.drugQuery, suggestion.activePrinciple, suggestion.drugMention),
            }))
            .sort((left, right) => right.score - left.score);

        if (ranked[0] && ranked[0].score >= 7) {
            match = {
                aic: ranked[0].candidate.aic,
                name: ranked[0].candidate.name,
                activePrinciple: ranked[0].candidate.activePrinciple,
                atc: ranked[0].candidate.atc,
                company: ranked[0].candidate.company,
            };
            matchType = 'catalog';
            break;
        }
    }

    if (!match && (suggestion.activePrinciple || suggestion.drugMention)) {
        matchType = 'manual';
    }

    const blockedReason = buildTherapyBlockedReason(therapyState, suggestion.reviewNote)
        || (matchType === 'none' ? 'Nessun match farmaco affidabile' : undefined);

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
        canApply: therapyState === 'active' && matchType !== 'none',
        blockedReason,
    };
}

export async function generatePatientSmartImportAnalysis(patientId: string): Promise<PatientSmartImportAnalysis> {
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
    const response = await ai.generate(prompt, undefined, 1400);
    const parsed = parseAiPayload(response);
    const sourceMap = new Map(sourceRecords.map((source) => [source.id, source]));

    const [resolvedDiagnoses, resolvedTherapies] = await Promise.all([
        Promise.all(parsed.diagnoses.map((diagnosis) => resolveDiagnosisSuggestion(diagnosis, sourceMap))),
        Promise.all(parsed.therapies.map((therapy) => resolveTherapySuggestion(therapy, sourceMap))),
    ]);

    const diagnoses = resolvedDiagnoses.map((diagnosis) => (
        diagnosisExists(currentDiagnoses, diagnosis)
            ? {
                ...diagnosis,
                canApply: false,
                blockedReason: 'Diagnosi gia presente in scheda',
            }
            : diagnosis
    ));
    const therapySuggestions = resolvedTherapies.map((therapy) => (
        therapyExists(currentTherapies, therapy)
            ? {
                ...therapy,
                canApply: false,
                blockedReason: 'Terapia gia presente in storico',
            }
            : therapy
    ));

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
    if (!suggestion.match) return true;
    return existing.some((diagnosis) => (
        normalizeText(diagnosis.system) === normalizeText(suggestion.match?.system || '')
        && normalizeText(diagnosis.code) === normalizeText(suggestion.match?.code || '')
    ));
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
            description: suggestion.match.description,
            date: new Date(),
        });
        appliedDiagnosisIds.push(suggestion.id);
    }

    const therapyItems: Therapy[] = [];
    const appliedTherapyIds: string[] = [];
    for (const suggestion of selectedTherapies) {
        if (!suggestion.canApply) continue;
        if (therapyExists([...existingTherapies, ...therapyItems], suggestion)) continue;

        therapyItems.push({
            id: crypto.randomUUID(),
            patientId,
            drugName: suggestion.match?.name || suggestion.drugMention,
            aic: suggestion.match?.aic,
            atc: suggestion.match?.atc,
            activePrinciple: suggestion.match?.activePrinciple || suggestion.activePrinciple,
            dosage: suggestion.dosage || 'Posologia da verificare',
            motivation: suggestion.motivation || suggestion.evidence.excerpt,
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
