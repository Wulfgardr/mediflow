/* @Codex */
import type { DocumentQualityLevel } from './db';
/* @Codex */
import type {
    ExtractedPatientData,
    ExtractedPatientReviewDiagnosis,
    ExtractedPatientReviewTherapy,
} from './pdf-service';
/* @Codex */
import type { SmartImportServicePrescriptionExtraction, TherapySuggestionState } from './ai-task-contracts';
/* @Codex */
import { splitDocumentIntoLines } from './document-excerpt';
/* @Codex */
import { applyPatientImportDecision, buildPatientImportDecision } from './patient-import-decision';

/* @Codex */
export type PatientDocumentReviewFieldKey =
    | 'firstName'
    | 'lastName'
    | 'taxCode'
    | 'birthDate'
    | 'address'
    | 'phone'
    | 'notes';

/* @Codex */
export interface PatientDocumentReviewField {
    key: PatientDocumentReviewFieldKey;
    label: string;
    value: string;
    included: boolean;
    kind: 'text' | 'date' | 'textarea';
    sourceLabel: string;
}

/* @Codex */
export interface PatientDocumentReviewDiagnosis {
    id: string;
    code: string;
    description: string;
    system: 'ICD-9' | 'ICD-10' | 'ICD-11';
    evidence?: string;
    confidence?: 'high' | 'medium' | 'low';
    blockedReason?: string;
    included: boolean;
}

/* @Codex */
export interface PatientDocumentReviewMedication {
    id: string;
    drugName: string;
    dosage?: string;
    activePrinciple?: string;
    motivation?: string;
    aic?: string;
    atc?: string;
    confidence?: 'high' | 'medium' | 'low';
    therapyState: TherapySuggestionState;
    matchType: 'catalog' | 'manual' | 'none';
    evidence?: string;
    blockedReason?: string;
    included: boolean;
    sourceLabel: string;
}

/* @Codex */
export interface PatientDocumentReviewServicePrescription {
    id: string;
    serviceName: string;
    category: SmartImportServicePrescriptionExtraction['category'];
    priority?: string;
    codeSystem?: string;
    serviceCode?: string;
    clinicalQuestion?: string;
    provider?: string;
    prescribedAt?: string;
    requestReference?: string;
    confidence?: SmartImportServicePrescriptionExtraction['confidence'];
    evidence?: string;
    included: boolean;
    sourceLabel: string;
}

/* @Codex */
export interface PatientDocumentReviewDraft {
    source: ExtractedPatientData['source'];
    confidence: number;
    sourceLabel: string;
    sourceExcerpt?: string;
    quality?: {
        level: DocumentQualityLevel;
        reason?: string;
    };
    fields: PatientDocumentReviewField[];
    diagnoses: PatientDocumentReviewDiagnosis[];
    medications: PatientDocumentReviewMedication[];
    servicePrescriptions?: PatientDocumentReviewServicePrescription[];
}

/* @Codex */
export interface ReviewedPatientImportDefaults {
    firstName?: string;
    lastName?: string;
    taxCode?: string;
    birthDate?: Date;
    address?: string;
    phone?: string;
    notes?: string;
    diagnoses?: Array<{
        code: string;
        description: string;
        system: 'ICD-9' | 'ICD-10' | 'ICD-11';
        date: Date;
    }>;
    therapies?: Array<{
        drugName: string;
        dosage: string;
        activePrinciple?: string;
        motivation?: string;
        aic?: string;
        atc?: string;
    }>;
    servicePrescriptions?: Array<{
        serviceName: string;
        category?: SmartImportServicePrescriptionExtraction['category'];
        priority?: string;
        codeSystem?: string;
        serviceCode?: string;
        clinicalQuestion?: string;
        provider?: string;
        prescribedAt?: string;
        requestReference?: string;
        evidence?: string;
    }>;
}

/* @Codex */
function buildSourceLabel(source: ExtractedPatientData['source']): string {
    if (source === 'ai') return 'Documento analizzato con AI locale';
    if (source === 'hybrid') return 'Documento analizzato con AI locale + fallback regex';
    return 'Documento letto con parsing locale';
}

/* @Codex */
function formatDateInputValue(value?: Date): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
    return value.toISOString().split('T')[0];
}

/* @Codex */
function buildField(
    key: PatientDocumentReviewFieldKey,
    label: string,
    kind: PatientDocumentReviewField['kind'],
    value: string | undefined,
    sourceLabel: string
): PatientDocumentReviewField | null {
    const normalized = value?.trim();
    if (!normalized) return null;

    return {
        key,
        label,
        value: normalized,
        included: key !== 'notes',
        kind,
        sourceLabel,
    };
}

/* @Codex */
function dedupeStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const deduped: string[] = [];

    for (const value of values) {
        const normalized = value.trim();
        const key = normalized.toLowerCase();
        if (!normalized || seen.has(key)) continue;
        seen.add(key);
        deduped.push(normalized);
    }

    return deduped;
}

/* @Codex */
function normalizeText(value: string | undefined): string {
    return (value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/* @Codex */
function extractLegacyDosage(value: string): string | undefined {
    const match = value.match(/\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u|cp|cps|cpr|caps(?:ule)?|compress(?:a|e)|gtt|fial(?:a|e)|spruzzi?)\b(?:\s*[^\n,;]*)?/i);
    return match ? match[0].trim() : undefined;
}

/* @Codex */
function buildSuggestedPatientNotes(data: ExtractedPatientData): string | undefined {
    const rawText = data.rawText?.trim() || '';
    if (!rawText) return undefined;

    const lines = splitDocumentIntoLines(rawText);
    const candidates = lines
        .map((line, index) => {
            const lower = line.toLowerCase();
            let score = index;

            if (/\b(controll|rivalut|follow|tac|egds|rx|visita)\w*/i.test(lower)) score += 20;
            if (/\b(tac|egds)\w*/i.test(lower)) score += 8;
            if (/\bimpostazione terapia\b/i.test(lower)) score += 2;
            if (/\b(ricontatt|presa in carico|ricontroll)\w*/i.test(lower)) score += 6;
            if (/\b(terapia|farmac|apr|anamnesi|diagnosi)\w*/i.test(lower)) score -= 8;
            if (/\bterapia alla dimissione\b|\bterapia domiciliare\b/i.test(lower)) score -= 28;
            if (/\b(dieta|fascia|medicaz|evitare sforzi|deambul|mobilizz|cerotto|disinfezion)\w*/i.test(lower)) score -= 16;
            if (/\b(pagina|versione|documento informatico firmato|archiviato|d\.lgs|copia conforme|fax|e-mail|telefono|nosologico)\b/i.test(lower)) score -= 40;
            if (((line.match(/\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u|cp|cps|cpr|fial(?:a|e))\b/gi)) || []).length >= 2) score -= 18;
            if (line.split(/\s+/).length <= 3 && !/\b(tac|egds|rivalut)\w*/i.test(lower)) score -= 10;
            if (line.length > 220) score -= 4;

            return { line: line.trim(), index, score };
        })
        .filter((item) => item.score >= 18)
        .sort((left, right) => right.score - left.score || right.index - left.index)
        .slice(0, 2)
        .sort((left, right) => left.index - right.index)
        .map((item) => item.line.replace(/^[•\-]\s*/, '').trim());

    if (candidates.length === 0) return undefined;

    const text = candidates.join('; ');
    if (!text.trim()) return undefined;
    if (!/\b(controll|rivalut|follow|tac|egds|dieta|medicaz|fascia|sforzi|deambul|mobilizz)\w*/i.test(text)) {
        return undefined;
    }
    if (/\b(pagina|versione|documento informatico firmato|archiviato|d\.lgs|copia conforme|fax|e-mail|telefono|nosologico|data stesura)\b/i.test(text)) {
        return undefined;
    }
    return text.length <= 220 ? text : `${text.slice(0, 219).trimEnd()}...`;
}

/* @Codex */
function canPersistStructuredTherapy(medication: Pick<PatientDocumentReviewMedication, 'drugName' | 'dosage' | 'therapyState'>): boolean {
    return medication.therapyState === 'active'
        && Boolean(medication.drugName.trim())
        && Boolean(medication.dosage?.trim());
}

/* @Codex */
const THERAPY_PLAUSIBILITY_RULES: Array<{
    family: string;
    therapyTokens: string[];
    contextTokens: string[];
}> = [
    {
        family: 'diabetes',
        therapyTokens: ['humalog', 'insulina', 'lispro', 'metformina', 'metformin', 'gliclazide', 'diamicron'],
        contextTokens: ['diabet', 'glicem', 'a11'],
    },
    {
        family: 'nutrition',
        therapyTokens: ['becozym', 'nutridrink', 'vitamin', 'novasource', 'nutriz'],
        contextTokens: ['cachex', 'cachess', 'sarcopen', 'malnutr', 'nutriz', 'imc 14'],
    },
    {
        family: 'gastro',
        therapyTokens: ['pantopraz', 'gastroloc', 'omepraz', 'esomepraz'],
        contextTokens: ['duoden', 'ulcer', 'gastr', 'addom', 'chirurg'],
    },
    {
        family: 'cardio',
        therapyTokens: ['blopress', 'candesartan', 'bisoprololo', 'rytmonorm', 'propafenone'],
        contextTokens: ['fibrill', 'atrial', 'aritm', 'ipertens', 'pression'],
    },
    {
        family: 'rheuma',
        therapyTokens: ['deltacortene', 'prednison', 'prednisone'],
        contextTokens: ['polymyalgia', 'reumat', 'fa22'],
    },
];

/* @Codex */
const MANUAL_REVIEW_ONLY_THERAPY_FAMILIES = new Set(['nutrition']);

/* @Codex */
const CURRENT_THERAPY_EVIDENCE_REGEX = /\bterapia alla dimissione\b|\bterapia domiciliare\b|\bindicazioni terapeutiche(?:\s+e\s+gestionali)?\s+alla\s+dimissione\b|\bpiano terapeutico aifa\b|\bfarmaco prescritto\b/i;

/* @Codex */
function buildClinicalContextProbe(data: ExtractedPatientData): string {
    return normalizeText([
        data.documentSummary,
        data.rawText,
        ...(data.reviewDiagnoses || []).flatMap((diagnosis) => [diagnosis.description, diagnosis.evidence]),
        ...(data.problemStatements || []).flatMap((problem) => [problem.label, problem.evidence]),
        ...(data.diagnoses || []).flatMap((diagnosis) => [diagnosis.description, diagnosis.evidence]),
    ].filter(Boolean).join(' '));
}

/* @Codex */
function buildTherapyProbe(medication: ExtractedPatientReviewTherapy): string {
    return normalizeText([
        medication.drugName,
        medication.activePrinciple,
        medication.motivation,
        medication.evidence,
        medication.atc,
    ].filter(Boolean).join(' '));
}

/* @Codex */
function resolvePlausibleTherapyFamily(
    data: ExtractedPatientData,
    medication: ExtractedPatientReviewTherapy,
): string | null {
    const contextProbe = buildClinicalContextProbe(data);
    const therapyProbe = buildTherapyProbe(medication);
    if (!contextProbe || !therapyProbe) return null;

    const match = THERAPY_PLAUSIBILITY_RULES.find((rule) => (
        rule.therapyTokens.some((token) => therapyProbe.includes(token))
        && rule.contextTokens.some((token) => contextProbe.includes(token))
    ));

    return match?.family || null;
}

/* @Codex */
function buildTherapyDefaultSelection(data: ExtractedPatientData, medication: ExtractedPatientReviewTherapy): {
    included: boolean;
    blockedReason?: string;
} {
    if (!canPersistStructuredTherapy({
        drugName: medication.drugName,
        dosage: medication.dosage,
        therapyState: medication.therapyState,
    })) {
        return {
            included: false,
            blockedReason: medication.blockedReason,
        };
    }

    if (medication.matchType !== 'catalog') {
        return {
            included: false,
            blockedReason: medication.blockedReason || 'Match AIFA da confermare prima dell\'import automatico',
        };
    }

    if (!CURRENT_THERAPY_EVIDENCE_REGEX.test(medication.evidence || '')) {
        return {
            included: false,
            blockedReason: medication.blockedReason || 'Terapia non confermata come corrente nel documento',
        };
    }

    const plausibleFamily = resolvePlausibleTherapyFamily(data, medication);
    if (!plausibleFamily) {
        return {
            included: false,
            blockedReason: medication.blockedReason || 'Verificare coerenza clinica tra terapia e condizioni documentate',
        };
    }

    if (MANUAL_REVIEW_ONLY_THERAPY_FAMILIES.has(plausibleFamily)) {
        return {
            included: false,
            blockedReason: medication.blockedReason || 'Supporto nutrizionale o integrativo: confermare manualmente prima dell\'import',
        };
    }

    return {
        included: true,
        blockedReason: medication.blockedReason,
    };
}

/* @Codex */
function mapReviewDiagnosis(diagnosis: ExtractedPatientReviewDiagnosis, index: number): PatientDocumentReviewDiagnosis {
    return {
        id: `diagnosis:${diagnosis.system}:${diagnosis.code}:${index}`,
        code: diagnosis.code,
        description: diagnosis.description,
        system: diagnosis.system,
        evidence: diagnosis.evidence,
        confidence: diagnosis.confidence,
        blockedReason: diagnosis.blockedReason,
        included: true,
    };
}

/* @Codex */
function mapLegacyMedication(medication: string, sourceLabel: string, index: number): PatientDocumentReviewMedication {
    const dosage = extractLegacyDosage(medication);

    return {
        id: `medication:${index}:${medication}`,
        drugName: medication,
        dosage,
        therapyState: 'active',
        matchType: 'manual',
        blockedReason: dosage ? undefined : 'Posologia da verificare manualmente',
        included: Boolean(dosage),
        sourceLabel,
    };
}

/* @Codex */
function mapReviewTherapy(
    data: ExtractedPatientData,
    medication: ExtractedPatientReviewTherapy,
    sourceLabel: string,
    index: number,
): PatientDocumentReviewMedication {
    const selection = buildTherapyDefaultSelection(data, medication);

    return {
        id: `medication:${index}:${medication.drugName}:${medication.dosage || ''}`,
        drugName: medication.drugName,
        dosage: medication.dosage,
        activePrinciple: medication.activePrinciple,
        motivation: medication.motivation,
        aic: medication.aic,
        atc: medication.atc,
        confidence: medication.confidence,
        therapyState: medication.therapyState,
        matchType: medication.matchType,
        evidence: medication.evidence,
        blockedReason: selection.blockedReason,
        included: selection.included,
        sourceLabel,
    };
}

/* @Codex */
function mapReviewServicePrescription(
    item: SmartImportServicePrescriptionExtraction,
    sourceLabel: string,
    index: number,
): PatientDocumentReviewServicePrescription {
    return {
        id: `service-prescription:${index}:${item.serviceName}`,
        serviceName: item.serviceName,
        category: item.category ?? 'other',
        priority: item.priority,
        codeSystem: item.codeSystem,
        serviceCode: item.serviceCode,
        clinicalQuestion: item.clinicalQuestion,
        provider: item.provider,
        prescribedAt: item.prescribedAt,
        requestReference: item.requestReference,
        confidence: item.confidence,
        evidence: item.evidence,
        included: true,
        sourceLabel,
    };
}

/* @Codex */
export function buildPatientDocumentReviewDraft(data: ExtractedPatientData): PatientDocumentReviewDraft {
    const sourceLabel = buildSourceLabel(data.source);
    const notesValue = buildSuggestedPatientNotes(data) || '';
    const sourceExcerpt = data.rawText?.trim()
        ? data.rawText.trim().replace(/\s+/g, ' ').slice(0, 280)
        : undefined;

    const fields = [
        buildField('firstName', 'Nome', 'text', data.firstName, sourceLabel),
        buildField('lastName', 'Cognome', 'text', data.lastName, sourceLabel),
        buildField('taxCode', 'Codice fiscale', 'text', data.taxCode, sourceLabel),
        buildField('birthDate', 'Data di nascita', 'date', formatDateInputValue(data.birthDate), sourceLabel),
        buildField('address', 'Indirizzo', 'text', data.address, sourceLabel),
        buildField('phone', 'Telefono', 'text', data.phone, sourceLabel),
        buildField('notes', 'Note cliniche', 'textarea', notesValue, 'Follow-up recente dal documento'),
    ].filter((item): item is PatientDocumentReviewField => Boolean(item));

    const diagnosesSource = data.reviewDiagnoses?.length
        ? data.reviewDiagnoses
        : (data.diagnoses || []).map((diagnosis) => ({
            label: diagnosis.description,
            code: diagnosis.code,
            description: diagnosis.description,
            system: diagnosis.system,
            evidence: diagnosis.evidence,
            confidence: diagnosis.confidence,
        } satisfies ExtractedPatientReviewDiagnosis));
    const diagnoses = diagnosesSource.map(mapReviewDiagnosis);

    const medications = data.reviewTherapies?.length
        ? data.reviewTherapies.map((medication, index) => mapReviewTherapy(data, medication, sourceLabel, index))
        : dedupeStrings(data.medications || []).map((medication, index) => mapLegacyMedication(medication, sourceLabel, index));
    const servicePrescriptions = (data.servicePrescriptions || [])
        .map((item, index) => mapReviewServicePrescription(item, sourceLabel, index));

    return {
        source: data.source,
        confidence: data.confidence,
        sourceLabel,
        sourceExcerpt,
        quality: data.documentQuality,
        fields,
        diagnoses,
        medications,
        servicePrescriptions,
    };
}

/* @Codex */
export function applyPatientDocumentReview(draft: PatientDocumentReviewDraft): ReviewedPatientImportDefaults {
    return applyPatientImportDecision(buildPatientImportDecision(draft));
}
