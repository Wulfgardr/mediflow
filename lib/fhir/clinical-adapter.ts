import { Diagnosis, ClinicalEntry, Therapy } from '../db';
import { Condition, Encounter, MedicationStatement, Observation } from 'fhir/r4';

export function toFhirCondition(diagnosis: Diagnosis, patientId: string): Condition {
    return {
        resourceType: "Condition",
        id: crypto.randomUUID(), // DB doesn't have IDs for diagnoses nested items, generating one or hash
        subject: { reference: `Patient/${patientId}` },
        clinicalStatus: {
            coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }]
        },
        code: {
            coding: [{
                system: diagnosis.system === 'ICD-9' ? "http://hl7.org/fhir/sid/icd-9" :
                    diagnosis.system === 'ICD-10' ? "http://hl7.org/fhir/sid/icd-10" : "http://id.who.int/icd/release/11/mms",
                code: diagnosis.code,
                display: diagnosis.description
            }],
            text: diagnosis.description
        },
        onsetDateTime: new Date(diagnosis.date).toISOString()
    };
}

export function toFhirEncounter(entry: ClinicalEntry, patientId: string): Encounter {
    return {
        resourceType: "Encounter",
        id: entry.id,
        status: "finished",
        class: {
            system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
            code: entry.setting === 'home' ? "HH" : "AMB",
            display: entry.setting === 'home' ? "home health" : "ambulatory"
        },
        subject: { reference: `Patient/${patientId}` },
        period: {
            start: new Date(entry.date).toISOString(),
            end: new Date(entry.date).toISOString()
        },
        type: [
            {
                text: entry.type // 'visit', 'remote', etc.
            }
        ]
    };
}

export function toFhirObservation(entry: ClinicalEntry, patientId: string): Observation | null {
    if (entry.type !== 'scale' || !entry.metadata?.score) return null;

    return {
        resourceType: "Observation",
        id: `obs-${entry.id}`,
        status: "final",
        code: {
            text: entry.metadata.title as string
        },
        subject: { reference: `Patient/${patientId}` },
        effectiveDateTime: new Date(entry.date).toISOString(),
        valueInteger: Number(entry.metadata.score),
        interpretation: [{ text: entry.metadata.interpretation as string }],
        note: [{ text: entry.content }]
    };
}

export function toFhirMedicationStatement(therapy: Therapy, patientId: string): MedicationStatement {
    return {
        resourceType: "MedicationStatement",
        id: therapy.id,
        status: therapy.status === 'active' ? 'active' : (therapy.status === 'suspended' ? 'on-hold' : 'completed'),
        medicationCodeableConcept: {
            text: therapy.drugName
        },
        subject: { reference: `Patient/${patientId}` },
        effectivePeriod: {
            start: new Date(therapy.startDate).toISOString(),
            end: therapy.endDate ? new Date(therapy.endDate).toISOString() : undefined
        },
        dosage: [{
            text: therapy.dosage
        }],
        note: therapy.motivation ? [{ text: therapy.motivation }] : undefined
    };
}
