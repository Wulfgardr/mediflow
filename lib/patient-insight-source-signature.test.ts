import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPatientInsightPreviewRequest } from './ai-providers/fabric/patient-insight-preview-contract.ts';
import { currentPatientInsightSourceSignature, patientInsightSourceSignature } from './patient-insight-source-signature.ts';

const patient = { id: 'patient-1', ambulatoryId: 'amb-1', version: 4, diagnoses: [{ code: 'I10', description: 'Ipertensione sintetica' }] };
const therapies = [{ drugName: 'Farmaco sintetico', dosage: '1 cp', status: 'active' }];
const entries = [{ title: 'Controllo sintetico', content: 'Contenuto sintetico.' }];

function sent() {
    return patientInsightSourceSignature(buildPatientInsightPreviewRequest({
        patient, therapies, entries, requestId: 'pi_00000000-0000-4000-8000-000000000001', capturedAt: '2026-11-09T10:00:00.000Z',
    }));
}

test('rileggere le stesse sezioni lascia la proposta attuale', () => {
    assert.equal(currentPatientInsightSourceSignature({ patient: { ...patient }, therapies: therapies.map(t => ({ ...t })), entries: entries.map(e => ({ ...e })) }), sent());
});

test('una nota che non entra nelle fonti non supera la proposta', () => {
    assert.equal(currentPatientInsightSourceSignature({ patient, entries, therapies: [{ ...therapies[0], motivation: 'Nota cambiata' } as typeof therapies[0]] }), sent());
});

test('diario, terapie o profilo cambiati superano la proposta', () => {
    const changes = [
        { patient, therapies, entries: [{ ...entries[0], content: 'Contenuto cambiato.' }] },
        { patient, therapies, entries: [] },
        { patient, therapies: [{ ...therapies[0], dosage: '2 cp' }], entries },
        { patient, therapies: [...therapies, { drugName: 'Secondo farmaco', dosage: '1 cp', status: 'active' }], entries },
        { patient, therapies: [{ ...therapies[0], status: 'suspended' }], entries },
        { patient: { ...patient, version: 5 }, therapies, entries },
    ];
    for (const change of changes) assert.notEqual(currentPatientInsightSourceSignature(change), sent());
});
