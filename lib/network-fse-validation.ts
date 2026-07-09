import type { PatientDetail } from './api/v1/types';
import type { ValidatePatientExportResponse } from './fse-validate-patient-contract';

/* @Codex */
type NetworkFseValidationDeps = {
    getNetworkScopedPatientDetail: (patientId: string, scopeAmbulatoryId: string) => Promise<PatientDetail | null>;
    validatePatientExport: (patientId: string) => Promise<ValidatePatientExportResponse | null>;
};

/* @Codex */
export type NetworkFseValidatePatientResult =
    | { status: 200; value: ValidatePatientExportResponse }
    | { status: 400 | 404; value: { error: string } };

/* @Codex */
export async function validateNetworkScopedPatientExport(
    patientId: string | null,
    scopeAmbulatoryId: string,
    deps: NetworkFseValidationDeps,
): Promise<NetworkFseValidatePatientResult> {
    if (!patientId) {
        return { status: 400, value: { error: 'patientId is required' } };
    }

    const scopedPatient = await deps.getNetworkScopedPatientDetail(patientId, scopeAmbulatoryId);
    if (!scopedPatient) {
        return { status: 404, value: { error: 'Not found' } };
    }

    const validation = await deps.validatePatientExport(patientId);
    if (!validation) {
        return { status: 404, value: { error: 'Not found' } };
    }

    return { status: 200, value: validation };
}
