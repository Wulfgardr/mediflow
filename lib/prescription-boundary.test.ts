/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    filterServicePrescriptionTherapyCandidates,
    isServicePrescriptionLikeTherapy,
} from './prescription-boundary';

/* @Codex */
test('prescription boundary excludes service identities and retains a drug with specialist-visit evidence', () => {
    const servicePrescription = {
        drugMention: 'Visita cardiologica',
        evidence: 'Prescritta visita cardiologica di controllo',
    };
    const drugTherapy = {
        drugMention: 'Amoxicillina',
        activePrinciple: 'Amoxicillina',
        evidence: 'Prescritta dopo visita specialistica',
    };

    assert.equal(isServicePrescriptionLikeTherapy(servicePrescription), true);
    assert.equal(isServicePrescriptionLikeTherapy(drugTherapy), false);
    assert.deepEqual(
        filterServicePrescriptionTherapyCandidates([servicePrescription, drugTherapy]),
        [drugTherapy],
    );
});

/* @Codex */
// Fissa il contratto reale: la decisione guarda solo l'identità. Se un giorno dosaggio,
// motivazione, nota di revisione o evidenza dovranno pesare, è questo test a doversi
// rompere per primo — e la domanda aperta annotata in prescription-boundary.ts a dover
// ricevere una risposta.
test('prescription boundary decides on identity alone: dosage, motivation, review note and evidence are inert', () => {
    const identityOnly = { drugMention: 'Amoxicillina' };
    const withNoise = {
        drugMention: 'Amoxicillina',
        dosage: '500 mg',
        motivation: 'Prescritta impegnativa per visita specialistica',
        reviewNote: 'Controllo cardiologico da programmare',
        evidence: 'Richiesta prestazione ambulatoriale',
    };

    assert.equal(isServicePrescriptionLikeTherapy(identityOnly), false);
    assert.equal(isServicePrescriptionLikeTherapy(withNoise), false,
        'i campi non identitari non devono spostare la classificazione');

    // Simmetrico: una posologia esplicita non riporta un'identità di prestazione fra i
    // farmaci. È il caso che la domanda aperta dovrà decidere.
    const serviceIdentityWithDosage = { drugMention: 'Visita di controllo', dosage: '500 mg' };
    assert.equal(isServicePrescriptionLikeTherapy(serviceIdentityWithDosage), true);

    // Candidato vuoto: nessuna identità, nessuna classificazione.
    assert.equal(isServicePrescriptionLikeTherapy({}), false);
    assert.equal(isServicePrescriptionLikeTherapy({ evidence: 'Visita cardiologica' }), false,
        'la sola evidenza non basta a classificare come prestazione');
});
