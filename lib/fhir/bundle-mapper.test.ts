import assert from 'node:assert/strict';
/* @Codex */
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildFhirBundleFromRecords } from './bundle-mapper';
import type { FhirBundleInput } from './types';

/* @Codex: reuse the synthetic legacy fixture; it is not a v2 parity gate. */
function readLegacyFixture(): FhirBundleInput {
    return JSON.parse(readFileSync(
        new URL('../../native/contracts/fhir-golden-input.v1.json', import.meta.url),
        'utf8',
    )) as FhirBundleInput;
}

/* @Codex */
test('Bundle.timestamp preserves the supplied export instant for string and Date inputs', () => {
    const input = readLegacyFixture();
    for (const generatedAt of ['2026-09-06T14:30:00+02:00', new Date('2026-09-06T12:30:00Z')]) {
        const bundle = buildFhirBundleFromRecords({ ...input, generatedAt });
        assert.equal(bundle.timestamp, '2026-09-06T12:30:00.000Z');
        assert.deepEqual(bundle, buildFhirBundleFromRecords({ ...input, generatedAt }));
        assert.equal(JSON.parse(JSON.stringify(bundle)).timestamp, bundle.timestamp);
    }
});

/* @Codex */
test('legacy fixture exports selected identity, diagnoses, therapy details and observations', () => {
    const input = readLegacyFixture();
    const resources = buildFhirBundleFromRecords(input).entry?.map(({ resource }) => resource) ?? [];
    const patient = resources.find((resource) => resource?.resourceType === 'Patient');
    assert.ok(patient);
    assert.equal(patient.identifier?.[0].value, input.patient.taxCode);
    assert.equal(patient.name?.[0].family, input.patient.lastName);
    assert.deepEqual(patient.name?.[0].given, [input.patient.firstName]);
    assert.equal(patient.birthDate, '1980-01-01');
    assert.equal(patient.address?.[0].text, input.patient.address);
    assert.equal(patient.telecom?.[0].value, input.patient.phone);
    assert.equal(patient.active, true);

    const conditions = resources.filter((resource) => resource?.resourceType === 'Condition');
    assert.deepEqual(conditions.map((condition) => condition.code?.text),
        input.patient.diagnoses?.map((diagnosis) => diagnosis.description));
    assert.deepEqual(conditions.map((condition) => condition.code?.coding?.[0].code),
        input.patient.diagnoses?.map((diagnosis) => diagnosis.code));

    const medications = resources.filter((resource) => resource?.resourceType === 'MedicationStatement');
    assert.deepEqual(medications.map((medication) => medication.status), ['active', 'on-hold']);
    assert.deepEqual(medications.map((medication) => medication.medicationCodeableConcept?.text),
        input.therapies.map((therapy) => therapy.drugName));
    assert.deepEqual(medications.map((medication) => medication.dosage?.[0].text),
        input.therapies.map((therapy) => therapy.dosage));
    assert.deepEqual(medications.map((medication) => medication.note?.[0].text),
        input.therapies.map((therapy) => therapy.motivation));
    assert.equal(medications[1].effectivePeriod?.end, input.therapies[1].endDate);

    const observations = resources.filter((resource) => resource?.resourceType === 'Observation');
    const scale = observations.find((observation) => observation.id === `obs-${input.entries[1].id}`);
    assert.equal(scale?.valueInteger, input.entries[1].metadata?.score);
    assert.equal(scale?.note?.[0].text, input.entries[1].content);
    const numeric = observations.find((observation) => observation.id === `obs-structured-${input.observations[0].id}`);
    assert.equal(numeric?.code.coding?.[0].code, input.observations[0].code);
    assert.equal(numeric?.valueQuantity?.value, input.observations[0].value);
    assert.equal(numeric?.valueQuantity?.code, input.observations[0].unitCode);
    assert.equal(numeric?.note?.[0].text, input.observations[0].notes);
});

/* @Codex */
test('FHIR v0 omits diary prose, exemptions and checkups and filters deleted diary entries', () => {
    const input = readLegacyFixture();
    input.entries.push({ ...input.entries[0], id: 'deleted-entry', deletedAt: input.generatedAt });
    const bundle = buildFhirBundleFromRecords(input);
    const serialized = JSON.stringify(bundle);
    for (const excluded of [
        input.entries[0].title!, input.entries[0].content,
        ...input.checkups.flatMap(({ id, title }) => [id, title]),
        ...input.patient.exemptions!, 'deleted-entry',
    ]) {
        assert.equal(serialized.includes(JSON.stringify(excluded)), false, excluded);
    }
    assert.equal(bundle.entry?.some(({ resource }) => resource?.id === 'deleted-entry'), false);
    assert.ok(bundle.entry?.some(({ resource }) =>
        resource?.resourceType === 'Encounter' && resource.id === input.entries[0].id));
});

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
