import {
    parseDocumentSynthesisExtractionResponse,
    type SmartImportDiagnosisExtraction,
    type SmartImportServicePrescriptionExtraction,
    type SmartImportTherapyExtraction,
    type DocumentDiagnosisSuggestionContract,
    type DocumentQualityLevel,
} from '../../ai-task-contracts';

export type { DocumentQualityLevel };

export type DocumentDiagnosisSuggestion = DocumentDiagnosisSuggestionContract;

export type DocumentStructuredAnalysis = {
    validJson?: boolean;
    validTask?: boolean;
    legacyContract?: boolean;
    summary: string;
    quality?: {
        level: DocumentQualityLevel;
        reason?: string;
    };
    medications: string[];
    diagnoses: DocumentDiagnosisSuggestion[];
    problemStatements: SmartImportDiagnosisExtraction[];
    therapyCandidates: SmartImportTherapyExtraction[];
    servicePrescriptions: SmartImportServicePrescriptionExtraction[];
};

export function normalizeDiagnosisSystem(value: unknown): DocumentDiagnosisSuggestion['system'] | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase().replace(/\s+/g, '');
    if (normalized === 'ICD-9' || normalized === 'ICD9') return 'ICD-9';
    if (normalized === 'ICD-10' || normalized === 'ICD10') return 'ICD-10';
    if (normalized === 'ICD-11' || normalized === 'ICD11') return 'ICD-11';
    return null;
}

export function parseStructuredAnalysisResponse(response: string, rawMarkdown: string): DocumentStructuredAnalysis {
    const result = parseDocumentSynthesisExtractionResponse(response, rawMarkdown);
    const parsed = result.value;

    return {
        validJson: result.validJson,
        validTask: result.validTask,
        legacyContract: result.legacyContract,
        summary: parsed.summary,
        quality: {
            level: parsed.data.qualityLevel,
            reason: parsed.data.qualityReason,
        },
        medications: parsed.data.medications,
        diagnoses: parsed.data.diagnoses,
        problemStatements: parsed.data.problemStatements,
        therapyCandidates: parsed.data.therapyCandidates,
        servicePrescriptions: parsed.data.servicePrescriptions,
    };
}
