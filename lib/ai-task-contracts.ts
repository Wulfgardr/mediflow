/* @Codex */
import { filterServicePrescriptionTherapyCandidates, isServicePrescriptionLikeTherapy } from './prescription-boundary';
import { stripModelArtifacts } from './model-artifacts';
import { AI_TASK_EXTRACTION_SCHEMA_VERSION } from './ai-task-contract-prompts';

/* @Codex */
export {
    AI_TASK_EXTRACTION_SCHEMA_VERSION,
    buildDocumentSynthesisExtractionPrompt,
    buildPatientInsightExtractionPrompt,
    buildSmartImportExtractionPrompt,
} from './ai-task-contract-prompts';

/* @Codex */
export type AITaskKind = 'patient_insight' | 'smart_import' | 'document_synthesis';

/* @Codex */
export interface AITaskEnvelope<TTask extends AITaskKind, TData> {
    schemaVersion: typeof AI_TASK_EXTRACTION_SCHEMA_VERSION;
    task: TTask;
    summary: string;
    data: TData;
}

/* @Codex */
export interface AITaskParseResult<T> {
    value: T;
    rawJson: string | null;
    validJson: boolean;
    validTask: boolean;
    legacyContract: boolean;
    repairedTruncation: boolean;
}

/* @Codex */
export function isEnvelopeUsable(envelope: { validJson?: unknown; validTask?: unknown }): boolean {
    return envelope.validJson === true && envelope.validTask === true;
}

/* @Codex: un payload che dichiara l'envelope moderno, anche annidato o con case diverso, non e mai legacy */
function declaresModernEnvelope(value: unknown, depth = 0): boolean {
    if (!value || typeof value !== 'object' || depth > 3) return false;
    const record = value as Record<string, unknown>;
    const hasEnvelopeKey = Object.keys(record).some((key) => {
        const normalized = key.toLowerCase();
        return normalized === 'schemaversion' || normalized === 'task';
    });
    if (hasEnvelopeKey) return true;
    return Object.values(record).some((child) => declaresModernEnvelope(child, depth + 1));
}

/* @Codex */
export type SmartImportConfidence = 'high' | 'medium' | 'low';

/* @Codex */
export type TherapySuggestionState = 'active' | 'transition' | 'uncertain' | 'inactive';

/* @Codex */
export type DocumentQualityLevel = 'green' | 'yellow' | 'red';

/* @Codex */
export interface DocumentDiagnosisSuggestionContract {
    code: string;
    description: string;
    system: 'ICD-9' | 'ICD-10' | 'ICD-11';
    evidence?: string;
    confidence?: SmartImportConfidence;
}

/* @Codex */
export interface PatientInsightExtractionData {
    currentState: string[];
    alerts: string[];
    nextSteps: string[];
    gaps: string[];
}

/* @Codex */
export type PatientInsightExtraction = AITaskEnvelope<'patient_insight', PatientInsightExtractionData>;

/* @Codex */
export interface PatientInsightRenderContract {
    currentState: string[];
    alerts: string[];
    nextSteps: string[];
    gaps: string[];
}

/* @Codex */
export interface SmartImportDiagnosisExtraction {
    label: string;
    icdQuery: string;
    confidence: SmartImportConfidence;
    evidence: string;
    sourceId?: string;
    explicitCode?: string;
}

/* @Codex */
export interface SmartImportTherapyExtraction {
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

/* @Codex */
export type SmartImportServicePrescriptionCategory = 'lab' | 'imaging' | 'visit' | 'rehab' | 'screening' | 'procedure' | 'other';

/* @Codex */
export interface SmartImportServicePrescriptionItemExtraction {
    serviceName: string;
    category?: SmartImportServicePrescriptionCategory;
    codeSystem?: string;
    serviceCode?: string;
    confidence: SmartImportConfidence;
    evidence: string;
    sourceId?: string;
}

/* @Codex */
export interface SmartImportServicePrescriptionExtraction {
    serviceName: string;
    category?: SmartImportServicePrescriptionCategory;
    priority?: string;
    codeSystem?: string;
    serviceCode?: string;
    clinicalQuestion?: string;
    provider?: string;
    prescribedAt?: string;
    requestReference?: string;
    confidence: SmartImportConfidence;
    evidence: string;
    sourceId?: string;
    items?: SmartImportServicePrescriptionItemExtraction[];
}

/* @Codex */
export interface SmartImportExtractionData {
    diagnoses: SmartImportDiagnosisExtraction[];
    therapies: SmartImportTherapyExtraction[];
    servicePrescriptions: SmartImportServicePrescriptionExtraction[];
}

/* @Codex */
export type SmartImportExtraction = AITaskEnvelope<'smart_import', SmartImportExtractionData>;

/* @Codex */
export interface DocumentSynthesisExtractionData {
    qualityLevel: DocumentQualityLevel;
    qualityReason?: string;
    medications: string[];
    diagnoses: DocumentDiagnosisSuggestionContract[];
    problemStatements: SmartImportDiagnosisExtraction[];
    therapyCandidates: SmartImportTherapyExtraction[];
    servicePrescriptions: SmartImportServicePrescriptionExtraction[];
}

/* @Codex */
export type DocumentSynthesisExtraction = AITaskEnvelope<'document_synthesis', DocumentSynthesisExtractionData>;

const MAX_SHARED_SUMMARY_CHARS = 220;
const MAX_INSIGHT_CLAIM_CHARS = 220;
const MAX_SMART_IMPORT_TEXT_CHARS = 220;
const MAX_DOCUMENT_SUMMARY_CHARS = 700;
const MAX_DOCUMENT_MEDICATION_CHARS = 180;

function normalizeCompactText(value: unknown, maxChars: number): string {
    if (typeof value !== 'string') return '';
    const clean = stripModelArtifacts(value).replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    return clean.slice(0, maxChars).trim();
}

function normalizeStringArray(value: unknown, maxItems: number, maxChars: number): string[] {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const items: string[] = [];

    for (const entry of value) {
        const normalized = normalizeCompactText(entry, maxChars)
            .replace(/^\s*(?:[-*]|\d+\.)\s*/, '')
            .trim();
        if (!normalized) continue;

        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(normalized);

        if (items.length >= maxItems) break;
    }

    return items;
}

function normalizeConfidence(value: unknown): SmartImportConfidence {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
        return normalized;
    }
    return 'low';
}

function normalizeDiagnosisSystem(value: unknown): DocumentDiagnosisSuggestionContract['system'] | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase().replace(/\s+/g, '');
    if (normalized === 'ICD-9' || normalized === 'ICD9') return 'ICD-9';
    if (normalized === 'ICD-10' || normalized === 'ICD10') return 'ICD-10';
    if (normalized === 'ICD-11' || normalized === 'ICD11') return 'ICD-11';
    return null;
}

function normalizeQualityLevel(value: unknown): DocumentQualityLevel {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'green' || normalized === 'yellow' || normalized === 'red') {
        return normalized;
    }
    return 'yellow';
}

function normalizeTaskData(
    value: unknown
): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function parseLegacyDocumentSynthesisPayload(response: string): {
    rawJson: string | null;
    validJson: boolean;
    repairedTruncation: boolean;
    summary: string;
    qualityLevel: DocumentQualityLevel;
    qualityReason: string;
    medications: string[];
    diagnoses: DocumentDiagnosisSuggestionContract[];
    problemStatements: SmartImportDiagnosisExtraction[];
    therapyCandidates: SmartImportTherapyExtraction[];
    servicePrescriptions: SmartImportServicePrescriptionExtraction[];
} | null {
    const extraction = extractJsonObject(response);
    if (!extraction) return null;
    const { rawJson, repairedTruncation } = extraction;

    try {
        const parsed = JSON.parse(rawJson) as Record<string, unknown>;
        if (declaresModernEnvelope(parsed)) {
            return null;
        }
        const hasLegacySummary = Boolean(normalizeCompactText(parsed.summary_markdown ?? parsed.summary, MAX_DOCUMENT_SUMMARY_CHARS));
        const hasLegacyFields = ['quality', 'qualityLevel', 'medications', 'diagnoses', 'problemStatements', 'therapyCandidates', 'servicePrescriptions']
            .some((key) => Object.prototype.hasOwnProperty.call(parsed, key));
        if (!hasLegacySummary || !hasLegacyFields) return null;
        const quality = normalizeTaskData(parsed.quality);
        const medications = Array.isArray(parsed.medications)
            ? Array.from(
                new Set(
                    parsed.medications
                        .map(normalizeMedication)
                        .filter((item): item is string => Boolean(item)),
                ),
            )
            : [];
        const diagnoses = Array.isArray(parsed.diagnoses)
            ? parsed.diagnoses
                .map(normalizeDocumentDiagnosis)
                .filter((item): item is DocumentDiagnosisSuggestionContract => Boolean(item))
            : [];
        const problemStatements = Array.isArray(parsed.problemStatements)
            ? parsed.problemStatements
                .map(normalizeSmartImportDiagnosis)
                .filter((item): item is SmartImportDiagnosisExtraction => Boolean(item))
            : [];
        const therapyCandidates = Array.isArray(parsed.therapyCandidates)
            ? parsed.therapyCandidates
                .map(normalizeSmartImportTherapy)
                .filter((item): item is SmartImportTherapyExtraction => Boolean(item))
            : [];
        const servicePrescriptions = Array.isArray(parsed.servicePrescriptions)
            ? parsed.servicePrescriptions
                .map(normalizeServicePrescription)
                .filter((item): item is SmartImportServicePrescriptionExtraction => Boolean(item))
            : [];

        return {
            rawJson,
            validJson: true,
            repairedTruncation,
            summary: normalizeCompactText(parsed.summary_markdown ?? parsed.summary, MAX_DOCUMENT_SUMMARY_CHARS),
            qualityLevel: normalizeQualityLevel(quality.level),
            qualityReason: normalizeCompactText(quality.reason, MAX_SHARED_SUMMARY_CHARS),
            medications,
            diagnoses,
            problemStatements,
            therapyCandidates,
            servicePrescriptions,
        };
    } catch {
        return null;
    }
}

function parseEnvelope(
    response: string,
    expectedTask: AITaskKind
): {
    rawJson: string | null;
    validJson: boolean;
    validTask: boolean;
    repairedTruncation: boolean;
    summary: string;
    data: Record<string, unknown>;
} {
    const extraction = extractJsonObject(response);
    if (!extraction) {
        return {
            rawJson: null,
            validJson: false,
            validTask: false,
            repairedTruncation: false,
            summary: '',
            data: {},
        };
    }

    const { rawJson, repairedTruncation } = extraction;

    try {
        const parsed = JSON.parse(rawJson) as Record<string, unknown>;
        const schemaVersion = parsed?.schemaVersion === AI_TASK_EXTRACTION_SCHEMA_VERSION;
        const taskMatches = parsed?.task === expectedTask;
        const data = normalizeTaskData(parsed?.data);

        return {
            rawJson,
            validJson: true,
            validTask: schemaVersion && taskMatches,
            repairedTruncation,
            summary: normalizeCompactText(parsed?.summary, MAX_SHARED_SUMMARY_CHARS),
            data,
        };
    } catch {
        return {
            rawJson,
            validJson: false,
            validTask: false,
            repairedTruncation,
            summary: '',
            data: {},
        };
    }
}

function renderListSection(title: string, items: string[]): string {
    if (items.length === 0) return '';
    return `**${title}:**\n${items.map((item) => `- ${item}`).join('\n')}`;
}

export function buildDocumentFallbackSummary(rawText: string): string {
    const normalized = rawText
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 6)
        .join('\n');

    return normalized
        ? `Riassunto clinico: ${normalized.slice(0, MAX_DOCUMENT_SUMMARY_CHARS)}`
        : 'Documento scannerizzato. Riassunto non disponibile.';
}

function normalizeMedication(value: unknown): string | null {
    const normalized = normalizeCompactText(value, MAX_DOCUMENT_MEDICATION_CHARS);
    return normalized.length >= 3 ? normalized : null;
}

function normalizeDocumentDiagnosis(value: unknown): DocumentDiagnosisSuggestionContract | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    const code = normalizeCompactText(record.code, 32).toUpperCase();
    const description = normalizeCompactText(record.description, 160);
    const system = normalizeDiagnosisSystem(record.system);

    if (!code || !description || !system) return null;

    return {
        code,
        description,
        system,
        evidence: normalizeCompactText(record.evidence, 220) || undefined,
        confidence: normalizeConfidence(record.confidence),
    };
}

function normalizeSmartImportDiagnosis(value: unknown): SmartImportDiagnosisExtraction | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    const label = normalizeCompactText(record.label, MAX_SMART_IMPORT_TEXT_CHARS);
    const evidence = normalizeCompactText(record.evidence, MAX_SMART_IMPORT_TEXT_CHARS);

    if (!label || !evidence) return null;

    return {
        label,
        icdQuery: normalizeCompactText(record.icdQuery, MAX_SMART_IMPORT_TEXT_CHARS) || label,
        confidence: normalizeConfidence(record.confidence),
        evidence,
        sourceId: normalizeCompactText(record.sourceId, 80) || undefined,
        explicitCode: normalizeCompactText(record.explicitCode, 32).toUpperCase() || undefined,
    };
}

function normalizeServicePrescriptionCategory(value: unknown): SmartImportServicePrescriptionCategory | undefined {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'lab' || normalized === 'laboratorio') return 'lab';
    if (normalized === 'imaging' || normalized === 'radiologia' || normalized === 'diagnostica') return 'imaging';
    if (normalized === 'visit' || normalized === 'visita') return 'visit';
    if (normalized === 'rehab' || normalized === 'riabilitazione' || normalized === 'fisioterapia') return 'rehab';
    if (normalized === 'screening') return 'screening';
    if (normalized === 'procedure' || normalized === 'procedura') return 'procedure';
    if (normalized === 'other' || normalized === 'altro') return 'other';
    return undefined;
}

/* @Codex */
function normalizeServicePrescriptionItem(value: unknown, parent: { category?: SmartImportServicePrescriptionCategory; evidence: string; sourceId?: string }): SmartImportServicePrescriptionItemExtraction | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    const serviceName = normalizeCompactText(
        record.serviceName ?? record.name ?? record.display ?? record.label,
        MAX_SMART_IMPORT_TEXT_CHARS,
    );
    const evidence = normalizeCompactText(record.evidence, MAX_SMART_IMPORT_TEXT_CHARS) || parent.evidence;
    if (!serviceName || !evidence) return null;

    return {
        serviceName,
        category: normalizeServicePrescriptionCategory(record.category) ?? parent.category ?? inferServicePrescriptionCategory(`${serviceName} ${evidence}`),
        codeSystem: normalizeCompactText(record.codeSystem, 80) || undefined,
        serviceCode: normalizeCompactText(record.serviceCode ?? record.code, 80) || undefined,
        confidence: normalizeConfidence(record.confidence),
        evidence,
        sourceId: normalizeCompactText(record.sourceId, 80) || parent.sourceId,
    };
}

function inferServicePrescriptionCategory(text: string): SmartImportServicePrescriptionCategory {
    const normalized = text
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    if (/\b(?:emocromo|creatinina|glicemia|hba1c|urine|colesterolo|pcr|proteina c reattiva|prelievo|laboratorio)\b/.test(normalized)) return 'lab';
    if (/\b(?:ecografia|ecocolordoppler|eco|rx|radiografia|tac|tc|rm|risonanza|ecg|elettrocardiogramma|spirometria)\b/.test(normalized)) return 'imaging';
    if (/\b(?:fisioterapia|riabilitazione|riabilitativa|fkt)\b/.test(normalized)) return 'rehab';
    if (/\b(?:screening)\b/.test(normalized)) return 'screening';
    if (/\b(?:visita|consulto|consulenza|controllo specialistico)\b/.test(normalized)) return 'visit';
    if (/\b(?:procedura|prestazione)\b/.test(normalized)) return 'procedure';
    return 'other';
}

function normalizeServicePrescription(value: unknown): SmartImportServicePrescriptionExtraction | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    const serviceName = normalizeCompactText(
        record.serviceName ?? record.name ?? record.display ?? record.drugMention,
        MAX_SMART_IMPORT_TEXT_CHARS,
    );
    const evidence = normalizeCompactText(record.evidence, MAX_SMART_IMPORT_TEXT_CHARS)
        || normalizeCompactText(record.clinicalQuestion ?? record.motivation, MAX_SMART_IMPORT_TEXT_CHARS);

    if (!serviceName || !evidence) return null;

    const normalized: SmartImportServicePrescriptionExtraction = {
        serviceName,
        category: normalizeServicePrescriptionCategory(record.category) ?? inferServicePrescriptionCategory(`${serviceName} ${evidence}`),
        priority: normalizeCompactText(record.priority, 16).toUpperCase() || undefined,
        codeSystem: normalizeCompactText(record.codeSystem, 80) || undefined,
        serviceCode: normalizeCompactText(record.serviceCode ?? record.code, 80) || undefined,
        clinicalQuestion: normalizeCompactText(record.clinicalQuestion ?? record.motivation, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        provider: normalizeCompactText(record.provider, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        prescribedAt: normalizeCompactText(record.prescribedAt, 32) || undefined,
        requestReference: normalizeCompactText(record.requestReference, 80) || undefined,
        confidence: normalizeConfidence(record.confidence),
        evidence,
        sourceId: normalizeCompactText(record.sourceId, 80) || undefined,
    };
    const rawItems = Array.isArray(record.items) ? record.items : [];
    const items = rawItems
        .map((item) => normalizeServicePrescriptionItem(item, normalized))
        .filter((item): item is SmartImportServicePrescriptionItemExtraction => Boolean(item));
    if (items.length > 0) normalized.items = items.slice(0, 20);
    return normalized;
}

function normalizeServicePrescriptionFromTherapyLike(value: unknown): SmartImportServicePrescriptionExtraction | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const candidate = {
        drugMention: normalizeCompactText(record.drugMention, MAX_SMART_IMPORT_TEXT_CHARS),
        drugQuery: normalizeCompactText(record.drugQuery, MAX_SMART_IMPORT_TEXT_CHARS),
        activePrinciple: normalizeCompactText(record.activePrinciple, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        dosage: normalizeCompactText(record.dosage, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        motivation: normalizeCompactText(record.motivation, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        reviewNote: normalizeCompactText(record.reviewNote, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        evidence: normalizeCompactText(record.evidence, MAX_SMART_IMPORT_TEXT_CHARS),
    };
    if (!isServicePrescriptionLikeTherapy(candidate)) return null;

    return normalizeServicePrescription({
        serviceName: candidate.drugMention || candidate.drugQuery,
        category: inferServicePrescriptionCategory([candidate.drugMention, candidate.drugQuery, candidate.evidence].join(' ')),
        clinicalQuestion: candidate.motivation || candidate.reviewNote,
        confidence: record.confidence,
        evidence: candidate.evidence || candidate.motivation || candidate.reviewNote,
        sourceId: record.sourceId,
    });
}

function servicePrescriptionDedupeKey(item: Pick<SmartImportServicePrescriptionExtraction, 'serviceName' | 'serviceCode'>): string {
    const code = normalizeCompactText(item.serviceCode, 80).toLowerCase();
    if (code) return `code:${code}`;
    return normalizeCompactText(item.serviceName, MAX_SMART_IMPORT_TEXT_CHARS)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\b(?:di controllo|con formula(?: leucocitaria)?|completo con formula|completo)\b/g, '')
        .replace(/\b\d+\s+sedut[ae]\b/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function normalizeTherapyKey(therapy: Pick<SmartImportTherapyExtraction, 'drugMention' | 'activePrinciple' | 'dosage' | 'therapyState'>): string {
    return [
        normalizeCompactText(therapy.drugMention, MAX_SMART_IMPORT_TEXT_CHARS).toLowerCase(),
        normalizeCompactText(therapy.activePrinciple, MAX_SMART_IMPORT_TEXT_CHARS).toLowerCase(),
        normalizeCompactText(therapy.dosage, MAX_SMART_IMPORT_TEXT_CHARS).toLowerCase(),
        therapy.therapyState || 'active',
    ].join('|');
}

export function normalizeTherapyState(value: unknown): TherapySuggestionState | undefined {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'active' || normalized === 'transition' || normalized === 'uncertain' || normalized === 'inactive') {
        return normalized;
    }
    return undefined;
}

function normalizeSmartImportTherapy(value: unknown): SmartImportTherapyExtraction | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    const drugMention = normalizeCompactText(record.drugMention, MAX_SMART_IMPORT_TEXT_CHARS);
    const evidence = normalizeCompactText(record.evidence, MAX_SMART_IMPORT_TEXT_CHARS);

    if (!drugMention || !evidence) return null;

    const therapy = {
        drugMention,
        drugQuery: normalizeCompactText(record.drugQuery, MAX_SMART_IMPORT_TEXT_CHARS) || drugMention,
        activePrinciple: normalizeCompactText(record.activePrinciple, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        dosage: normalizeCompactText(record.dosage, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        motivation: normalizeCompactText(record.motivation, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        therapyState: normalizeTherapyState(record.therapyState),
        reviewNote: normalizeCompactText(record.reviewNote, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        confidence: normalizeConfidence(record.confidence),
        evidence,
        sourceId: normalizeCompactText(record.sourceId, 80) || undefined,
    };

    return isServicePrescriptionLikeTherapy(therapy) ? null : therapy;
}

export interface ExtractedJsonObject {
    rawJson: string;
    repairedTruncation: boolean;
}

interface JsonContainer {
    opener: '{' | '[';
    parent: JsonContainer | null;
}

// @Codex: chiude solo i contenitori osservati nello stesso prefisso JSON.
function closeJsonContainers(fragment: string, container: JsonContainer | null): string {
    let closed = fragment;
    for (let current = container; current; current = current.parent) {
        closed += current.opener === '{' ? '}' : ']';
    }
    return closed;
}

// @Codex: delimita una radice completa senza interpretarne ancora il contenuto.
function extractBalancedJsonValue(candidate: string, rootStart: number): string | null {
    let container: JsonContainer | null = null;
    let inString = false;
    let escaping = false;

    for (let index = rootStart; index < candidate.length; index += 1) {
        const char = candidate[index];
        if (inString) {
            if (escaping) {
                escaping = false;
                continue;
            }
            if (char === '\\') {
                escaping = true;
                continue;
            }
            if (char === '"') inString = false;
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{' || char === '[') {
            container = { opener: char, parent: container };
            continue;
        }
        if (char === '}' || char === ']') {
            const expected = char === '}' ? '{' : '[';
            if (container?.opener !== expected) return null;
            container = container.parent;
            if (!container) return candidate.slice(rootStart, index + 1);
        }
    }

    return null;
}

// @Codex: una riparazione dichiarata deve essere un oggetto JSON parsabile.
function isParsableJsonObject(value: string, requireMember = false): boolean {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
        return !requireMember || Object.keys(parsed).length > 0;
    } catch {
        return false;
    }
}

export function extractJsonObject(response: string): ExtractedJsonObject | null {
    const clean = stripModelArtifacts(response);
    const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
    // @Codex: usa lo stesso scanner per risposte libere e blocchi JSON recintati.
    const fencedCandidate = fenced?.[1]?.trim();
    const candidate = fencedCandidate && /[\[{]/.test(fencedCandidate)
        ? fencedCandidate
        : clean;
    let rootStart = -1;
    let searchStart = 0;

    while (searchStart < candidate.length) {
        const nextBrace = candidate.indexOf('{', searchStart);
        const nextBracket = candidate.indexOf('[', searchStart);
        if (nextBrace === -1 && nextBracket === -1) return null;

        if (nextBrace !== -1 && (nextBracket === -1 || nextBrace < nextBracket)) {
            rootStart = nextBrace;
            break;
        }

        const arrayCandidate = extractBalancedJsonValue(candidate, nextBracket);
        if (!arrayCandidate) return null;
        try {
            if (Array.isArray(JSON.parse(arrayCandidate))) {
                return { rawJson: arrayCandidate, repairedTruncation: false };
            }
        } catch {
            // Un blocco bilanciato ma non JSON puo essere un marcatore come [S1].
        }
        searchStart = nextBracket + arrayCandidate.length;
    }

    if (rootStart === -1) return null;

    const fragment = candidate.slice(rootStart).trim();
    let container: JsonContainer | null = null;
    let lastCommaCheckpoint: { endIndex: number; container: JsonContainer } | null = null;
    let inString = false;
    let escaping = false;
    let mismatchedClosing = false;

    for (let index = 0; index < fragment.length; index += 1) {
        const char = fragment[index];
        if (inString) {
            if (escaping) {
                escaping = false;
                continue;
            }
            if (char === '\\') {
                escaping = true;
                continue;
            }
            if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{' || char === '[') {
            container = { opener: char, parent: container };
            continue;
        }
        if (char === '}' || char === ']') {
            const expected = char === '}' ? '{' : '[';
            if (container?.opener === expected) {
                container = container.parent;
                if (!container) {
                    return {
                        rawJson: fragment.slice(0, index + 1),
                        repairedTruncation: false,
                    };
                }
            } else {
                mismatchedClosing = true;
            }
            continue;
        }
        if (char === ',' && container) {
            lastCommaCheckpoint = { endIndex: index, container };
        }
    }

    if (mismatchedClosing || !container) return null;

    let repairablePrefix = inString
        ? fragment
        : fragment.replace(/,\s*$/g, '');
    if (inString) {
        if (escaping) repairablePrefix = repairablePrefix.slice(0, -1);
        repairablePrefix += '"';
    }

    const repaired = closeJsonContainers(repairablePrefix, container);
    if (isParsableJsonObject(repaired, true)) {
        return {
            rawJson: repaired,
            repairedTruncation: true,
        };
    }

    if (lastCommaCheckpoint) {
        const completePrefix = fragment
            .slice(0, lastCommaCheckpoint.endIndex)
            .trimEnd();
        const fallback = closeJsonContainers(completePrefix, lastCommaCheckpoint.container);
        if (isParsableJsonObject(fallback, true)) {
            return {
                rawJson: fallback,
                repairedTruncation: true,
            };
        }
    }

    return null;
}

export function parsePatientInsightExtractionResponse(response: string): AITaskParseResult<PatientInsightExtraction> {
    const envelope = parseEnvelope(response, 'patient_insight');
    const currentState = normalizeStringArray(envelope.data.currentState, 2, MAX_INSIGHT_CLAIM_CHARS);
    const alerts = normalizeStringArray(envelope.data.alerts, 2, MAX_INSIGHT_CLAIM_CHARS);
    const nextSteps = normalizeStringArray(envelope.data.nextSteps, 3, MAX_INSIGHT_CLAIM_CHARS);
    const gaps = normalizeStringArray(envelope.data.gaps, 1, MAX_INSIGHT_CLAIM_CHARS);

    return {
        rawJson: envelope.rawJson,
        validJson: envelope.validJson,
        validTask: envelope.validTask,
        legacyContract: false,
        repairedTruncation: envelope.repairedTruncation,
        value: {
            schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
            task: 'patient_insight',
            summary: envelope.summary,
            data: {
                currentState,
                alerts,
                nextSteps,
                gaps,
            },
        },
    };
}

export function toPatientInsightRenderContract(extraction: PatientInsightExtraction): PatientInsightRenderContract {
    return {
        currentState: extraction.data.currentState,
        alerts: extraction.data.alerts,
        nextSteps: extraction.data.nextSteps,
        gaps: extraction.data.gaps,
    };
}

export function renderPatientInsightMarkdown(render: PatientInsightRenderContract): string {
    const currentState = render.currentState.length > 0
        ? render.currentState.join(' ')
        : 'Supporto locale insufficiente o incoerente per un insight clinico affidabile. [DATI-INCOMPLETI]';

    return [
        `**Quadro attuale:** ${currentState}`,
        renderListSection('Attenzioni', render.alerts),
        renderListSection('Prossimi passi', render.nextSteps),
        renderListSection('Gap da chiarire', render.gaps),
    ].filter(Boolean).join('\n\n');
}

export function parseSmartImportExtractionResponse(response: string): AITaskParseResult<SmartImportExtraction> {
    const envelope = parseEnvelope(response, 'smart_import');

    const diagnoses: SmartImportDiagnosisExtraction[] = [];
    if (Array.isArray(envelope.data.diagnoses)) {
        for (const value of envelope.data.diagnoses) {
            const normalized = normalizeSmartImportDiagnosis(value);
            if (!normalized) continue;
            diagnoses.push(normalized);
            if (diagnoses.length >= 5) break;
        }
    }

    const seenTherapies = new Set<string>();
    const therapies: SmartImportTherapyExtraction[] = [];
    const servicePrescriptions: SmartImportServicePrescriptionExtraction[] = [];
    if (Array.isArray(envelope.data.therapies)) {
        for (const value of envelope.data.therapies) {
            const servicePrescription = normalizeServicePrescriptionFromTherapyLike(value);
            if (servicePrescription) {
                servicePrescriptions.push(servicePrescription);
                continue;
            }

            const normalized = normalizeSmartImportTherapy(value);
            if (!normalized) continue;

            const key = normalizeTherapyKey(normalized);
            if (seenTherapies.has(key)) continue;
            seenTherapies.add(key);
            therapies.push(normalized);

            if (therapies.length >= 10) break;
        }
    }
    if (Array.isArray(envelope.data.servicePrescriptions)) {
        for (const value of envelope.data.servicePrescriptions) {
            const normalized = normalizeServicePrescription(value);
            if (!normalized) continue;
            if (servicePrescriptions.findIndex((item) => servicePrescriptionDedupeKey(item) === servicePrescriptionDedupeKey(normalized)) >= 0) continue;
            servicePrescriptions.push(normalized);
            if (servicePrescriptions.length >= 10) break;
        }
    }

    return {
        rawJson: envelope.rawJson,
        validJson: envelope.validJson,
        validTask: envelope.validTask,
        legacyContract: false,
        repairedTruncation: envelope.repairedTruncation,
        value: {
            schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
            task: 'smart_import',
            summary: envelope.summary,
            data: {
                diagnoses,
                therapies,
                servicePrescriptions: servicePrescriptions.slice(0, 10),
            },
        },
    };
}

export function parseDocumentSynthesisExtractionResponse(
    response: string,
    rawText: string
): AITaskParseResult<DocumentSynthesisExtraction> {
    const envelope = parseEnvelope(response, 'document_synthesis');
    const legacyPayload = !envelope.validTask
        ? parseLegacyDocumentSynthesisPayload(response)
        : null;

    const medications = legacyPayload
        ? legacyPayload.medications
        : Array.isArray(envelope.data.medications)
            ? Array.from(
                new Set(
                    envelope.data.medications
                        .map(normalizeMedication)
                        .filter((item): item is string => Boolean(item)),
                ),
            )
            : [];
    const filteredMedications = medications.filter((medication) => !isServicePrescriptionLikeTherapy({
        drugMention: medication,
        drugQuery: medication,
        evidence: medication,
    }));

    const diagnoses = legacyPayload
        ? legacyPayload.diagnoses
        : Array.isArray(envelope.data.diagnoses)
            ? envelope.data.diagnoses
                .map(normalizeDocumentDiagnosis)
                .filter((item): item is DocumentDiagnosisSuggestionContract => Boolean(item))
            : [];
    const problemStatements = legacyPayload
        ? legacyPayload.problemStatements
        : Array.isArray(envelope.data.problemStatements)
            ? envelope.data.problemStatements
                .map(normalizeSmartImportDiagnosis)
                .filter((item): item is SmartImportDiagnosisExtraction => Boolean(item))
            : [];
    const therapyCandidates = legacyPayload
        ? legacyPayload.therapyCandidates
        : Array.isArray(envelope.data.therapyCandidates)
            ? envelope.data.therapyCandidates
                .map(normalizeSmartImportTherapy)
                .filter((item): item is SmartImportTherapyExtraction => Boolean(item))
            : [];
    const filteredTherapyCandidates = filterServicePrescriptionTherapyCandidates(therapyCandidates);
    const explicitServicePrescriptions = legacyPayload
        ? legacyPayload.servicePrescriptions
        : Array.isArray(envelope.data.servicePrescriptions)
            ? envelope.data.servicePrescriptions
                .map(normalizeServicePrescription)
                .filter((item): item is SmartImportServicePrescriptionExtraction => Boolean(item))
            : [];
    const medicationServicePrescriptions = medications
        .map((medication) => normalizeServicePrescriptionFromTherapyLike({
            drugMention: medication,
            drugQuery: medication,
            evidence: medication,
            confidence: 'medium',
        }))
        .filter((item): item is SmartImportServicePrescriptionExtraction => Boolean(item));
    const therapyServicePrescriptions = Array.isArray(envelope.data.therapyCandidates)
        ? envelope.data.therapyCandidates
            .map(normalizeServicePrescriptionFromTherapyLike)
            .filter((item): item is SmartImportServicePrescriptionExtraction => Boolean(item))
        : [];
    const servicePrescriptions = [...explicitServicePrescriptions, ...medicationServicePrescriptions, ...therapyServicePrescriptions]
        .filter((item, index, list) => (
            list.findIndex((candidate) => servicePrescriptionDedupeKey(candidate) === servicePrescriptionDedupeKey(item)) === index
        ))
        .slice(0, 10);

    const summary = (legacyPayload?.summary || envelope.summary) || buildDocumentFallbackSummary(rawText);
    const qualityLevel = legacyPayload?.qualityLevel ?? normalizeQualityLevel(envelope.data.qualityLevel);
    const qualityReason = legacyPayload?.qualityReason
        || normalizeCompactText(envelope.data.qualityReason, MAX_SHARED_SUMMARY_CHARS)
        || ((legacyPayload?.validJson || envelope.validJson)
            ? (diagnoses.length > 0 || filteredMedications.length > 0
                ? 'Dati clinici strutturati estratti'
                : 'Analisi completata con dati parziali')
            : 'JSON del modello non valido');

    return {
        rawJson: legacyPayload?.rawJson ?? envelope.rawJson,
        validJson: legacyPayload?.validJson ?? envelope.validJson,
        validTask: legacyPayload ? legacyPayload.validJson : envelope.validTask,
        legacyContract: Boolean(legacyPayload),
        repairedTruncation: legacyPayload?.repairedTruncation ?? envelope.repairedTruncation,
        value: {
            schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
            task: 'document_synthesis',
            summary,
            data: {
                qualityLevel,
                qualityReason,
                medications: filteredMedications,
                diagnoses,
                problemStatements,
                therapyCandidates: filteredTherapyCandidates,
                servicePrescriptions,
            },
        },
    };
}
