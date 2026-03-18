import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizePatientCreateInput,
    normalizePatientUpdateInput,
} from './patient-write-normalization';

test('normalizePatientCreateInput stringifies structured fields and sets defaults', () => {
    const now = new Date('2026-03-18T10:00:00.000Z');
    const result = normalizePatientCreateInput({
        firstName: 'Ada',
        lastName: 'Lovelace',
        taxCode: 'LVLADA80A01H501X',
        birthDate: '1980-01-01',
        exemptions: ['E01'],
        diagnoses: [{ code: 'A00', description: 'Diag' }],
        notes: '',
        isArchived: true,
    }, {
        id: 'pat-1',
        ambulatoryId: 'amb-1',
        allowArchivedOnCreate: false,
        now,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.values.id, 'pat-1');
    assert.equal(result.values.ambulatoryId, 'amb-1');
    assert.equal(result.values.version, 1);
    assert.equal(result.values.isArchived, false);
    assert.equal(result.values.notes, null);
    assert.equal(result.values.exemptions, JSON.stringify(['E01']));
    assert.equal(result.values.diagnoses, JSON.stringify([{ code: 'A00', description: 'Diag' }]));
    assert.equal(result.values.birthDate?.toISOString(), '1980-01-01T00:00:00.000Z');
    assert.equal(result.values.createdAt?.toISOString(), now.toISOString());
    assert.equal(result.values.updatedAt?.toISOString(), now.toISOString());
});

test('normalizePatientCreateInput rejects invalid birthDate', () => {
    const result = normalizePatientCreateInput({
        firstName: 'Ada',
        lastName: 'Lovelace',
        taxCode: 'LVLADA80A01H501X',
        birthDate: 'not-a-date',
    }, {
        id: 'pat-1',
    });

    assert.deepEqual(result, {
        ok: false,
        error: 'Invalid birthDate',
    });
});

test('normalizePatientUpdateInput treats empty birthDate as null and increments version', () => {
    const now = new Date('2026-03-18T11:00:00.000Z');
    const result = normalizePatientUpdateInput({
        version: 7,
        birthDate: '',
        firstName: 'Updated',
    }, {
        expectedVersion: 7,
        now,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.values.firstName, 'Updated');
    assert.equal(result.values.birthDate, null);
    assert.equal(result.values.version, 8);
    assert.equal(result.values.updatedAt?.toISOString(), now.toISOString());
});

test('normalizePatientUpdateInput preserves omitted structured fields and stringifies provided arrays', () => {
    const omitted = normalizePatientUpdateInput({
        version: 3,
        statusReason: null,
    }, {
        expectedVersion: 3,
    });

    assert.equal(omitted.ok, true);
    if (omitted.ok) {
        assert.equal('exemptions' in omitted.values, false);
        assert.equal('diagnoses' in omitted.values, false);
        assert.equal(omitted.values.statusReason, null);
    }

    const provided = normalizePatientUpdateInput({
        version: 3,
        exemptions: ['E01', 'E02'],
        diagnoses: [{ code: 'B00' }],
    }, {
        expectedVersion: 3,
    });

    assert.equal(provided.ok, true);
    if (!provided.ok) return;

    assert.equal(provided.values.exemptions, JSON.stringify(['E01', 'E02']));
    assert.equal(provided.values.diagnoses, JSON.stringify([{ code: 'B00' }]));
});

test('normalizePatientUpdateInput rejects invalid birthDate and empty payloads', () => {
    const invalidBirthDate = normalizePatientUpdateInput({
        version: 4,
        birthDate: 'bad-date',
    }, {
        expectedVersion: 4,
    });

    assert.deepEqual(invalidBirthDate, {
        ok: false,
        error: 'Invalid birthDate',
    });

    const noOp = normalizePatientUpdateInput({
        version: 4,
    }, {
        expectedVersion: 4,
    });

    assert.deepEqual(noOp, {
        ok: false,
        error: 'No valid fields to update',
    });
});
