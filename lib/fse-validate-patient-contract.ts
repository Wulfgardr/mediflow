/* @Codex */
export type ValidationSummary = {
    total: number;
    withErrors: number;
    withWarnings: number;
    errorCount: number;
    warningCount: number;
};

/* @Codex */
export type ValidatePatientExportResponse = {
    patientId: string;
    hasErrors: boolean;
    hasWarnings: boolean;
    therapyMedication: ValidationSummary;
    observationVitals: ValidationSummary;
};

/* @Codex */
export function buildValidationMessage(validation: ValidatePatientExportResponse): string {
    return [
        `Terapie: ${validation.therapyMedication.total} record, ${validation.therapyMedication.errorCount} errori, ${validation.therapyMedication.warningCount} warning`,
        `Osservazioni: ${validation.observationVitals.total} record, ${validation.observationVitals.errorCount} errori, ${validation.observationVitals.warningCount} warning`,
    ].join('\n');
}
