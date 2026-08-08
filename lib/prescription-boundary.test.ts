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
