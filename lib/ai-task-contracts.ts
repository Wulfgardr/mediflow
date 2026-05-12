/* @Codex */
import { filterServicePrescriptionTherapyCandidates, isServicePrescriptionLikeTherapy } from './prescription-boundary';

/* @Codex */
export const AI_TASK_EXTRACTION_SCHEMA_VERSION = 'mediflow.ai.extract.v1';

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
export interface SmartImportExtractionData {
    diagnoses: SmartImportDiagnosisExtraction[];
    therapies: SmartImportTherapyExtraction[];
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
}

/* @Codex */
export type DocumentSynthesisExtraction = AITaskEnvelope<'document_synthesis', DocumentSynthesisExtractionData>;

const MAX_SHARED_SUMMARY_CHARS = 220;
const MAX_INSIGHT_CLAIM_CHARS = 220;
const MAX_SMART_IMPORT_TEXT_CHARS = 220;
const MAX_DOCUMENT_SUMMARY_CHARS = 700;
const MAX_DOCUMENT_MEDICATION_CHARS = 180;

function stripModelArtifacts(content: string): string {
    return content
        .replace(/<unused94>[\s\S]*?(<unused95>|$)/g, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^Plan:\s*/gim, '')
        .replace(/\r/g, '')
        .trim();
}

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
    return 'medium';
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
    summary: string;
    qualityLevel: DocumentQualityLevel;
    qualityReason: string;
    medications: string[];
    diagnoses: DocumentDiagnosisSuggestionContract[];
    problemStatements: SmartImportDiagnosisExtraction[];
    therapyCandidates: SmartImportTherapyExtraction[];
} | null {
    const rawJson = extractJsonObject(response);
    if (!rawJson) return null;

    try {
        const parsed = JSON.parse(rawJson) as Record<string, unknown>;
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

        return {
            rawJson,
            validJson: true,
            summary: normalizeCompactText(parsed.summary_markdown ?? parsed.summary, MAX_DOCUMENT_SUMMARY_CHARS),
            qualityLevel: normalizeQualityLevel(quality.level),
            qualityReason: normalizeCompactText(quality.reason, MAX_SHARED_SUMMARY_CHARS),
            medications,
            diagnoses,
            problemStatements,
            therapyCandidates,
        };
    } catch {
        return {
            rawJson,
            validJson: false,
            summary: '',
            qualityLevel: 'yellow',
            qualityReason: '',
            medications: [],
            diagnoses: [],
            problemStatements: [],
            therapyCandidates: [],
        };
    }
}

function parseEnvelope(
    response: string,
    expectedTask: AITaskKind
): {
    rawJson: string | null;
    validJson: boolean;
    validTask: boolean;
    summary: string;
    data: Record<string, unknown>;
} {
    const rawJson = extractJsonObject(response);
    if (!rawJson) {
        return {
            rawJson: null,
            validJson: false,
            validTask: false,
            summary: '',
            data: {},
        };
    }

    try {
        const parsed = JSON.parse(rawJson) as Record<string, unknown>;
        const schemaVersion = parsed?.schemaVersion === AI_TASK_EXTRACTION_SCHEMA_VERSION;
        const taskMatches = parsed?.task === expectedTask;
        const data = normalizeTaskData(parsed?.data);

        return {
            rawJson,
            validJson: true,
            validTask: schemaVersion && taskMatches,
            summary: normalizeCompactText(parsed?.summary, MAX_SHARED_SUMMARY_CHARS),
            data,
        };
    } catch {
        return {
            rawJson,
            validJson: false,
            validTask: false,
            summary: '',
            data: {},
        };
    }
}

function renderListSection(title: string, items: string[]): string {
    if (items.length === 0) return '';
    return `**${title}:**\n${items.map((item) => `- ${item}`).join('\n')}`;
}

function buildDocumentFallbackSummary(rawText: string): string {
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

export function extractJsonObject(response: string): string | null {
    const clean = stripModelArtifacts(response);
    const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();

    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return null;
    }

    const fragment = clean.slice(firstBrace, lastBrace + 1).trim();
    const stack: string[] = [];
    let inString = false;
    let escaping = false;

    for (const char of fragment) {
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
            stack.push(char);
            continue;
        }
        if (char === '}' || char === ']') {
            const expected = char === '}' ? '{' : '[';
            if (stack[stack.length - 1] === expected) {
                stack.pop();
            }
        }
    }

    if (inString) {
        return fragment;
    }

    let repaired = fragment.replace(/,\s*$/g, '');
    while (stack.length > 0) {
        const opener = stack.pop();
        repaired += opener === '{' ? '}' : ']';
    }

    return repaired;
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
    if (Array.isArray(envelope.data.therapies)) {
        for (const value of envelope.data.therapies) {
            const normalized = normalizeSmartImportTherapy(value);
            if (!normalized) continue;

            const key = normalizeTherapyKey(normalized);
            if (seenTherapies.has(key)) continue;
            seenTherapies.add(key);
            therapies.push(normalized);

            if (therapies.length >= 10) break;
        }
    }

    return {
        rawJson: envelope.rawJson,
        validJson: envelope.validJson,
        validTask: envelope.validTask,
        value: {
            schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
            task: 'smart_import',
            summary: envelope.summary,
            data: {
                diagnoses,
                therapies,
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
        validTask: legacyPayload ? true : envelope.validTask,
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
            },
        },
    };
}

function buildExtractionPrompt(
    task: AITaskKind,
    taskObjective: string,
    dataShape: string,
    rules: string[],
    contextLabel: string,
    contextBody: string
): string {
    return [
        taskObjective,
        '',
        'Restituisci SOLO JSON valido, senza testo extra, senza backticks, senza commenti.',
        'Usa esattamente questo envelope:',
        '{',
        `  "schemaVersion": "${AI_TASK_EXTRACTION_SCHEMA_VERSION}",`,
        `  "task": "${task}",`,
        '  "summary": "stringa breve in plain text, oppure vuota",',
        `  "data": ${dataShape}`,
        '}',
        '',
        'Regole comuni:',
        '- usa solo doppi apici JSON standard',
        '- non usare null: preferisci stringa vuota o array vuoto',
        '- non aggiungere campi extra',
        ...rules.map((rule) => `- ${rule}`),
        '',
        `${contextLabel}:`,
        contextBody,
    ].join('\n');
}

export function buildPatientInsightExtractionPrompt(contextPrompt: string): string {
    return buildExtractionPrompt(
        'patient_insight',
        [
            'Sei un assistente medico locale.',
            'Obiettivo: estrarre un insight clinico breve, concreto, neutro e orientato al follow-up attuale, senza produrre markdown finale.',
        ].join('\n'),
        `{
    "currentState": ["frase breve con [Sx] o [DATI-INCOMPLETI]"],
    "alerts": ["bullet breve con [Sx] o [DATI-INCOMPLETI]"],
    "nextSteps": ["bullet operativo con [Sx] o [DATI-INCOMPLETI]"],
    "gaps": ["bullet breve con [Sx] o [DATI-INCOMPLETI]"]
  }`,
        [
            'currentState massimo 2 frasi brevi',
            'alerts massimo 2 elementi',
            'nextSteps massimo 3 elementi',
            'gaps massimo 1 elemento e solo se utile',
            'gaps solo per informazioni mancanti che limitano interpretazione, priorita o decisione clinica attuale',
            'currentState descrive il quadro clinico attuale e il follow-up immediato, non deve assorbire alert di sicurezza o monitoraggio attivo',
            'apri currentState dal problema clinico o follow-up piu attuale, non dalla lista completa delle comorbidita',
            'usa la seconda frase di currentState solo se aggiunge un secondo fatto clinico attuale o un follow-up immediato; non usarla per inventariare comorbidita croniche, terapia di sfondo o codici storici non decisivi',
            'se diario o documenti recenti descrivono un episodio acuto, una dimissione o un percorso riabilitativo, tieni entrambe le frasi di currentState ancorate a quell episodio o al suo follow-up immediato',
            'nei documenti recenti di dimissione, PS o riabilitazione, tratta mobilita ridotta, ausili, ADI/FKT e recupero funzionale come follow-up clinico attivo',
            'menziona la storia remota solo se cambia la gestione attuale',
            'non combinare nel currentState il problema attuale con comorbidita croniche non direttamente coinvolte nell evento o follow-up corrente',
            'se valori recenti o controlli pendenti riguardano una cronica attiva, mantieni esplicita la patologia nel currentState',
            'non citare diagnosi codificate o terapie attive di sfondo solo perche presenti nel contesto',
            'nei casi post-dimissione, post-PS o riabilitativi non riportare in nextSteps diagnosi o terapie croniche di sfondo se non sono esplicitamente collegate all episodio attuale o a un controllo pendente',
            'alerts solo per criticita cliniche o di sicurezza chiaramente attive nel contesto locale',
            'usa alerts per peggioramento recente, valori chiaramente anomali, sospensione o stop temporaneo di terapia, episodio acuto non ancora risolto, limitazione funzionale o ausilio che cambia sicurezza o monitoraggio',
            'nei casi post-dimissione o riabilitativi, usa alerts per limiti funzionali, deambulatore, mobilita ridotta o recupero da rivalutare se sono ancora aperti',
            'se un contenuto segnala rischio o richiede sorveglianza ravvicinata, mettilo in alerts anche se spiega il currentState o motiva un nextStep',
            'se non esistono alert reali o di sicurezza, lascia alerts vuoto',
            'se alerts e vuoto, ricontrolla che currentState e nextSteps non stiano nascondendo peggioramento, stop terapeutici, rivalutazioni urgenti, valori anomali o limiti funzionali rilevanti',
            'nextSteps solo se derivano da controlli pendenti, diario recente, osservazioni recenti, documenti recenti o terapie attive',
            'nextSteps deve contenere azioni, controlli o verifiche; non usare nextSteps per spostare fuori da alerts una criticita clinica attiva',
            'lascia gaps vuoto se il caso e gia interpretabile e i prossimi passi sono gia chiari con i dati presenti',
            'in gaps privilegia aderenza, risposta a terapia, andamento funzionale, sintomi non rivalutati o dati che mancano per leggere il problema attuale; evita gap generici che ripetono semplicemente esami gia programmati',
            'non usare gaps per duplicare nextSteps, per elencare dati mancanti ovvi o per riempire spazio',
            'ogni stringa deve gia includere [Sx] o [DATI-INCOMPLETI]',
            'hard fail interno: se anche una sola stringa non contiene [Sx] o [DATI-INCOMPLETI], correggi il JSON prima di rispondere',
            'mantieni sempre i marker [Sx] anche quando riassumi piu fatti clinici nella stessa stringa',
            'usa solo riferimenti [Sx] presenti nel contesto',
            'non usare placeholder come [Sx], [S?] o riferimenti generici: ogni citation deve corrispondere a un id reale presente nel contesto',
            'non usare markdown nelle stringhe oltre ai marker [Sx] o [DATI-INCOMPLETI]',
            'non inventare diagnosi, esami, terapie o fonti',
            'non scrivere frasi rassicuranti o boilerplate come nessuna criticita se il contesto contiene episodio acuto recente, valore anomalo, stop terapeutico, limitazione funzionale o ausilio clinicamente rilevante',
            'evita etichette inferite o enfatiche come fragilita alta, elevato rischio, complesso o pericoloso se non esplicite nelle fonti',
            'non trasformare da soli codici storici, fattori sociali o stili di vita in counselling o piani generici se non esiste follow-up attivo documentato',
            'se il supporto e debole, preferisci un gap esplicito a una raccomandazione speculativa',
            'usa un italiano clinico neutro e non moralizzante',
        ],
        'DATI PAZIENTE',
        contextPrompt,
    );
}

export function buildSmartImportExtractionPrompt(payload: unknown): string {
    return buildExtractionPrompt(
        'smart_import',
        [
            'Sei un assistente clinico locale per MediFlow.',
            'Obiettivo: proporre suggerimenti reviewable da importare nel profilo paziente, senza testo discorsivo fuori dal JSON.',
        ].join('\n'),
        `{
    "diagnoses": [
      {
        "label": "patologia in italiano",
        "icdQuery": "query breve per ICD-11",
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
        "reviewNote": "motivo breve se non immediatamente applicabile",
        "confidence": "high|medium|low",
        "evidence": "breve evidenza testuale locale",
        "sourceId": "id della fonte usata"
      }
    ]
  }`,
        [
            'non inventare dati non supportati dalle fonti',
            'per le diagnosi free-text non inventare codici ICD',
            'escludi negazioni e familiarita',
            'in diagnoses includi solo patologie attuali, attive o rilevanti per la gestione corrente; escludi anamnesi remota risolta o problemi solo storici se non cambiano la gestione attuale',
            'non trasformare da soli fattori di rischio, stili di vita, counselling o sospetti generici in diagnosi strutturate se non sono trattati come problema clinico attivo nelle fonti',
            'label deve restare in italiano clinico sintetico',
            'icdQuery deve essere una query breve e specifica in inglese, adatta alla ricerca WHO ICD-11 ufficiale',
            'sourceId deve coincidere esattamente con un id presente nelle fonti fornite',
            'massimo 5 diagnosi e 10 terapie',
            'ogni terapia deve rappresentare un singolo farmaco distinto',
            'non inserire in therapies prestazioni sanitarie, visite specialistiche, esami, controlli, consulenze, impegnative o referral: non sono farmaci',
            'se una ricetta/impegnativa prescrive una prestazione specialistica, ignorala come terapia anche se usa parole come prescritta o richiesta',
            'per le terapie usa drugQuery come chiave breve per ricerca catalogo AIFA, preferendo brand o principio attivo con strength se esplicita ma senza frequenza, orari o note accessorie',
            'drugMention e activePrinciple devono essere il piu possibile aderenti al testo sorgente; se il principio attivo e ovvio usa una forma compatibile con il catalogo locale AIFA',
            'in therapies includi preferibilmente farmaci attivi con posologia esplicita; se la posologia manca non inventarla',
            'se il documento distingue terapia alla dimissione, terapia domiciliare e terapia di degenza, considera correnti prima la dimissione, poi la domiciliare; non promuovere automaticamente come active i farmaci citati solo nel decorso di ricovero',
            'evidence deve essere un excerpt atomico riferito al singolo farmaco o alla singola diagnosi, non un riassunto di piu elementi',
            'se una terapia e solo proposta, in switch o da confermare, usa therapyState transition o uncertain invece di active',
            'non marcare active una terapia futura, condizionale, da valutare o dipendente da controllo successivo',
            'quando una fonte descrive uno switch terapeutico, marca come transition sia il farmaco in uscita sia quello in ingresso finche il passaggio non e confermato',
            'mantieni evidence, motivation e reviewNote molto brevi e senza ripetere il contesto',
            'non riassumere la scheda paziente fuori dai campi strettamente necessari',
        ],
        'CONTESTO STRUTTURATO',
        JSON.stringify(payload, null, 2),
    );
}

export function buildDocumentSynthesisExtractionPrompt(rawText: string): string {
    return buildExtractionPrompt(
        'document_synthesis',
        [
            'Sei un assistente clinico locale.',
            'Ricevi testo OCR grezzo di un documento medico italiano e devi estrarre solo dati supportati dal testo.',
        ].join('\n'),
        `{
    "qualityLevel": "green|yellow|red",
    "qualityReason": "motivo sintetico della valutazione",
    "medications": [
      "farmaco o principio attivo esplicitamente presente nel documento, con posologia se esplicita"
    ],
    "diagnoses": [
      {
        "code": "codice ICD esplicito nel documento",
        "description": "descrizione clinica associata",
        "system": "ICD-9|ICD-10|ICD-11",
        "evidence": "breve citazione/parafrasi locale del passaggio rilevante",
        "confidence": "high|medium|low"
      }
    ],
    "problemStatements": [
      {
        "label": "problema clinico in italiano",
        "icdQuery": "query breve in inglese per ICD-11",
        "confidence": "high|medium|low",
        "evidence": "breve evidenza testuale locale"
      }
    ],
    "therapyCandidates": [
      {
        "drugMention": "farmaco o principio attivo menzionato",
        "drugQuery": "chiave breve per catalogo AIFA",
        "activePrinciple": "principio attivo se disponibile",
        "dosage": "posologia se disponibile",
        "motivation": "indicazione o contesto clinico se disponibile",
        "therapyState": "active|transition|uncertain|inactive",
        "reviewNote": "motivo breve se non immediatamente applicabile",
        "confidence": "high|medium|low",
        "evidence": "breve evidenza testuale locale"
      }
    ]
  }`,
        [
            'qualityLevel usa green se il contenuto OCR e chiaro, yellow se ambiguo o parziale, red se insufficiente o rumoroso',
            'summary deve essere un riassunto clinico conciso in plain text, senza markdown',
            'summary massimo 2 frasi brevi e non oltre 220 caratteri circa',
            'in medications includi solo terapie esplicite e correnti nel testo OCR, senza duplicati e senza presidi, detergenti o indicazioni non farmacologiche',
            'non inserire in medications o therapyCandidates visite specialistiche, prestazioni, esami, controlli, consulenze, impegnative o referral: sono prescrizioni di prestazione, non farmaci',
            'se il documento e una ricetta/impegnativa per prestazione specialistica, usa summary/quality ma lascia medications e therapyCandidates vuoti salvo farmaci espliciti separati',
            'in diagnoses includi solo patologie con codice ICD esplicito nel testo OCR; se il documento non riporta codici espliciti restituisci diagnoses come array vuoto e non inventare placeholder o code vuoti',
            'in problemStatements includi solo patologie attuali, attive o clinicamente rilevanti per la gestione corrente anche se prive di codice esplicito',
            'problemStatements deve usare label in italiano clinico sintetico e icdQuery breve in inglese',
            'escludi negazioni, familiarita, anamnesi remota risolta, counselling generico e fattori di rischio non trattati come problema clinico attivo',
            'in therapyCandidates includi preferibilmente farmaci attivi con posologia esplicita; se la posologia manca non inventarla',
            'drugQuery deve essere una chiave breve per il catalogo AIFA, preferendo brand o principio attivo con strength se esplicita',
            'se il documento contiene sezioni come terapia alla dimissione o terapia domiciliare, privilegia quelle rispetto ai farmaci descritti solo durante il ricovero',
            'non marcare active antibiotici, profilassi, nutrizione enterale o terapie di degenza se non ricompaiono nella terapia alla dimissione o domiciliare',
            'se una terapia domiciliare pre-ricovero sembra sostituita da una nuova terapia alla dimissione nello stesso ambito terapeutico, usa transition o uncertain per la terapia precedente',
            'se una terapia ha durata breve, data di stop, oppure testo come fino al, poi stop, sospendere, usa transition o inactive invece di active',
            'massimo 6 medications, massimo 4 problemStatements e massimo 6 therapyCandidates; se il documento contiene piu elementi tieni solo quelli piu correnti e clinicamente utili',
            'se una terapia e solo proposta, in switch o da confermare, usa therapyState transition o uncertain invece di active',
            'evidence deve restare atomica e riferita al singolo problema o farmaco',
            'non inventare posologie, farmaci o codici mancanti',
            'mantieni le stringhe molto compatte per restare entro il budget di output',
            'massimo 4 diagnosi con codice esplicito, massimo 4 problemStatements e massimo 6 therapyCandidates',
        ],
        'DOCUMENTO OCR',
        rawText,
    );
}
