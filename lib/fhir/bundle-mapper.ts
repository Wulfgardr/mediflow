import { Bundle } from 'fhir/r4';
import { toFhirPatient } from './patient-adapter';
import {
    toFhirCondition,
    toFhirEncounter,
    toFhirMedicationStatement,
    toFhirObservation,
    toFhirStructuredObservation,
} from './clinical-adapter';
import type { FhirBundleInput } from './types';

export function buildFhirBundleFromRecords(input: FhirBundleInput): Bundle {
    const patientId = input.patient.id;
    const bundle: Bundle = {
        resourceType: "Bundle",
        type: "collection",
        entry: []
    };

    bundle.entry?.push({
        resource: toFhirPatient(input.patient, input.generatedAt)
    });

    if (input.patient.diagnoses) {
        input.patient.diagnoses.forEach(diagnosis => {
            bundle.entry?.push({
                resource: toFhirCondition(diagnosis, patientId)
            });
        });
    }

    input.entries.forEach(entry => {
        if (entry.deletedAt) return;

        bundle.entry?.push({
            resource: toFhirEncounter(entry, patientId)
        });

        const observation = toFhirObservation(entry, patientId);
        if (observation) {
            bundle.entry?.push({
                resource: observation
            });
        }
    });

    input.therapies.forEach(therapy => {
        bundle.entry?.push({
            resource: toFhirMedicationStatement(therapy, patientId)
        });
    });

    input.observations.forEach(observation => {
        bundle.entry?.push({
            resource: toFhirStructuredObservation(observation, patientId)
        });
    });

    return bundle;
}
