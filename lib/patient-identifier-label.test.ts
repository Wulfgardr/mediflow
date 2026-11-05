import test from 'node:test';
import assert from 'node:assert/strict';
import { patientIdentifierLabel } from './patient-identifier-label';

test('l’identificativo porta il proprio nome, come nell’app Apple', () => {
    assert.equal(patientIdentifierLabel('RSSMRA80A01H501U'), 'CF');
    assert.equal(patientIdentifierLabel('STP0300010000123'), 'STP');
    assert.equal(patientIdentifierLabel(' eni0300010000123 '), 'ENI');
    assert.equal(patientIdentifierLabel(undefined), 'CF');
});

test('un codice fiscale che inizia con STP o ENI resta un codice fiscale', () => {
    assert.equal(patientIdentifierLabel('STPMRA80A01H501U'), 'CF');
    assert.equal(patientIdentifierLabel('ENIXXX80A01H501U'), 'CF');
    assert.equal(patientIdentifierLabel('STP03000100001'), 'CF');
});
