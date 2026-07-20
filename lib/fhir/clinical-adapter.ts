import { Condition, Encounter, MedicationStatement, Observation } from 'fhir/r4';
import { toFhirDerivedId, toFhirId } from './id';
import type { FhirClinicalEntryInput, FhirDiagnosisInput, FhirObservationInput, FhirTherapyInput } from './types';

/* @Codex */
export function toFhirCondition(
    diagnosis: FhirDiagnosisInput,
    patientReference: string,
    orderedPosition: number,
): Condition {
    const diagnosisDate = new Date(diagnosis.date).toISOString();
    return {
        resourceType: "Condition",
        id: diagnosis.id
            ? toFhirId(diagnosis.id, 'condition')
            : toFhirDerivedId('condition', [
                diagnosis.system.trim(),
                diagnosis.code.trim(),
                diagnosisDate,
                diagnosis.description.trim(),
            ], orderedPosition),
        subject: { reference: patientReference },
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
        onsetDateTime: diagnosisDate
    };
}

/* @Codex */
export function toFhirEncounter(entry: FhirClinicalEntryInput, patientReference: string): Encounter {
    return {
        resourceType: "Encounter",
        id: toFhirId(entry.id, 'encounter'),
        status: "finished",
        class: {
            system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
            code: entry.setting === 'home' ? "HH" : "AMB",
            display: entry.setting === 'home' ? "home health" : "ambulatory"
        },
        subject: { reference: patientReference },
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

/* @Codex */
export function toFhirObservation(entry: FhirClinicalEntryInput, patientReference: string): Observation | null {
    if (entry.type !== 'scale' || !entry.metadata?.score) return null;

    return {
        resourceType: "Observation",
        id: toFhirId(`obs-${entry.id}`, 'observation'),
        status: "final",
        code: {
            text: entry.metadata.title as string
        },
        subject: { reference: patientReference },
        effectiveDateTime: new Date(entry.date).toISOString(),
        valueInteger: Number(entry.metadata.score),
        interpretation: [{ text: entry.metadata.interpretation as string }],
        note: [{ text: entry.content }]
    };
}

/* @Codex */
export function toFhirMedicationStatement(therapy: FhirTherapyInput, patientReference: string): MedicationStatement {
    return {
        resourceType: "MedicationStatement",
        id: toFhirId(therapy.id, 'medication-statement'),
        status: therapy.status === 'active' ? 'active' : (therapy.status === 'suspended' ? 'on-hold' : 'completed'),
        medicationCodeableConcept: {
            text: therapy.drugName
        },
        subject: { reference: patientReference },
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

/* @Codex */
export function toFhirStructuredObservation(observation: FhirObservationInput, patientReference: string): Observation {
    const numericValue = Number(observation.value);
    const isNumeric = Number.isFinite(numericValue);

    return {
        resourceType: "Observation",
        id: toFhirId(`obs-structured-${observation.id}`, 'observation'),
        status: "final",
        code: {
            coding: [
                {
                    system: "http://loinc.org",
                    code: observation.code,
                    display: observation.display,
                }
            ],
            text: observation.display,
        },
        subject: { reference: patientReference },
        effectiveDateTime: new Date(observation.observedAt).toISOString(),
        valueQuantity: isNumeric
            ? {
                value: numericValue,
                system: "http://unitsofmeasure.org",
                code: observation.unitCode,
                unit: observation.unitCode,
            }
            : undefined,
        valueString: isNumeric ? undefined : String(observation.value),
        note: observation.notes ? [{ text: observation.notes }] : undefined,
    };
}
