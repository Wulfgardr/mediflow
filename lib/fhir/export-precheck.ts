import type { Bundle } from 'fhir/r4';
import { buildFhirBundleFromRecords } from './bundle-mapper';
import { fhirDiagnosisSystem } from './clinical-adapter';
import type { FhirBundleInput } from './types';
import { FhirScaleScoreError, FhirScaleTitleError, validateFhirScaleEntry } from './scale-validation';

export class FhirExportPrecheckError extends Error {
    readonly severity = 'error';
    readonly category = 'scale';

    constructor(
        public readonly code: 'INVALID_SCALE_SCORE' | 'INVALID_SCALE_TITLE',
        public readonly recordId: string,
    ) {
        super(code);
        this.name = 'FhirExportPrecheckError';
    }
}

/* Local legacy-input check; DTO v2 canonical warning IDs remain a separate slice. */
export type FhirDiagnosisCodingWarning = Readonly<{
    code: 'UNSUPPORTED_DIAGNOSIS_SYSTEM';
    severity: 'warning';
    category: 'diagnosis';
    recordId: string;
    path: string;
}>;

export type ConfirmFhirDiagnosisWarnings = (
    warnings: readonly FhirDiagnosisCodingWarning[],
) => boolean | Promise<boolean>;

export function buildFhirDiagnosisWarningMessage(warnings: readonly FhirDiagnosisCodingWarning[]): string {
    return `${warnings.length} diagnosi hanno un sistema di codifica non riconosciuto o vuoto. `
        + 'Il file conserverà la descrizione di queste diagnosi senza la codifica. Vuoi proseguire?';
}

/* Validate the same local snapshot that becomes the bundle, before releasing it. */
export async function prepareFhirBundleFromRecords(
    input: FhirBundleInput,
    confirmWarnings?: ConfirmFhirDiagnosisWarnings,
): Promise<Bundle | null> {
    for (const entry of input.entries) {
        if (entry.deletedAt || entry.type !== 'scale') continue;
        try {
            validateFhirScaleEntry(entry);
        } catch (error) {
            if (error instanceof FhirScaleScoreError || error instanceof FhirScaleTitleError) {
                throw new FhirExportPrecheckError(error.code, error.recordId);
            }
            throw error;
        }
    }
    const bundle = buildFhirBundleFromRecords(input);
    const warnings: FhirDiagnosisCodingWarning[] = [];
    (input.patient.diagnoses ?? []).forEach((diagnosis, index) => {
        if (fhirDiagnosisSystem(diagnosis.system)) return;
        // Patient is first, followed by diagnoses in source order in the legacy mapper.
        const condition = bundle.entry?.[index + 1]?.resource;
        warnings.push({
            code: 'UNSUPPORTED_DIAGNOSIS_SYSTEM',
            severity: 'warning',
            category: 'diagnosis',
            recordId: diagnosis.id || condition!.id!,
            path: `/patient/diagnoses/${index}/system`,
        });
    });
    if (warnings.length > 0) {
        if (!confirmWarnings) throw new Error('FHIR_DIAGNOSIS_WARNINGS_REQUIRE_CONFIRMATION');
        if (!await confirmWarnings(warnings)) return null;
    }
    return bundle;
}
