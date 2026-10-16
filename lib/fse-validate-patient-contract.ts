import type { FseValidationIssue } from './terminology';

export type ValidationItem = {
    id: string;
    ok: boolean;
    errors: FseValidationIssue[];
    warnings: FseValidationIssue[];
};

export type ValidationSummary = {
    total: number;
    ok: number;
    withErrors: number;
    withWarnings: number;
    errorCount: number;
    warningCount: number;
    items: ValidationItem[];
};

export type ValidatePatientExportResponse = {
    patientId: string;
    hasErrors: boolean;
    hasWarnings: boolean;
    therapyMedication: ValidationSummary;
    observationVitals: ValidationSummary;
};

export function buildValidationMessage(validation: ValidatePatientExportResponse): string {
    return [
        `Terapie: ${validation.therapyMedication.total} record, ${validation.therapyMedication.errorCount} errori, ${validation.therapyMedication.warningCount} warning`,
        `Osservazioni: ${validation.observationVitals.total} record, ${validation.observationVitals.errorCount} errori, ${validation.observationVitals.warningCount} warning`,
    ].join('\n');
}
