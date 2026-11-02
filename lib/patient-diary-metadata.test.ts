import test from 'node:test';
import assert from 'node:assert/strict';
import { PATIENT_DIARY_WORKFLOW_LABELS, patientDiaryWorkflowState, readPatientDiaryMetadata } from './patient-diary-metadata';
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

test('history and diary share recorded source, setting fallback and unreadable provenance', async () => {
    const { patientDiarySource } = await import('./patient-diary-metadata');
    for (const metadata of [{ sourceLabel: ' Fonte inventata ', source: 'Altra fonte' }, JSON.stringify({ sourceLabel: 'Fonte inventata' })]) {
        assert.equal(patientDiarySource(metadata, 'home'), 'Fonte inventata');
    }
    assert.equal(patientDiarySource({ source: 'Originale' }), 'Originale');
    assert.equal(patientDiarySource(null, 'ambulatory'), 'Ambulatorio');
    assert.equal(patientDiarySource(null), 'Diario locale');
    assert.equal(patientDiarySource('ENC:synthetic', 'ambulatory'), 'Fonte non disponibile');
});

test('one workflow rule for cockpit and timeline: an unknown value is never a certain state', () => {
    const label = (metadata: unknown) => PATIENT_DIARY_WORKFLOW_LABELS[patientDiaryWorkflowState(metadata)];
    assert.equal(label({ workflowStatus: 'future-unrecognized-state' }), 'Stato non riconosciuto');
    assert.equal(label(JSON.stringify({ status: 'approvata' })), 'Stato non riconosciuto');
    assert.equal(label({ workflowStatus: 'ENC:synthetic' }), 'Stato non leggibile');
    assert.equal(label('ENC:synthetic'), 'Stato non leggibile');
    assert.equal(label({ workflowStatus: ' Firmata ' }), 'Firmata');
    assert.equal(label({ status: 'BOZZA' }), 'Bozza');
    assert.equal(label({ workflowStatus: 'registered' }), 'Registrata');
    assert.equal(label({ workflowStatus: 'signed', status: 'draft' }), 'Firmata');
});

test('a saved entry without any workflow value is the recorded entry', () => {
    for (const metadata of [undefined, null, '', {}, { authorName: 'Ada Sintetica' }]) {
        assert.equal(patientDiaryWorkflowState(metadata), 'recorded');
    }
});
