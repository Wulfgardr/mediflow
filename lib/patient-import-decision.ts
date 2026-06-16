/* @Codex */
import type {
    PatientDocumentReviewDiagnosis,
    PatientDocumentReviewDraft,
    PatientDocumentReviewField,
    PatientDocumentReviewMedication,
    PatientDocumentReviewServicePrescription,
    ReviewedPatientImportDefaults,
} from './patient-document-review';

/* @Codex */
export const PATIENT_IMPORT_DECISION_SCHEMA_VERSION = 'mediflow.patient_import_decision.v1';

/* @Codex */
export interface ExistingPatientIdentityCandidate {
    id: string;
    taxCode?: string;
    firstName?: string;
    lastName?: string;
    birthDate?: Date | string | null;
}

/* @Codex */
export interface DecidePatientImportTargetInput {
    taxCode?: string;
    firstName?: string;
    lastName?: string;
    birthDate?: Date | string | null;
    candidates: ExistingPatientIdentityCandidate[];
}

/* @Codex */
export type PatientImportTargetDecision =
    | {
        action: 'create_new_patient';
        rationale: string;
    }
    | {
        action: 'merge_existing_patient';
        patientId: string;
        matchBasis: 'tax_code' | 'manual_selection';
        rationale: string;
    }
    | {
        action: 'review_identity';
        candidatePatientIds: string[];
        matchBasis: 'tax_code_conflict' | 'demographics' | 'insufficient_identity';
        rationale: string;
    };

/* @Codex */
export interface PatientImportFieldDecision {
    key: PatientDocumentReviewField['key'];
    label: string;
    kind: PatientDocumentReviewField['kind'];
    value: string;
    action: 'apply' | 'ignore';
    sourceLabel: string;
    rationale: string;
}

/* @Codex */
export interface PatientImportDiagnosisDecision {
    id: string;
    code: string;
    description: string;
    system: PatientDocumentReviewDiagnosis['system'];
    evidence?: string;
    confidence?: PatientDocumentReviewDiagnosis['confidence'];
    action: 'apply_structured' | 'review_only' | 'ignore';
    rationale: string;
}

/* @Codex */
export interface PatientImportTherapyDecision {
    id: string;
    drugName: string;
    dosage?: string;
    activePrinciple?: string;
    motivation?: string;
    aic?: string;
    atc?: string;
    confidence?: PatientDocumentReviewMedication['confidence'];
    therapyState: PatientDocumentReviewMedication['therapyState'];
    matchType: PatientDocumentReviewMedication['matchType'];
    evidence?: string;
    action: 'persist_structured' | 'append_note' | 'ignore';
    rationale: string;
}

/* @Codex */
export interface PatientImportServicePrescriptionDecision {
    id: string;
    serviceName: string;
    category?: PatientDocumentReviewServicePrescription['category'];
    priority?: string;
    codeSystem?: string;
    serviceCode?: string;
    clinicalQuestion?: string;
    provider?: string;
    prescribedAt?: string;
    requestReference?: string;
    confidence?: PatientDocumentReviewServicePrescription['confidence'];
    evidence?: string;
    action: 'propose_structured' | 'ignore';
    rationale: string;
    items?: Array<{
        id: string;
        serviceName: string;
        category?: PatientDocumentReviewServicePrescription['category'];
        codeSystem?: string;
        serviceCode?: string;
        confidence?: PatientDocumentReviewServicePrescription['confidence'];
        evidence?: string;
        action: 'propose_structured' | 'ignore';
    }>;
}

/* @Codex */
export interface PatientImportDecision {
    schemaVersion: typeof PATIENT_IMPORT_DECISION_SCHEMA_VERSION;
    generatedAt: string;
    source: {
        extractionMode: PatientDocumentReviewDraft['source'];
        confidence: number;
        sourceLabel: string;
        sourceExcerpt?: string;
        quality?: PatientDocumentReviewDraft['quality'];
    };
    target: PatientImportTargetDecision;
    fieldDecisions: PatientImportFieldDecision[];
    diagnosisDecisions: PatientImportDiagnosisDecision[];
    therapyDecisions: PatientImportTherapyDecision[];
    servicePrescriptionDecisions: PatientImportServicePrescriptionDecision[];
    summary: {
        appliedFieldCount: number;
        structuredDiagnosisCount: number;
        structuredTherapyCount: number;
        noteOnlyTherapyCount: number;
        servicePrescriptionProposalCount: number;
    };
}

/* @Codex */
export interface BuildPatientImportDecisionOptions {
    generatedAt?: Date;
    target?: PatientImportTargetDecision;
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
function normalizeTaxCode(value: string | undefined): string {
    return (value || '').replace(/\s+/g, '').toUpperCase();
}

/* @Codex */
function normalizeDate(value: Date | string | null | undefined): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
}

/* @Codex */
function isStructuredTherapyCandidate(
    medication: Pick<PatientDocumentReviewMedication, 'drugName' | 'dosage' | 'therapyState'>,
): boolean {
    return medication.therapyState === 'active'
        && Boolean(medication.drugName.trim())
        && Boolean(medication.dosage?.trim());
}

/* @Codex */
function buildTherapyAppendReason(medication: PatientDocumentReviewMedication): string {
    if (medication.blockedReason?.trim()) return medication.blockedReason.trim();
    if (medication.therapyState !== 'active') {
        return 'Terapia non attiva o in transizione: resta nota documentale da riconciliare.';
    }
    if (!medication.dosage?.trim()) {
        return 'Posologia insufficiente per una write strutturata prudente.';
    }
    if (medication.matchType !== 'catalog') {
        return 'Terapia senza match catalogo forte: resta nota documentale di supporto.';
    }
    return 'Terapia da riconciliare manualmente prima di una write strutturata.';
}

/* @Codex */
function buildMedicationNoteBlock(therapies: PatientImportTherapyDecision[]): string | undefined {
    if (therapies.length === 0) return undefined;

    return [
        'Terapie documentali da riconciliare manualmente:',
        ...therapies.map((therapy) => {
            const details = [
                therapy.drugName,
                therapy.dosage ? `(${therapy.dosage})` : undefined,
                therapy.rationale ? `- ${therapy.rationale}` : undefined,
            ].filter(Boolean);
            return `- ${details.join(' ')}`;
        }),
    ].join('\n');
}

/* @Codex */
function buildFieldDecision(field: PatientDocumentReviewField): PatientImportFieldDecision {
    return {
        key: field.key,
        label: field.label,
        kind: field.kind,
        value: field.value,
        action: field.included ? 'apply' : 'ignore',
        sourceLabel: field.sourceLabel,
        rationale: field.included
            ? 'Campo confermato nella review operatore.'
            : 'Campo escluso nella review operatore.',
    };
}

/* @Codex */
function buildDiagnosisDecision(diagnosis: PatientDocumentReviewDiagnosis): PatientImportDiagnosisDecision {
    if (!diagnosis.included) {
        return {
            id: diagnosis.id,
            code: diagnosis.code,
            description: diagnosis.description,
            system: diagnosis.system,
            evidence: diagnosis.evidence,
            confidence: diagnosis.confidence,
            action: 'ignore',
            rationale: 'Diagnosi esclusa nella review operatore.',
        };
    }

    if (diagnosis.code.trim() && diagnosis.description.trim()) {
        return {
            id: diagnosis.id,
            code: diagnosis.code.trim(),
            description: diagnosis.description.trim(),
            system: diagnosis.system,
            evidence: diagnosis.evidence,
            confidence: diagnosis.confidence,
            action: 'apply_structured',
            rationale: 'Diagnosi codificata confermata per persistenza strutturata.',
        };
    }

    return {
        id: diagnosis.id,
        code: diagnosis.code.trim(),
        description: diagnosis.description.trim(),
        system: diagnosis.system,
        evidence: diagnosis.evidence,
        confidence: diagnosis.confidence,
        action: 'review_only',
        rationale: diagnosis.blockedReason?.trim()
            || 'Diagnosi senza codice sufficiente: resta reviewable e non viene persistita in modo strutturato.',
    };
}

/* @Codex */
function buildTherapyDecision(medication: PatientDocumentReviewMedication): PatientImportTherapyDecision {
    if (!medication.included) {
        return {
            id: medication.id,
            drugName: medication.drugName.trim(),
            dosage: medication.dosage?.trim() || undefined,
            activePrinciple: medication.activePrinciple?.trim() || undefined,
            motivation: medication.motivation?.trim() || undefined,
            aic: medication.aic?.trim() || undefined,
            atc: medication.atc?.trim() || undefined,
            confidence: medication.confidence,
            therapyState: medication.therapyState,
            matchType: medication.matchType,
            evidence: medication.evidence,
            action: 'ignore',
            rationale: 'Terapia esclusa nella review operatore.',
        };
    }

    if (isStructuredTherapyCandidate(medication)) {
        return {
            id: medication.id,
            drugName: medication.drugName.trim(),
            dosage: medication.dosage?.trim() || undefined,
            activePrinciple: medication.activePrinciple?.trim() || undefined,
            motivation: medication.motivation?.trim() || undefined,
            aic: medication.aic?.trim() || undefined,
            atc: medication.atc?.trim() || undefined,
            confidence: medication.confidence,
            therapyState: medication.therapyState,
            matchType: medication.matchType,
            evidence: medication.evidence,
            action: 'persist_structured',
            rationale: 'Terapia attiva con farmaco e posologia utili per persistenza strutturata prudente.',
        };
    }

    return {
        id: medication.id,
        drugName: medication.drugName.trim(),
        dosage: medication.dosage?.trim() || undefined,
        activePrinciple: medication.activePrinciple?.trim() || undefined,
        motivation: medication.motivation?.trim() || undefined,
        aic: medication.aic?.trim() || undefined,
        atc: medication.atc?.trim() || undefined,
        confidence: medication.confidence,
        therapyState: medication.therapyState,
        matchType: medication.matchType,
        evidence: medication.evidence,
        action: 'append_note',
        rationale: buildTherapyAppendReason(medication),
    };
}

/* @Codex */
function buildServicePrescriptionDecision(item: PatientDocumentReviewServicePrescription): PatientImportServicePrescriptionDecision {
    return {
        id: item.id,
        serviceName: item.serviceName.trim(),
        category: item.category,
        priority: item.priority?.trim() || undefined,
        codeSystem: item.codeSystem?.trim() || undefined,
        serviceCode: item.serviceCode?.trim() || undefined,
        clinicalQuestion: item.clinicalQuestion?.trim() || undefined,
        provider: item.provider?.trim() || undefined,
        prescribedAt: item.prescribedAt?.trim() || undefined,
        requestReference: item.requestReference?.trim() || undefined,
        confidence: item.confidence,
        evidence: item.evidence,
        action: item.included && item.serviceName.trim() ? 'propose_structured' : 'ignore',
        rationale: item.included
            ? 'Prestazione prescritta distinta dalla terapia farmacologica: proposta per dominio dedicato.'
            : 'Prestazione esclusa nella review operatore.',
        items: (item.items ?? []).map((child) => ({
            id: child.id,
            serviceName: child.serviceName.trim(),
            category: child.category,
            codeSystem: child.codeSystem?.trim() || undefined,
            serviceCode: child.serviceCode?.trim() || undefined,
            confidence: child.confidence,
            evidence: child.evidence,
            action: child.included && child.serviceName.trim() ? 'propose_structured' : 'ignore',
        })),
    };
}

/* @Codex */
export function decidePatientImportTarget(input: DecidePatientImportTargetInput): PatientImportTargetDecision {
    const normalizedTaxCode = normalizeTaxCode(input.taxCode);
    const taxCodeMatches = normalizedTaxCode
        ? input.candidates.filter((candidate) => normalizeTaxCode(candidate.taxCode) === normalizedTaxCode)
        : [];

    if (taxCodeMatches.length === 1) {
        return {
            action: 'merge_existing_patient',
            patientId: taxCodeMatches[0].id,
            matchBasis: 'tax_code',
            rationale: 'Codice fiscale coincidente con una sola scheda esistente: preferire merge/update invece di create.',
        };
    }

    if (taxCodeMatches.length > 1) {
        return {
            action: 'review_identity',
            candidatePatientIds: taxCodeMatches.map((candidate) => candidate.id),
            matchBasis: 'tax_code_conflict',
            rationale: 'Codice fiscale presente su piu schede: bloccare l auto-merge e richiedere review identitaria.',
        };
    }

    const normalizedFirstName = normalizeText(input.firstName);
    const normalizedLastName = normalizeText(input.lastName);
    const normalizedBirthDate = normalizeDate(input.birthDate);
    const demographicMatches = (
        normalizedFirstName
        && normalizedLastName
        && normalizedBirthDate
    )
        ? input.candidates.filter((candidate) => (
            normalizeText(candidate.firstName) === normalizedFirstName
            && normalizeText(candidate.lastName) === normalizedLastName
            && normalizeDate(candidate.birthDate) === normalizedBirthDate
        ))
        : [];

    if (demographicMatches.length > 0) {
        return {
            action: 'review_identity',
            candidatePatientIds: demographicMatches.map((candidate) => candidate.id),
            matchBasis: 'demographics',
            rationale: 'Anagrafica compatibile con scheda esistente, ma senza codice fiscale non basta per un merge automatico.',
        };
    }

    if (!normalizedTaxCode && !(normalizedFirstName && normalizedLastName)) {
        return {
            action: 'review_identity',
            candidatePatientIds: [],
            matchBasis: 'insufficient_identity',
            rationale: 'Identita documentale troppo debole: serve review manuale prima di decidere create o merge.',
        };
    }

    return {
        action: 'create_new_patient',
        rationale: 'Nessuna corrispondenza forte rilevata: il create-flow puo proseguire come nuova anagrafica.',
    };
}

/* @Codex */
export function buildPatientImportDecision(
    draft: PatientDocumentReviewDraft,
    options: BuildPatientImportDecisionOptions = {},
): PatientImportDecision {
    const generatedAt = options.generatedAt && !Number.isNaN(options.generatedAt.getTime())
        ? options.generatedAt
        : new Date();
    const fieldDecisions = draft.fields.map(buildFieldDecision);
    const diagnosisDecisions = draft.diagnoses.map(buildDiagnosisDecision);
    const therapyDecisions = draft.medications.map(buildTherapyDecision);
    const servicePrescriptionDecisions = (draft.servicePrescriptions ?? []).map(buildServicePrescriptionDecision);

    return {
        schemaVersion: PATIENT_IMPORT_DECISION_SCHEMA_VERSION,
        generatedAt: generatedAt.toISOString(),
        source: {
            extractionMode: draft.source,
            confidence: draft.confidence,
            sourceLabel: draft.sourceLabel,
            sourceExcerpt: draft.sourceExcerpt,
            quality: draft.quality,
        },
        target: options.target || {
            action: 'create_new_patient',
            rationale: 'Decisione di default del create-flow document-driven con review esplicita.',
        },
        fieldDecisions,
        diagnosisDecisions,
        therapyDecisions,
        servicePrescriptionDecisions,
        summary: {
            appliedFieldCount: fieldDecisions.filter((decision) => decision.action === 'apply').length,
            structuredDiagnosisCount: diagnosisDecisions.filter((decision) => decision.action === 'apply_structured').length,
            structuredTherapyCount: therapyDecisions.filter((decision) => decision.action === 'persist_structured').length,
            noteOnlyTherapyCount: therapyDecisions.filter((decision) => decision.action === 'append_note').length,
            servicePrescriptionProposalCount: servicePrescriptionDecisions.filter((decision) => decision.action === 'propose_structured').length,
        },
    };
}

/* @Codex */
export function applyPatientImportDecision(
    decision: PatientImportDecision,
): ReviewedPatientImportDefaults {
    const nextDefaults: ReviewedPatientImportDefaults = {};
    const notesParts: string[] = [];

    for (const field of decision.fieldDecisions) {
        if (field.action !== 'apply') continue;

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

    const diagnosisDate = new Date(decision.generatedAt);
    const selectedDiagnoses = decision.diagnosisDecisions
        .filter((diagnosis) => diagnosis.action === 'apply_structured')
        .map((diagnosis) => ({
            code: diagnosis.code,
            description: diagnosis.description,
            system: diagnosis.system,
            date: Number.isNaN(diagnosisDate.getTime()) ? new Date() : new Date(diagnosisDate),
        }));

    if (selectedDiagnoses.length > 0) {
        nextDefaults.diagnoses = selectedDiagnoses;
    }

    const structuredTherapies = decision.therapyDecisions
        .filter((therapy) => therapy.action === 'persist_structured')
        .map((therapy) => ({
            drugName: therapy.drugName,
            dosage: therapy.dosage || '',
            activePrinciple: therapy.activePrinciple,
            motivation: therapy.motivation,
            aic: therapy.aic,
            atc: therapy.atc,
        }))
        .filter((therapy) => therapy.drugName.trim() && therapy.dosage.trim());

    if (structuredTherapies.length > 0) {
        nextDefaults.therapies = structuredTherapies;
    }

    const medicationsBlock = buildMedicationNoteBlock(
        decision.therapyDecisions.filter((therapy) => therapy.action === 'append_note'),
    );
    if (medicationsBlock) {
        notesParts.push(medicationsBlock);
    }

    const servicePrescriptions = decision.servicePrescriptionDecisions
        .filter((item) => item.action === 'propose_structured')
        .map((item) => ({
            serviceName: item.serviceName,
            category: item.category,
            priority: item.priority,
            codeSystem: item.codeSystem,
            serviceCode: item.serviceCode,
            clinicalQuestion: item.clinicalQuestion,
            provider: item.provider,
            prescribedAt: item.prescribedAt,
            requestReference: item.requestReference,
            evidence: item.evidence,
            items: (item.items ?? [])
                .filter((child) => child.action === 'propose_structured')
                .map((child) => ({
                    serviceName: child.serviceName,
                    category: child.category,
                    codeSystem: child.codeSystem,
                    serviceCode: child.serviceCode,
                    evidence: child.evidence,
                })),
        }));
    if (servicePrescriptions.length > 0) {
        nextDefaults.servicePrescriptions = servicePrescriptions;
        notesParts.push([
            'Prestazioni prescritte da registrare nel dominio dedicato:',
            ...servicePrescriptions.map((item) => {
                const details = [
                    item.serviceName,
                    item.serviceCode ? `(${item.serviceCode})` : undefined,
                    item.clinicalQuestion ? `- ${item.clinicalQuestion}` : undefined,
                ].filter(Boolean);
                return `- ${details.join(' ')}`;
            }),
        ].join('\n'));
    }

    if (notesParts.length > 0) {
        nextDefaults.notes = notesParts.join('\n\n');
    }

    return nextDefaults;
}

/* @Codex */
export function serializePatientImportDecision(decision: PatientImportDecision): string {
    return JSON.stringify(decision);
}
