import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parsePatientDatedRecords,
    parsePatientExemptions,
    revivePatientStructuredFields,
} from './patient-structured-fields';

test('parsePatientExemptions parses JSON strings and arrays into string lists', () => {
    assert.deepEqual(parsePatientExemptions('["E01","E02",3]'), ['E01', 'E02']);
    assert.deepEqual(parsePatientExemptions(['E03', 7, 'E04']), ['E03', 'E04']);
    assert.deepEqual(parsePatientExemptions('not-json'), []);
});

test('parsePatientDatedRecords revives dates from strings and arrays', () => {
    const fromString = parsePatientDatedRecords<{ code: string }>(
        '[{"code":"A00","date":"2025-03-10T00:00:00.000Z"}]',
    );
    const fromArray = parsePatientDatedRecords<{ id: string; fileName: string }>([
        { id: 'doc-1', fileName: 'referto.pdf', date: '2025-03-11T00:00:00.000Z' },
    ]);

    assert.equal(fromString[0].code, 'A00');
    assert.ok(fromString[0].date instanceof Date);
    assert.equal(fromString[0].date.toISOString(), '2025-03-10T00:00:00.000Z');
    assert.equal(fromArray[0].fileName, 'referto.pdf');
    assert.equal(fromArray[0].date.toISOString(), '2025-03-11T00:00:00.000Z');
});

test('parsePatientDatedRecords returns an empty array for malformed JSON strings', () => {
    assert.deepEqual(parsePatientDatedRecords<{ id: string }>('{"id":"broken"'), []);
});

test('revivePatientStructuredFields only mutates parsable patient fields', () => {
    const item = {
        exemptions: '["E01","E02"]',
        diagnoses: '[{"code":"A00","date":"2025-03-10T00:00:00.000Z"}]',
        documentInsights: [
            { id: 'doc-1', fileName: 'eco.pdf', date: '2025-03-09T00:00:00.000Z' },
        ],
        untouched: 'value',
    };

    const revived = revivePatientStructuredFields(item);
    const diagnoses = revived.diagnoses as unknown as Array<{ date: Date }> | undefined;
    const documentInsights = revived.documentInsights as unknown as Array<{ date: Date }> | undefined;

    assert.deepEqual(revived.exemptions, ['E01', 'E02']);
    assert.ok(Array.isArray(diagnoses));
    assert.ok(diagnoses?.[0].date instanceof Date);
    assert.ok(Array.isArray(documentInsights));
    assert.ok(documentInsights?.[0].date instanceof Date);
    assert.equal(revived.untouched, 'value');
});
