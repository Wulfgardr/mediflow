import { Patient as FhirPatient } from 'fhir/r4';
import { toFhirId } from './id';
import type { FhirPatientInput } from './types';

export const CODICE_FISCALE_SYSTEM = "http://hl7.it/sid/codice-fiscale";

/* @Codex */
export function toFhirPatient(patient: FhirPatientInput, generatedAt: Date | string = new Date()): FhirPatient {
    return {
        resourceType: "Patient",
        id: toFhirId(patient.id, 'patient'),
        active: !patient.isArchived,
        identifier: [
            {
                use: "official",
                system: CODICE_FISCALE_SYSTEM,
                value: patient.taxCode
            }
        ],
        name: [
            {
                use: "official",
                family: patient.lastName,
                given: [patient.firstName]
            }
        ],
        birthDate: patient.birthDate
            ? new Date(patient.birthDate).toISOString().split('T')[0]
            : undefined,
        address: patient.address ? [
            {
                use: "home",
                text: patient.address,
                country: "IT"
            }
        ] : undefined,
        telecom: patient.phone ? [
            {
                system: "phone",
                value: patient.phone,
                use: "mobile"
            }
        ] : undefined,
        contact: patient.caregiver ? [
            {
                relationship: [{ text: "Caregiver" }],
                name: { text: patient.caregiver }
            }
        ] : undefined,
        meta: {
            lastUpdated: new Date(generatedAt).toISOString() // Assuming export time is update time for the resource view
        }
    };
}
