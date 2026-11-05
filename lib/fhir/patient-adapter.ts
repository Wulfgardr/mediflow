import { Patient as FhirPatient } from 'fhir/r4';
import { inferIdentifierType } from '../patient-identity';
import { toFhirId } from './id';
import type { FhirPatientInput } from './types';

export const CODICE_FISCALE_SYSTEM = "urn:oid:2.16.840.1.113883.2.9.4.3.2";

export function toFhirPatient(patient: FhirPatientInput, generatedAt: Date | string = new Date()): FhirPatient {
    const type = patient.identifierType ?? inferIdentifierType(patient.taxCode);
    const systems = { cf: CODICE_FISCALE_SYSTEM, stp: 'urn:mediflow:identifier:stp', eni: 'urn:mediflow:identifier:eni', passport: 'urn:mediflow:identifier:foreign-document', other: 'urn:mediflow:identifier:other' };
    return {
        resourceType: "Patient",
        id: toFhirId(patient.id, 'patient'),
        active: !patient.isArchived,
        identifier: type === 'none' || !patient.taxCode ? undefined : [
            {
                use: "official",
                system: systems[type],
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
        birthDate: patient.birthDatePrecision === 'estimated' && patient.birthYear ? String(patient.birthYear) : patient.birthDate && patient.birthDatePrecision !== 'unknown'
            ? new Date(patient.birthDate).toISOString().split('T')[0] : undefined,
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
