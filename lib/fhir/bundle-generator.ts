import { Bundle } from 'fhir/r4';
import { db } from '../db';
import { toFhirPatient } from './patient-adapter';
import { toFhirCondition, toFhirEncounter, toFhirMedicationStatement, toFhirObservation } from './clinical-adapter';

export async function generatePatientBundle(patientId: string): Promise<Bundle> {
    const patient = await db.patients.get(patientId);
    if (!patient) throw new Error("Patient not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries = await db.entries.filter((e: any) => e.patientId === patientId).toArray();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const therapies = await db.therapies.filter((t: any) => t.patientId === patientId).toArray();

    const bundle: Bundle = {
        resourceType: "Bundle",
        type: "collection",
        entry: []
    };

    // 1. Patient Resource
    bundle.entry?.push({
        resource: toFhirPatient(patient)
    });

    // 2. Conditions (Diagnoses)
    if (patient.diagnoses) {
        patient.diagnoses.forEach(d => {
            bundle.entry?.push({
                resource: toFhirCondition(d, patientId)
            });
        });
    }

    // 3. Encounters & Observations
    entries.forEach(e => {
        if (e.deletedAt) return;

        // Add Encounter
        bundle.entry?.push({
            resource: toFhirEncounter(e, patientId)
        });

        // Add Observation if applicable
        const obs = toFhirObservation(e, patientId);
        if (obs) {
            bundle.entry?.push({
                resource: obs
            });
        }
    });

    // 4. Medications
    therapies.forEach(t => {

        bundle.entry?.push({
            resource: toFhirMedicationStatement(t, patientId)
        });
    });

    return bundle;
}
