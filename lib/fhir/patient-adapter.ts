import { Patient } from '../db';
import { Patient as FhirPatient } from 'fhir/r4';

export const CODICE_FISCALE_SYSTEM = "http://hl7.it/sid/codice-fiscale";

export function toFhirPatient(patient: Patient): FhirPatient {
    return {
        resourceType: "Patient",
        id: patient.id,
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
        gender: "unknown", // Logic to extract from tax code could go here
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
            lastUpdated: new Date().toISOString() // Assuming export time is update time for the resource view
        }
    };
}
