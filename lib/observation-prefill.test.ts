/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyObservationPrefill,
    removeServicePrescriptionItemLink,
    type ObservationPrefill,
} from './observation-prefill.ts';

const linkedPrefill: ObservationPrefill = {
    requestId: 'results_pending:item-1:1',
    servicePrescriptionItemId: 'item-1',
    servicePrescriptionItem: {
        id: 'item-1',
        serviceName: 'Emocromo completo',
        prescriptionDate: '2026-07-12T08:00:00.000Z',
    },
};

test('applies a mapped service result prefill with coherent parameter fields and visible link data', () => {
    const result = applyObservationPrefill(
        { ...linkedPrefill, codeSystem: 'LOINC', code: '718-7', unitCode: 'g/dL' },
        [{ code: '718-7', defaultUnit: 'g/dL' }],
    );

    assert.equal(result.code, '718-7');
    assert.equal(result.unitCode, 'g/dL');
    assert.equal(result.servicePrescriptionItemId, 'item-1');
    assert.deepEqual(result.servicePrescriptionItem, linkedPrefill.servicePrescriptionItem);
});

test('applies an unmapped service result prefill by clearing parameter fields while preserving the visible link', () => {
    const result = applyObservationPrefill(
        { ...linkedPrefill, codeSystem: 'LOINC', code: 'unmapped-code', unitCode: 'mg/dL' },
        [{ code: '718-7', defaultUnit: 'g/dL' }],
    );

    assert.equal(result.code, '');
    assert.equal(result.unitCode, '');
    assert.equal(result.servicePrescriptionItemId, 'item-1');
    assert.deepEqual(result.servicePrescriptionItem, linkedPrefill.servicePrescriptionItem);
});

test('removes a service result link before save', () => {
    const result = removeServicePrescriptionItemLink(linkedPrefill);

    assert.equal(result.servicePrescriptionItemId, undefined);
    assert.equal(result.servicePrescriptionItem, undefined);
});
