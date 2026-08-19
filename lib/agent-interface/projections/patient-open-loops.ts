/* @Codex */

import {
    deriveOpenLoops,
    type OpenLoop,
    type OpenLoopObservation,
    type OpenLoopServicePrescriptionItem,
} from '../../patient-open-loops';

export const PATIENT_OPEN_LOOPS_PROJECTION_VERSION = 'mediflow.agent.patient_open_loops.v1';

type WithoutPatientId<Value> = Value extends unknown ? Omit<Value, 'patientId'> : never;

export type PatientOpenLoopItem = WithoutPatientId<OpenLoop>;

export type PatientOpenLoopsProjectionIssue = {
    code: 'outside_selected_patient_context';
    severity: 'warning';
};

export type PatientOpenLoopsProjection = {
    projectionVersion: typeof PATIENT_OPEN_LOOPS_PROJECTION_VERSION;
    patientRef: string;
    provenance: {
        source: 'patient_open_loops';
        derivation: 'deterministic';
    };
    freshness: {
        asOf: string;
    };
    expectedSourceVersion: number;
    issues: PatientOpenLoopsProjectionIssue[];
    items: PatientOpenLoopItem[];
};

export type PatientOpenLoopsProjectionInput = {
    patientRef: string;
    expectedSourceVersion: number;
    items: OpenLoopServicePrescriptionItem[];
    observations: OpenLoopObservation[];
    now: Date;
};

function withoutPatientId(loop: OpenLoop): PatientOpenLoopItem {
    const { patientId, ...item } = loop;
    void patientId;
    return item;
}

/**
 * Builds the selected patient's deterministic open-loop projection. The caller
 * supplies a single in-memory patient context; this module never reads a store.
 */
export function projectPatientOpenLoops(input: PatientOpenLoopsProjectionInput): PatientOpenLoopsProjection {
    const scopedItems = input.items.filter((item) => item.patientId === input.patientRef);
    const scopedObservations = input.observations.filter((observation) => observation.patientId === input.patientRef);
    const omittedOutsideContext = scopedItems.length !== input.items.length
        || scopedObservations.length !== input.observations.length;

    return {
        projectionVersion: PATIENT_OPEN_LOOPS_PROJECTION_VERSION,
        patientRef: input.patientRef,
        provenance: {
            source: 'patient_open_loops',
            derivation: 'deterministic',
        },
        freshness: {
            asOf: input.now.toISOString(),
        },
        expectedSourceVersion: input.expectedSourceVersion,
        issues: omittedOutsideContext
            ? [{ code: 'outside_selected_patient_context', severity: 'warning' }]
            : [],
        items: deriveOpenLoops({
            items: scopedItems,
            observations: scopedObservations,
            now: input.now,
        }).map(withoutPatientId),
    };
}
