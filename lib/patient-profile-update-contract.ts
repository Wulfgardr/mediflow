export const PATIENT_PROFILE_UPDATE_OPERATION = Object.freeze({
    id: 'patient-profile.update.v1',
    version: 1,
} as const);

export type PatientProfileUpdateContract = Readonly<{
    operationId: typeof PATIENT_PROFILE_UPDATE_OPERATION.id;
    contractVersion: typeof PATIENT_PROFILE_UPDATE_OPERATION.version;
}>;
