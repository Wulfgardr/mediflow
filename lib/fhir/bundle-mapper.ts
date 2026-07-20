import { Bundle } from 'fhir/r4';
import { toFhirFullUrl } from './id';
import { toFhirPatient } from './patient-adapter';
import {
    toFhirCondition,
    toFhirEncounter,
    toFhirMedicationStatement,
    toFhirObservation,
    toFhirStructuredObservation,
} from './clinical-adapter';
import type { FhirBundleInput } from './types';

type BundleResource = NonNullable<NonNullable<Bundle['entry']>[number]['resource']>;

/* @Codex */
export function buildFhirBundleFromRecords(input: FhirBundleInput): Bundle {
    const patientResource = toFhirPatient(input.patient, input.generatedAt);
    const patientReference = toFhirFullUrl(patientResource.resourceType, patientResource.id!);
    const bundle: Bundle = {
        resourceType: "Bundle",
        type: "collection",
        entry: []
    };

    const append = (resource: BundleResource) => bundle.entry?.push({
        fullUrl: toFhirFullUrl(resource.resourceType, resource.id!),
        resource,
    });

    append(patientResource);

    if (input.patient.diagnoses) {
        input.patient.diagnoses.forEach((diagnosis, index) => {
            append(toFhirCondition(diagnosis, patientReference, index + 1));
        });
    }

    input.entries.forEach(entry => {
        if (entry.deletedAt) return;

        append(toFhirEncounter(entry, patientReference));

        const observation = toFhirObservation(entry, patientReference);
        if (observation) {
            append(observation);
        }
    });

    input.therapies.forEach(therapy => {
        append(toFhirMedicationStatement(therapy, patientReference));
    });

    input.observations.forEach(observation => {
        append(toFhirStructuredObservation(observation, patientReference));
    });

    return bundle;
}
