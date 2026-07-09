/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTreatmentReasoningContextBundle } from './treatment-reasoning-context';
import type { ClinicalEntry, Patient, Therapy } from './db';

const patient: Patient = {
    id: 'patient-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    taxCode: 'LVLDDA26A01H501Z',
    birthDate: new Date('1946-02-01T00:00:00Z'),
    address: 'Via Test 1',
    phone: '000',
    isAdi: true,
    notes: 'Riferita ipotensione al mattino dopo incremento beta-bloccante.',
    diagnoses: [
        {
            system: 'ICD-11',
            code: 'BA00',
            description: 'Ipertensione essenziale',
            date: new Date('2026-01-01T00:00:00Z'),
        },
    ],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
};

const therapies: Therapy[] = [
    {
        id: 'therapy-1',
        patientId: patient.id,
        drugName: 'Bisoprololo',
        activePrinciple: 'Bisoprololo',
        dosage: '2,5 mg 1 cp mattino',
        status: 'active',
        startDate: new Date('2026-05-01T00:00:00Z'),
        createdAt: new Date('2026-05-01T00:00:00Z'),
    },
];

const entries: ClinicalEntry[] = [
    {
        id: 'entry-1',
        patientId: patient.id,
        type: 'visit',
        date: new Date('2026-06-01T00:00:00Z'),
        title: 'Controllo terapia',
        content: '<p>PA 100/60, rivalutare beta-bloccante se sintomatica.</p>',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        updatedAt: new Date('2026-06-01T00:00:00Z'),
    },
];

test('treatment reasoning context builds source-bound prompt input without direct identifiers in patientContext', () => {
    const bundle = buildTreatmentReasoningContextBundle({
        patient,
        therapies,
        entries,
        observations: [],
        attachments: [],
        now: new Date('2026-07-01T00:00:00Z'),
    });

    assert.equal(bundle.sourceSummary.diagnoses, 1);
    assert.equal(bundle.sourceSummary.activeTherapies, 1);
    assert.equal(bundle.sourceSummary.clinicalEntries, 1);
    assert.equal(bundle.sources.some((source) => source.id === 'therapy:therapy-1'), true);
    assert.equal(bundle.activeTherapies?.[0], 'Bisoprololo (Bisoprololo) 2,5 mg 1 cp mattino');
    assert.doesNotMatch(bundle.patientContext, /Ada|Lovelace|LVLDDA/i);
});

test('treatment reasoning context ignores deleted entries and non-active therapies for active plan', () => {
    const bundle = buildTreatmentReasoningContextBundle({
        patient,
        therapies: [
            ...therapies,
            {
                id: 'therapy-2',
                patientId: patient.id,
                drugName: 'Furosemide',
                dosage: '25 mg',
                status: 'suspended',
                startDate: new Date('2026-03-01T00:00:00Z'),
                createdAt: new Date('2026-03-01T00:00:00Z'),
            },
        ],
        entries: [
            ...entries,
            {
                ...entries[0],
                id: 'entry-deleted',
                deletedAt: new Date('2026-06-02T00:00:00Z'),
            },
        ],
        observations: [],
        attachments: [],
    });

    assert.equal(bundle.sourceSummary.activeTherapies, 1);
    assert.equal(bundle.sourceSummary.clinicalEntries, 1);
    assert.equal(bundle.sources.some((source) => source.id === 'therapy:therapy-2'), false);
    assert.equal(bundle.sources.some((source) => source.id === 'entry:entry-deleted'), false);
});
