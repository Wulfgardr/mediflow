/* @Codex */

import assert from 'node:assert/strict';
import test from 'node:test';

import { projectPatientOpenLoops } from './patient-open-loops';

test('projects deterministic open loops in a minimal selected-patient envelope', () => {
    const projection = projectPatientOpenLoops({
        patientRef: 'synthetic-patient-001',
        expectedSourceVersion: 7,
        items: [{
            id: 'synthetic-item-001',
            patientId: 'synthetic-patient-001',
            prescriptionId: 'synthetic-prescription-001',
            status: 'prescribed',
            serviceName: 'Glicemia',
            createdAt: '2026-06-01T00:00:00.000Z',
        }],
        observations: [],
        now: new Date('2026-07-01T12:00:00.000Z'),
    });

    assert.deepEqual(projection, {
        projectionVersion: 'mediflow.agent.patient_open_loops.v1',
        patientRef: 'synthetic-patient-001',
        provenance: {
            source: 'patient_open_loops',
            derivation: 'deterministic',
        },
        freshness: {
            asOf: '2026-07-01T12:00:00.000Z',
        },
        expectedSourceVersion: 7,
        issues: [],
        items: [{
            kind: 'results_pending',
            label: 'Glicemia',
            status: {
                sinceDate: new Date('2026-06-01T00:00:00.000Z'),
                elapsedDays: 30,
            },
            sourceRef: {
                type: 'service_prescription_item',
                id: 'synthetic-item-001',
                prescriptionId: 'synthetic-prescription-001',
                serviceName: 'Glicemia',
            },
            suggestedAction: 'insert_results',
        }],
    });
});

test('excludes records outside the selected patient context without exposing them', () => {
    const projection = projectPatientOpenLoops({
        patientRef: 'synthetic-patient-001',
        expectedSourceVersion: 7,
        items: [{
            id: 'synthetic-item-other-patient',
            patientId: 'synthetic-patient-002',
            prescriptionId: 'synthetic-prescription-002',
            status: 'prescribed',
            serviceName: 'Creatinina',
            createdAt: '2026-06-01T00:00:00.000Z',
        }],
        observations: [],
        now: new Date('2026-07-01T12:00:00.000Z'),
    });

    assert.deepEqual(projection.items, []);
    assert.deepEqual(projection.issues, [{
        code: 'outside_selected_patient_context',
        severity: 'warning',
    }]);
});
