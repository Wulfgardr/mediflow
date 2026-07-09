import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFhirBundleFromRecords } from './bundle-mapper';

test('buildFhirBundleFromRecords maps a minimal patient fixture deterministically', () => {
    const bundle = buildFhirBundleFromRecords({
        generatedAt: '2026-07-08T09:00:00.000Z',
        patient: {
            id: 'patient-minimal',
            firstName: 'Ada',
            lastName: 'Lovelace',
            taxCode: 'LVLDDA80A41F205X',
            birthDate: '1980-01-01T00:00:00.000Z',
            address: '',
            phone: '',
            isArchived: false,
            diagnoses: [
                {
                    id: 'condition-minimal-diabetes',
                    code: 'E11.9',
                    description: 'Diabete mellito tipo 2 senza complicanze',
                    system: 'ICD-10',
                    date: '2025-01-15T08:30:00.000Z',
                },
            ],
        },
        entries: [],
        therapies: [],
        checkups: [],
        observations: [],
    });

    assert.deepEqual(bundle, {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
            {
                resource: {
                    resourceType: 'Patient',
                    id: 'patient-minimal',
                    active: true,
                    identifier: [
                        {
                            use: 'official',
                            system: 'http://hl7.it/sid/codice-fiscale',
                            value: 'LVLDDA80A41F205X',
                        },
                    ],
                    name: [
                        {
                            use: 'official',
                            family: 'Lovelace',
                            given: ['Ada'],
                        },
                    ],
                    gender: 'unknown',
                    birthDate: '1980-01-01',
                    address: undefined,
                    telecom: undefined,
                    contact: undefined,
                    meta: {
                        lastUpdated: '2026-07-08T09:00:00.000Z',
                    },
                },
            },
            {
                resource: {
                    resourceType: 'Condition',
                    id: 'condition-minimal-diabetes',
                    subject: { reference: 'Patient/patient-minimal' },
                    clinicalStatus: {
                        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
                    },
                    code: {
                        coding: [{
                            system: 'http://hl7.org/fhir/sid/icd-10',
                            code: 'E11.9',
                            display: 'Diabete mellito tipo 2 senza complicanze',
                        }],
                        text: 'Diabete mellito tipo 2 senza complicanze',
                    },
                    onsetDateTime: '2025-01-15T08:30:00.000Z',
                },
            },
        ],
    });
});

test('buildFhirBundleFromRecords maps scale metadata to an Observation resource', () => {
    const bundle = buildFhirBundleFromRecords({
        generatedAt: '2026-07-08T09:00:00.000Z',
        patient: {
            id: 'patient-scale',
            firstName: 'Ada',
            lastName: 'Lovelace',
            taxCode: 'LVLDDA80A41F205X',
        },
        entries: [
            {
                id: 'entry-scale-adl',
                patientId: 'patient-scale',
                date: '2026-02-05T14:30:00.000Z',
                type: 'scale',
                title: 'Scala ADL',
                content: 'Somministrata ADL con autonomia conservata.',
                setting: 'home',
                metadata: {
                    title: 'ADL (Indice di Katz)',
                    score: 6,
                    interpretation: 'Autonomia Conservata (6/6)',
                },
            },
        ],
        therapies: [],
        checkups: [],
        observations: [],
    });

    const scaleObservation = bundle.entry?.map((entry) => entry.resource)
        .find((resource) => resource?.resourceType === 'Observation' && resource.id === 'obs-entry-scale-adl');

    const observation = scaleObservation as { resourceType?: string; valueInteger?: number; code?: unknown } | undefined;
    assert.equal(observation?.resourceType, 'Observation');
    assert.equal(observation?.valueInteger, 6);
    assert.deepEqual(observation?.code, { text: 'ADL (Indice di Katz)' });
});
