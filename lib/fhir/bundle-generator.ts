import { Bundle } from 'fhir/r4';
import { db } from '../db';
import { prepareFhirBundleFromRecords, type ConfirmFhirDiagnosisWarnings } from './export-precheck';
export { buildFhirDiagnosisWarningMessage } from './export-precheck';

export async function generatePatientBundle(
    patientId: string,
    confirmWarnings?: ConfirmFhirDiagnosisWarnings,
): Promise<Bundle | null> {
    const patient = await db.patients.get(patientId);
    if (!patient) throw new Error("Patient not found");

    const entries = await db.entries.query({ patientId }).toArray({ rejectAuthUnavailable: true });
    const therapies = await db.therapies.query({ patientId }).toArray({ rejectAuthUnavailable: true });
    const checkups = await db.checkups.query({ patientId }).toArray({ rejectAuthUnavailable: true });
    const observations = await db.observations.query({ patientId }).toArray({ rejectAuthUnavailable: true });

    return prepareFhirBundleFromRecords({
        generatedAt: new Date(),
        patient,
        entries,
        therapies,
        checkups,
        observations,
    }, confirmWarnings);
}
