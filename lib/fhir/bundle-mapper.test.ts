import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFhirBundleFromRecords } from './bundle-mapper';
import type { FhirBundleInput } from './types';

/* @Codex */
test('buildFhirBundleFromRecords maps a minimal patient fixture deterministically', () => {
    const input: FhirBundleInput = {
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
    };

    const bundle = buildFhirBundleFromRecords(input);
    assert.deepEqual(bundle, buildFhirBundleFromRecords(input));
    assert.equal(bundle.entry?.[0]?.fullUrl, 'urn:mediflow:fhir:Patient:patient-minimal');
    assert.equal(bundle.entry?.[0]?.resource?.resourceType, 'Patient');
    assert.equal('gender' in (bundle.entry?.[0]?.resource ?? {}), false);
    assert.equal(bundle.entry?.[1]?.fullUrl, 'urn:mediflow:fhir:Condition:condition-minimal-diabetes');
    assert.deepEqual(
        (bundle.entry?.[1]?.resource as { subject?: unknown } | undefined)?.subject,
        { reference: 'urn:mediflow:fhir:Patient:patient-minimal' },
    );
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

/* @Codex */
test('diagnoses without persisted ids keep unique deterministic Condition ids', () => {
    const input: FhirBundleInput = {
        generatedAt: '2026-07-08T09:00:00.000Z',
        patient: {
            id: 'patient-diagnosis-without-ids',
            firstName: 'Ada',
            lastName: 'Lovelace',
            taxCode: 'LVLDDA80A41F205X',
            diagnoses: [
                {
                    code: 'E11.9',
                    description: 'Diabete mellito tipo 2 senza complicanze',
                    system: 'ICD-10',
                    date: '2025-01-15T08:30:00.000Z',
                },
                {
                    code: 'E11.9',
                    description: 'Diabete mellito tipo 2 in controllo dietetico',
                    system: 'ICD-10',
                    date: '2025-01-15T08:30:00.000Z',
                },
                {
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
    };

    const firstBundle = buildFhirBundleFromRecords(input);
    const secondBundle = buildFhirBundleFromRecords(input);
    const conditions = firstBundle.entry?.filter((entry) => entry.resource?.resourceType === 'Condition') ?? [];
    const ids = conditions.map((entry) => entry.resource?.id);
    const fullUrls = conditions.map((entry) => entry.fullUrl);

    assert.equal(conditions.length, 3);
    assert.equal(new Set(ids).size, 3);
    assert.equal(new Set(fullUrls).size, 3);
    assert.deepEqual(firstBundle, secondBundle);
});
