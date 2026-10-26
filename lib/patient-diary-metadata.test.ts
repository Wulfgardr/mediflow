import test from 'node:test';
import assert from 'node:assert/strict';
import { readPatientDiaryMetadata } from './patient-diary-metadata';
import { LOCKED_DATA_PLACEHOLDER, LEGACY_LOCKED_DATA_PLACEHOLDER } from './locked-field-guard';

test('object and serialized JSON retain the same recorded metadata without mutation', () => {
    const metadata = Object.freeze({ authorName: 'Ada Sintetica', sourceLabel: 'Fonte inventata', workflowStatus: 'signed', unknownRecordedField: { retained: true } });
    assert.deepEqual(readPatientDiaryMetadata(metadata), readPatientDiaryMetadata(JSON.stringify(metadata)));
    assert.equal(readPatientDiaryMetadata(metadata).value, metadata);
});

test('absent metadata stay distinct from unreadable metadata', () => {
    for (const input of [null, undefined, '', ' ', 'null']) assert.deepEqual(readPatientDiaryMetadata(input), { state: 'absent' });
    assert.deepEqual(readPatientDiaryMetadata({}), { state: 'readable', value: {} });
    for (const input of ['{', 'ENC:synthetic', LOCKED_DATA_PLACEHOLDER, LEGACY_LOCKED_DATA_PLACEHOLDER, [], '[]', 'true', '7']) assert.deepEqual(readPatientDiaryMetadata(input), { state: 'unreadable' });
});

test('unreadable fields never become an invented author, source or workflow status', () => {
    for (const field of ['authorName', 'author', 'signedBy', 'sourceLabel', 'source', 'workflowStatus', 'status']) {
        for (const value of [7, {}, 'ENC:synthetic', LOCKED_DATA_PLACEHOLDER]) {
            const metadata = { [field]: value }; assert.deepEqual(readPatientDiaryMetadata(metadata), { state: 'unreadable' });
            assert.deepEqual(readPatientDiaryMetadata(JSON.stringify(metadata)), { state: 'unreadable' });
        }
    }
    assert.deepEqual(readPatientDiaryMetadata({ workflowStatus: 'future-unrecognized-state' }), { state: 'readable', value: { workflowStatus: 'future-unrecognized-state' } });
});
