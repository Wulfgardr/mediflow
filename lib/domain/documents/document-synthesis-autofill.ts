/* @Codex */
import type {
    Diagnosis,
    DocumentDiagnosisSuggestion,
    DocumentQualityLevel,
} from '../../db';
/* @Codex */
import {
    applyDocumentDecisionGuardrails,
    buildDocumentDecision,
    createDocumentDecisionEvidenceRef,
    type DocumentDecision,
    type DocumentDecisionAction,
    type DocumentDecisionConfidence,
    type DocumentDecisionForbiddenReason,
} from './document-decision';
/* @Codex */
import { isEncryptedFieldValue, isLockedDataPlaceholder } from '../../locked-field-guard';
/* @Codex */
import { normalizeDiagnosisSystem } from './document-synthesis-parser';

/* @Codex */
export interface ParsedDocumentSynthesisDiagnoses {
    diagnoses: Diagnosis[];
    locked: boolean;
}

/* @Codex */
export interface BuildDocumentSynthesisAutofillPlanInput {
    documentId: string;
    attachmentId?: string;
    fileName?: string;
    rawMarkdown: string;
    qualityLevel?: DocumentQualityLevel;
    diagnoses: DocumentDiagnosisSuggestion[];
    existingDiagnoses: Diagnosis[];
    existingDiagnosesRaw?: unknown;
}

/* @Codex */
export interface DocumentSynthesisAutofillPlan {
    decision: DocumentDecision;
    diagnoses: Diagnosis[];
    appliedCodes: string[];
    appliedSuggestions: DocumentDiagnosisSuggestion[];
    diagnosesFieldLocked: boolean;
}

/* @Codex */
function diagnosisKey(item: Pick<Diagnosis, 'system' | 'code'>): string {
    return `${item.system}:${item.code.trim().toUpperCase()}`;
}

/* @Codex */
function normalizePatientDiagnosis(value: unknown): Diagnosis | null {
    if (!value || typeof value !== 'object') return null;

    const record = value as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code.trim().toUpperCase() : '';
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    const system = normalizeDiagnosisSystem(record.system);

    if (!code || !description || !system) return null;

    const rawDate = record.date;
    const date = rawDate ? new Date(rawDate as string | number | Date) : new Date();

    return {
        code,
        description,
        system,
        date: Number.isNaN(date.getTime()) ? new Date() : date,
    };
}

/* @Codex */
export function parseExistingDocumentSynthesisDiagnoses(raw: unknown): ParsedDocumentSynthesisDiagnoses {
    if (isLockedDataPlaceholder(raw) || isEncryptedFieldValue(raw)) {
        return { diagnoses: [], locked: true };
    }
    if (!raw) return { diagnoses: [], locked: false };

    const source = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
            ? (() => {
                try {
                    const parsed = JSON.parse(raw);
                    return Array.isArray(parsed) ? parsed : [];
                } catch {
                    return [];
                }
            })()
            : [];

    return {
        diagnoses: source
            .map(normalizePatientDiagnosis)
            .filter((item): item is Diagnosis => Boolean(item)),
        locked: false,
    };
}

/* @Codex */
function confidenceForAutofill(
    suggestion: DocumentDiagnosisSuggestion,
    qualityLevel: DocumentQualityLevel | undefined,
): DocumentDecisionConfidence {
    if (qualityLevel === 'red') return 'blocked';
    return suggestion.confidence ?? 'low';
}

/* @Codex */
function blockedReasonForAutofillCandidate(input: {
    diagnosesFieldLocked: boolean;
    duplicate: boolean;
}): DocumentDecisionForbiddenReason | undefined {
    if (input.diagnosesFieldLocked) return 'target_field_locked';
    if (input.duplicate) return 'structured_fact_already_present';
    return undefined;
}

/* @Codex */
function buildAutofillAction(input: {
    suggestion: DocumentDiagnosisSuggestion;
    index: number;
    confidence: DocumentDecisionConfidence;
    blockedReason?: DocumentDecisionForbiddenReason;
}): DocumentDecisionAction {
    const target = diagnosisKey(input.suggestion);
    return {
        id: `document-synthesis-autofill:${input.index + 1}`,
        kind: input.blockedReason ? 'blocked' : 'create_diagnosis_candidate',
        target,
        evidenceRefs: [`diagnosis:${input.index + 1}`],
        confidence: input.confidence,
        rationale: input.blockedReason === 'target_field_locked'
            ? 'Campo diagnosi non leggibile: nessuna scrittura automatica.'
            : input.blockedReason === 'structured_fact_already_present'
                ? 'Diagnosi gia presente in scheda.'
                : 'Codice ICD esplicito dal documento candidato all autofill prudente.',
        blockedReason: input.blockedReason,
    };
}

/* @Codex */
export function buildDocumentSynthesisAutofillPlan(
    input: BuildDocumentSynthesisAutofillPlanInput,
): DocumentSynthesisAutofillPlan {
    const diagnosesFieldLocked = parseExistingDocumentSynthesisDiagnoses(input.existingDiagnosesRaw).locked;
    const existingKeys = new Set(input.existingDiagnoses.map(diagnosisKey));
    const evidenceRefs = input.diagnoses.map((suggestion, index) => createDocumentDecisionEvidenceRef(
        `diagnosis:${index + 1}`,
        suggestion.evidence?.trim() || `${suggestion.system} ${suggestion.code}: ${suggestion.description}`,
        'document-synthesis-autofill',
    ));
    const actions = input.diagnoses.map((suggestion, index) => {
        const confidence = confidenceForAutofill(suggestion, input.qualityLevel);
        return buildAutofillAction({
            suggestion,
            index,
            confidence,
            blockedReason: blockedReasonForAutofillCandidate({
                diagnosesFieldLocked,
                duplicate: existingKeys.has(diagnosisKey(suggestion)),
            }),
        });
    });

    const decision = applyDocumentDecisionGuardrails(buildDocumentDecision({
        source: {
            documentId: input.documentId,
            attachmentId: input.attachmentId,
            fileName: input.fileName,
            textState: input.rawMarkdown.trim() ? 'text_present' : 'text_absent',
            ocrStatus: input.rawMarkdown.trim() ? 'completed' : 'needed',
        },
        classification: {
            type: 'specialist_report',
            family: 'report',
            confidence: input.qualityLevel === 'green'
                ? 'high'
                : input.qualityLevel === 'red'
                    ? 'blocked'
                    : 'medium',
            rationale: 'Autofill documentale derivato da sintesi con codici ICD espliciti.',
            evidenceRefs: evidenceRefs.map((ref) => ref.id),
        },
        evidenceRefs,
        proposedActions: actions,
        humanRequiredFor: ['clinical_write'],
        model: {
            recognitionMode: 'hybrid',
        },
    }));

    const allowedTargets = new Set(decision.writePlan.allowedActions.map((action) => action.target));
    const appliedSuggestions = input.diagnoses.filter((suggestion) => allowedTargets.has(diagnosisKey(suggestion)));
    const diagnoses = [...input.existingDiagnoses];
    const appliedCodes: string[] = [];

    for (const suggestion of appliedSuggestions) {
        const key = diagnosisKey(suggestion);
        if (existingKeys.has(key)) continue;
        diagnoses.push({
            code: suggestion.code.trim().toUpperCase(),
            description: suggestion.description,
            system: suggestion.system,
            date: new Date(),
        });
        existingKeys.add(key);
        appliedCodes.push(key);
    }

    return {
        decision,
        diagnoses,
        appliedCodes,
        appliedSuggestions,
        diagnosesFieldLocked,
    };
}
