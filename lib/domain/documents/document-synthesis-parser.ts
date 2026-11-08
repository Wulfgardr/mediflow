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
