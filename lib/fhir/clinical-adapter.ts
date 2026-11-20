import { Condition, Encounter, MedicationStatement, Observation } from 'fhir/r4';
import { parseClinicalDate } from '../clinical-date';
import { FhirExportPrecheckError } from './export-precheck-error';
import { toFhirDerivedId, toFhirId } from './id';
import { validateFhirScaleEntry } from './scale-validation';
export { FhirScaleScoreError, FhirScaleTitleError } from './scale-validation';
import type { FhirClinicalEntryInput, FhirDiagnosisInput, FhirObservationInput, FhirTherapyInput } from './types';

/* Preserve the legacy recognized-system URIs until the shared DTO v2 migration. */
export function fhirDiagnosisSystem(system: string): string | undefined {
    switch (system) {
        case 'ICD-9': return 'http://hl7.org/fhir/sid/icd-9';
        case 'ICD-10': return 'http://hl7.org/fhir/sid/icd-10';
        case 'ICD-11': return 'http://id.who.int/icd/release/11/mms';
        default: return undefined;
    }
}

export function toFhirCondition(
    diagnosis: FhirDiagnosisInput,
    patientReference: string,
    orderedPosition: number,
): Condition {
    const recordedDate = parseClinicalDate(diagnosis.date)?.toISOString();
    const id = diagnosis.id
        ? toFhirId(diagnosis.id, 'condition')
        : toFhirDerivedId('condition', [
            diagnosis.system.trim(),
            diagnosis.code.trim(),
            recordedDate ?? '',
            diagnosis.description.trim(),
        ], orderedPosition);
    if (!recordedDate) throw new FhirExportPrecheckError('INVALID_DATE', id, 'diagnosis');
    const system = fhirDiagnosisSystem(diagnosis.system);
    return {
        resourceType: "Condition",
        id,
        subject: { reference: patientReference },
        code: {
            ...(system ? { coding: [{
                system,
                code: diagnosis.code,
                display: diagnosis.description
            }] } : {}),
            text: diagnosis.description
        },
        recordedDate,
    };
}

function encounterClass(entry: FhirClinicalEntryInput): string | undefined {
    switch (entry.type) {
        case 'phone':
        case 'remote':
            return 'VR';
        case 'hospitalization':
            return entry.setting === 'hospital' ? 'IMP' : undefined;
        case 'visit':
        case 'exam':
        case 'access':
            if (entry.setting === 'home') return 'HH';
            if (entry.setting === 'ambulatory') return 'AMB';
            return undefined;
    }
}

export function toFhirEncounter(entry: FhirClinicalEntryInput, patientReference: string): Encounter | null {
    if (entry.type === 'note' || entry.type === 'scale') return null;
    const code = encounterClass(entry);
    if (!code) throw new FhirExportPrecheckError('INVALID_ENCOUNTER_PAIR', entry.id, 'entry');
    const start = parseClinicalDate(entry.date)?.toISOString();
    if (!start) throw new FhirExportPrecheckError('INVALID_DATE', entry.id, 'entry');
    return {
        resourceType: "Encounter",
        id: toFhirId(entry.id, 'encounter'),
        status: "finished",
        class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code },
        subject: { reference: patientReference },
        period: { start },
        type: [{ text: entry.type }],
    };
}

export function toFhirObservation(entry: FhirClinicalEntryInput, patientReference: string): Observation | null {
    if (entry.type !== 'scale') return null;
    const score = validateFhirScaleEntry(entry);

    return {
        resourceType: "Observation",
        id: toFhirId(`obs-${entry.id}`, 'observation'),
        status: "final",
        code: {
            text: entry.metadata?.title as string
        },
        subject: { reference: patientReference },
        effectiveDateTime: new Date(entry.date).toISOString(),
        valueInteger: score,
        interpretation: [{ text: entry.metadata?.interpretation as string }],
        note: [{ text: entry.content }]
    };
}

export function toFhirMedicationStatement(therapy: FhirTherapyInput, patientReference: string): MedicationStatement {
    const start = parseClinicalDate(therapy.startDate);
    const end = parseClinicalDate(therapy.endDate);
    if (!start || (therapy.endDate != null && !end) || (end && end < start)) {
        throw new FhirExportPrecheckError('INVALID_DATE', therapy.id, 'therapy');
    }
    return {
        resourceType: "MedicationStatement",
        id: toFhirId(therapy.id, 'medication-statement'),
        status: therapy.status === 'active' ? 'active' : (therapy.status === 'suspended' ? 'on-hold' : 'completed'),
        medicationCodeableConcept: {
            text: therapy.drugName
        },
        subject: { reference: patientReference },
        effectivePeriod: {
            start: start.toISOString(),
            end: end?.toISOString()
        },
        dosage: [{
            text: therapy.dosage
        }],
        note: therapy.motivation ? [{ text: therapy.motivation }] : undefined
    };
}

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
