/* @Codex */
import type { DocumentQualityLevel } from './db';
/* @Codex */
import type { ExtractedPatientData } from './pdf-service';

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
    included: boolean;
}

/* @Codex */
export interface PatientDocumentReviewMedication {
    id: string;
    label: string;
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
        included: true,
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
function buildMedicationNoteBlock(medications: string[]): string | undefined {
    if (medications.length === 0) return undefined;

    return [
        'Terapie candidate da documento (da riconciliare dopo la creazione scheda):',
        ...medications.map((medication) => `- ${medication}`),
    ].join('\n');
}

/* @Codex */
export function buildPatientDocumentReviewDraft(data: ExtractedPatientData): PatientDocumentReviewDraft {
    const sourceLabel = buildSourceLabel(data.source);
    const notesValue = data.documentSummary?.trim() || data.notes?.trim() || '';
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
        buildField('notes', 'Note cliniche', 'textarea', notesValue, data.documentSummary ? 'Sintesi documento' : sourceLabel),
    ].filter((item): item is PatientDocumentReviewField => Boolean(item));

    const diagnoses = (data.diagnoses || []).map((diagnosis, index) => ({
        id: `diagnosis:${diagnosis.system}:${diagnosis.code}:${index}`,
        code: diagnosis.code,
        description: diagnosis.description,
        system: diagnosis.system,
        evidence: diagnosis.evidence,
        confidence: diagnosis.confidence,
        included: true,
    }));

    const medications = dedupeStrings(data.medications || []).map((medication, index) => ({
        id: `medication:${index}:${medication}`,
        label: medication,
        included: true,
        sourceLabel,
    }));

    return {
        source: data.source,
        confidence: data.confidence,
        sourceLabel,
        sourceExcerpt,
        quality: data.documentQuality,
        fields,
        diagnoses,
        medications,
    };
}

/* @Codex */
export function applyPatientDocumentReview(draft: PatientDocumentReviewDraft): ReviewedPatientImportDefaults {
    const nextDefaults: ReviewedPatientImportDefaults = {};
    const notesParts: string[] = [];

    for (const field of draft.fields) {
        if (!field.included) continue;

        const value = field.value.trim();
        if (!value) continue;

        if (field.key === 'notes') {
            notesParts.push(value);
            continue;
        }

        if (field.key === 'birthDate') {
            const date = new Date(value);
            if (!Number.isNaN(date.getTime())) {
                nextDefaults.birthDate = date;
            }
            continue;
        }

        nextDefaults[field.key] = value;
    }

    const selectedDiagnoses = draft.diagnoses
        .filter((diagnosis) => diagnosis.included && diagnosis.code.trim() && diagnosis.description.trim())
        .map((diagnosis) => ({
            code: diagnosis.code.trim(),
            description: diagnosis.description.trim(),
            system: diagnosis.system,
            date: new Date(),
        }));

    if (selectedDiagnoses.length > 0) {
        nextDefaults.diagnoses = selectedDiagnoses;
    }

    const selectedMedications = draft.medications
        .filter((medication) => medication.included && medication.label.trim())
        .map((medication) => medication.label.trim());

    const medicationsBlock = buildMedicationNoteBlock(selectedMedications);
    if (medicationsBlock) {
        notesParts.push(medicationsBlock);
    }

    if (notesParts.length > 0) {
        nextDefaults.notes = notesParts.join('\n\n');
    }

    return nextDefaults;
}
