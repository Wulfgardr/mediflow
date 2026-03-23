/* @Codex */
import {
    parseDocumentSynthesisExtractionResponse,
    type DocumentDiagnosisSuggestionContract,
    type DocumentQualityLevel,
} from './ai-task-contracts';

/* @Codex */
export type { DocumentQualityLevel };

/* @Codex */
export type DocumentDiagnosisSuggestion = DocumentDiagnosisSuggestionContract;

/* @Codex */
export type DocumentStructuredAnalysis = {
    summary: string;
    quality?: {
        level: DocumentQualityLevel;
        reason?: string;
    };
    medications: string[];
    diagnoses: DocumentDiagnosisSuggestion[];
};

/* @Codex */
export function normalizeDiagnosisSystem(value: unknown): DocumentDiagnosisSuggestion['system'] | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase().replace(/\s+/g, '');
    if (normalized === 'ICD-9' || normalized === 'ICD9') return 'ICD-9';
    if (normalized === 'ICD-10' || normalized === 'ICD10') return 'ICD-10';
    if (normalized === 'ICD-11' || normalized === 'ICD11') return 'ICD-11';
    return null;
}

/* @Codex */
export function parseStructuredAnalysisResponse(response: string, rawMarkdown: string): DocumentStructuredAnalysis {
    const parsed = parseDocumentSynthesisExtractionResponse(response, rawMarkdown).value;

    return {
        summary: parsed.summary,
        quality: {
            level: parsed.data.qualityLevel,
            reason: parsed.data.qualityReason,
        },
        medications: parsed.data.medications,
        diagnoses: parsed.data.diagnoses,
    };
}
