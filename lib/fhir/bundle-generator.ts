import { Bundle } from 'fhir/r4';
import { db } from '../db';
import { buildFhirBundleFromRecords } from './bundle-mapper';

export async function generatePatientBundle(patientId: string): Promise<Bundle> {
    const patient = await db.patients.get(patientId);
    if (!patient) throw new Error("Patient not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries = await db.entries.filter((e: any) => e.patientId === patientId).toArray();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const therapies = await db.therapies.filter((t: any) => t.patientId === patientId).toArray();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checkups = await db.checkups.filter((c: any) => c.patientId === patientId).toArray();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const observations = await db.observations.filter((o: any) => o.patientId === patientId).toArray();

    return buildFhirBundleFromRecords({
        generatedAt: new Date(),
        patient,
        entries,
        therapies,
        checkups,
        observations,
    });
}
