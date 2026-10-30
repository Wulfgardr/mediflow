import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSpecialistDecision } from './prescription.ts';

import { SYNTHETIC_DECISION as decision, SYNTHETIC_CATALOG as catalog } from './synthetic-demo.test-support.ts';

test('CU-1 specialistica: conserva scelta, quantità, quesito ed esenzione verificata per riga', () => {
    assert.deepEqual(validateSpecialistDecision(decision, catalog, 1_000_000), decision);
});
test('CU-1 specialistica: titolo presente ma non applicabile non autorizza esenzione', () => {
    assert.throws(() => validateSpecialistDecision({ ...decision,
        exemption: { ...decision.exemption, applicableCodes: ['OTHER'] } }, catalog, 1_000_000));
});
test('CU-1 specialistica: nessuna inferenza, troncamento o normalizzazione clinica', () => {
    for (const changes of [ { clinicalQuestion: '' }, { priority: 'urgent' }, { invented: 'NEW_FIELD_SENTINEL' },
        { exemption: { ...decision.exemption, patientId: 'other' } },
        { exemption: { ...decision.exemption, validUntil: 999_999 } },
        { items: [{ ...decision.items[0], quantity: 1.5 }] },
        { items: [{ ...decision.items[0], description: 'other' }] },
        { items: [{ ...decision.items[0], unit: 'mg' }] } ]) {
        assert.throws(() => validateSpecialistDecision({ ...decision, ...changes }, catalog, 1_000_000));
    }
});

test('CU contratto esenzioni: scadenza al limite e titolo futuro bloccano', () => {
    for (const changes of [{ validUntil: 1_000_000 }, { validFrom: 1_000_001 }]) {
        assert.throws(() => validateSpecialistDecision({ ...decision,
            exemption: { ...decision.exemption, ...changes } }, catalog, 1_000_000));
    }
});

test('CU contratto esenzioni: applicazione mista non rappresentabile sospende l’intero piano', () => {
    const second = { ...decision.items[0]!, id: 'demo-second', code: 'DEMO.02' };
    const mixedCatalog = { ...catalog, entries: [...catalog.entries,
        { code: second.code, description: second.description, unit: second.unit }] };
    assert.throws(() => validateSpecialistDecision({ ...decision, items: [...decision.items, second] }, mixedCatalog, 1_000_000));
    const both = { ...decision, items: [...decision.items, second],
        exemption: { ...decision.exemption, applicableCodes: ['DEMO.01', 'DEMO.02'] } };
    assert.deepEqual(validateSpecialistDecision(both, mixedCatalog, 1_000_000), both);
});
