import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AGENT_PATIENT_CONTEXT_SCHEMA,
    AGENT_PATIENT_CONTEXT_TTL_MS,
    parseAgentPatientContextInput,
    sealAgentPatientContextEnvelope,
} from './agent-local-kit-context-contract';
import { agentPatientContextIdentity, buildAgentPatientContextPayload } from './agent-local-kit-context-client';
import { pseudonymizeAgentPatientContext } from './agent-local-kit-context-pseudonymization';
import type { Checkup, ClinicalEntry, Observation, Patient, Therapy } from './db';

const SYNTHETIC_CF = 'RSSMRA80A01H501U';

const SYNTHETIC_REFERENCE = 'a'.repeat(64);

test('parseAgentPatientContextInput accepts a valid minimal payload and seals with 24h TTL', () => {
    const parsed = parseAgentPatientContextInput({
        patient: { taxCodeLast4: '501U', isAdi: false },
        diagnoses: [{ description: 'Ipertensione arteriosa essenziale', code: 'BA00', system: 'ICD-11', date: '2026-01-10' }],
        therapies: [{ drugName: 'Ramipril 5 mg', activePrinciple: 'ramipril', dosage: '1 cp al mattino', status: 'active', startDate: '2026-01-10' }],
        exemptions: [{ code: '031' }],
        allergies: [{ substance: 'Penicillina', reaction: 'orticaria', severity: 'moderate' }],
        observations: [{ display: 'Peso corporeo', value: '74.5', unit: 'kg', code: '29463-7', observedAt: '2026-10-01' }],
        recentNotes: [{ date: '2026-10-01', title: 'Controllo', text: 'Compenso stabile.' }],
        openCheckups: [{ title: 'Controllo pressorio', status: 'pending' }],
    });
    assert.ok(parsed);
    assert.equal(parsed.patient.taxCodeLast4, '501U');

    const now = 1_700_000_000_000;
    const envelope = sealAgentPatientContextEnvelope(parsed, SYNTHETIC_REFERENCE, now);
    assert.equal(envelope.schema, AGENT_PATIENT_CONTEXT_SCHEMA);
    assert.deepEqual(envelope.patient, { cfHash: SYNTHETIC_REFERENCE, taxCodeLast4: '501U', isAdi: false });
    assert.equal(envelope.exportedAt, now);
    assert.equal(envelope.expiresAt, now + AGENT_PATIENT_CONTEXT_TTL_MS);
});

test('parseAgentPatientContextInput rejects unknown keys, a reference or birth year from the client, and oversized payloads', () => {
    const valid = {
        patient: { taxCodeLast4: '501U' },
        diagnoses: [],
        therapies: [],
        exemptions: [],
        allergies: [],
        observations: [],
        recentNotes: [],
        openCheckups: [],
    };
    assert.equal(parseAgentPatientContextInput({ ...valid, firstName: 'NonAmmesso' }), null);
    assert.ok(parseAgentPatientContextInput(valid));
    assert.equal(parseAgentPatientContextInput({ ...valid, patient: { cfHash: SYNTHETIC_REFERENCE, taxCodeLast4: '501U' } }), null);
    assert.equal(parseAgentPatientContextInput({ ...valid, patient: { taxCodeLast4: '501U', birthYear: 1980 } }), null);
    assert.equal(parseAgentPatientContextInput({ ...valid, patient: { taxCodeLast4: '50' } }), null);
    assert.equal(parseAgentPatientContextInput({ ...valid, therapies: [{ drugName: 'X', dosage: '1 cp', status: 'unknown' }] }), null);
    assert.equal(parseAgentPatientContextInput({ ...valid, recentNotes: Array.from({ length: 11 }, () => ({ date: '2026-10-01', text: 'x' })) }), null);
});

test('buildAgentPatientContextPayload keeps only the last 4 of the taxCode, strips HTML, and with the server pseudonymization releases no identity written in notes; null without taxCode', async () => {
    const now = new Date('2026-11-01T09:00:00Z');
    const patient: Patient = {
        id: 'pat-synth-1',
        firstName: 'NomeSintetico',
        lastName: 'CognomeSintetico',
        taxCode: ` ${SYNTHETIC_CF.toLowerCase()} `,
        birthDate: new Date('1980-01-01T00:00:00Z'),
        address: 'Via Sintetica 1',
        phone: '0000000000',
        isAdi: true,
        updatedAt: now,
        createdAt: now,
        diagnoses: [{ code: 'BA00', description: 'Ipertensione essenziale', system: 'ICD-11', date: now }],
        allergies: [{ substance: 'FANS', reaction: 'broncospasmo', severity: 'severe' }],
    };
    const entries: ClinicalEntry[] = [
        {
            id: 'e1',
            patientId: patient.id,
            date: now,
            type: 'visit',
            title: 'Visita controllo di NomeSintetico',
            content: '<p><strong>S:</strong> benessere, CognomeSintetico NomeSintetico riferisce telefono 0000000000.</p><p><strong>P:</strong> proseguire terapia, CF rssmra80a01h501u, vive in Via Sintetica 1.</p>',
            createdAt: now,
            updatedAt: now,
        },
        {
            id: 'e2',
            patientId: patient.id,
            date: now,
            type: 'scale',
            title: 'MMSE',
            content: '28/30',
            createdAt: now,
            updatedAt: now,
        },
    ];
    const therapies: Therapy[] = [
        { id: 't1', patientId: patient.id, drugName: 'Bisoprololo 2.5 mg', dosage: '1 cp/die', status: 'suspended', startDate: new Date('2025-01-01T00:00:00Z'), createdAt: now },
        { id: 't2', patientId: patient.id, drugName: 'Ramipril 5 mg', activePrinciple: 'ramipril', dosage: '1 cp al mattino', status: 'active', startDate: now, createdAt: now },
    ];
    const observations: Observation[] = [
        { id: 'o1', patientId: patient.id, codeSystem: 'LOINC', code: '29463-7', display: 'Peso corporeo', unitSystem: 'UCUM', unitCode: 'kg', value: 75, observedAt: now, createdAt: now },
    ];
    const checkups: Checkup[] = [
        { id: 'c1', patientId: patient.id, date: now, title: 'Esami ematici', status: 'pending', createdAt: now },
        { id: 'c2', patientId: patient.id, date: now, title: 'Chiuso', status: 'completed', createdAt: now },
    ];

    const payload = await buildAgentPatientContextPayload({
        patient,
        entries,
        therapies,
        observations,
        checkups,
        exemptionCodes: ['031', '031', 'E01'],
    });
    assert.ok(payload);
    const released = pseudonymizeAgentPatientContext(payload, agentPatientContextIdentity(patient));
    const serialized = JSON.stringify(released).toUpperCase();
    for (const value of ['NomeSintetico', 'CognomeSintetico', SYNTHETIC_CF, 'Via Sintetica', '0000000000']) {
        assert.equal(serialized.includes(value.toUpperCase()), false, value);
    }
    assert.deepEqual(payload.patient, { taxCodeLast4: '501U', isAdi: true });
    assert.equal(payload.therapies[0]?.drugName, 'Ramipril 5 mg');
    assert.equal(payload.recentNotes.length, 1);
    assert.equal(payload.recentNotes[0]?.text.includes('<p>'), false);
    assert.equal(payload.recentNotes[0]?.text.includes('benessere,'), true);
    assert.deepEqual({ ...released, recentNotes: [] }, { ...payload, recentNotes: [] });
    assert.deepEqual(payload.exemptions, [{ code: '031' }, { code: 'E01' }]);
    assert.deepEqual(payload.openCheckups, [{ title: 'Esami ematici', status: 'pending' }]);

    const missingCf = await buildAgentPatientContextPayload({
        patient: { ...patient, taxCode: '' },
        entries: [],
        therapies: [],
        observations: [],
        checkups: [],
        exemptionCodes: [],
    });
    assert.equal(missingCf, null);
});
