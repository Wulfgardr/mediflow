/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSuspiciousPersonNames } from './patient-data-guardrails';

test('detectSuspiciousPersonNames ignores clinical action bigrams', () => {
    const suspicious = detectSuspiciousPersonNames(
        'Aclaton Monitorare TSH nelle prossime settimane e proseguire FKT domiciliare.',
        {
            firstName: 'Isabella Ester Evelina',
            lastName: 'Garolla',
        },
    );

    assert.deepEqual(suspicious, []);
});

test('detectSuspiciousPersonNames still flags unrelated person names', () => {
    const suspicious = detectSuspiciousPersonNames(
        'Verbale precedente firmato da Mario Rossi e allegato alla cartella.',
        {
            firstName: 'Isabella Ester Evelina',
            lastName: 'Garolla',
        },
    );

    assert.deepEqual(suspicious, ['Mario Rossi']);
});
