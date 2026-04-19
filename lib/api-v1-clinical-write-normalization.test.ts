/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeCheckupCreateInput,
    normalizeEntryCreateInput,
    normalizeEntryUpdateInput,
    normalizeTherapyCreateInput,
} from './api-v1-clinical-write-normalization';

test('normalizeEntryCreateInput rejects invalid required fields before the DB layer', () => {
    assert.deepEqual(
        normalizeEntryCreateInput(
            { type: 'visit', date: 'bad-date', content: 'ok' },
            { id: 'entry-1', patientId: 'patient-1' },
        ),
        { ok: false, error: 'Invalid date' },
    );

    assert.deepEqual(
        normalizeEntryCreateInput(
            { type: '', date: '2026-04-04', content: 'ok' },
            { id: 'entry-1', patientId: 'patient-1' },
        ),
        { ok: false, error: 'Invalid type' },
    );

    assert.deepEqual(
        normalizeEntryCreateInput(
            { type: 'visit', date: '2026-04-04', content: 42 },
            { id: 'entry-1', patientId: 'patient-1' },
        ),
        { ok: false, error: 'Invalid content' },
    );
});

test('normalizeEntryUpdateInput fails fast on invalid date and still allows partial updates', () => {
    assert.deepEqual(
        normalizeEntryUpdateInput({ date: 'bad-date', content: 'updated' }),
        { ok: false, error: 'Invalid date' },
    );

    const result = normalizeEntryUpdateInput({ content: 'updated' });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.deepEqual(result.values, {
        content: 'updated',
        date: undefined,
        type: undefined,
    });
});

test('normalizeTherapyCreateInput rejects invalid dates, status, and optional field types', () => {
    assert.deepEqual(
        normalizeTherapyCreateInput(
            { drugName: 'Metformina', dosage: '500 mg', startDate: 'bad-date' },
            { id: 'therapy-1', patientId: 'patient-1' },
        ),
        { ok: false, error: 'Invalid startDate' },
    );

    assert.deepEqual(
        normalizeTherapyCreateInput(
            { drugName: 'Metformina', dosage: '500 mg', startDate: '2026-04-04', status: 'mystery' },
            { id: 'therapy-1', patientId: 'patient-1' },
        ),
        { ok: false, error: 'Invalid therapy status' },
    );

    assert.deepEqual(
        normalizeTherapyCreateInput(
            {
                drugName: 'Metformina',
                dosage: '500 mg',
                startDate: '2026-04-04',
                diagnosisCode: 1234,
            },
            { id: 'therapy-1', patientId: 'patient-1' },
        ),
        { ok: false, error: 'Invalid diagnosisCode' },
    );

    assert.deepEqual(
        normalizeTherapyCreateInput(
            {
                drugName: 'Metformina',
                dosage: '500 mg',
                startDate: '2026-04-04',
                endDate: 'bad-date',
            },
            { id: 'therapy-1', patientId: 'patient-1' },
        ),
        { ok: false, error: 'Invalid endDate' },
    );
});

test('normalizeCheckupCreateInput rejects invalid required fields and invalid status values', () => {
    assert.deepEqual(
        normalizeCheckupCreateInput(
            { date: 'bad-date', title: 'Controllo' },
            { id: 'checkup-1', patientId: 'patient-1' },
        ),
        { ok: false, error: 'Invalid date' },
    );

    assert.deepEqual(
        normalizeCheckupCreateInput(
            { date: '2026-04-04', title: '', status: 'pending' },
            { id: 'checkup-1', patientId: 'patient-1' },
        ),
        { ok: false, error: 'Invalid title' },
    );

    assert.deepEqual(
        normalizeCheckupCreateInput(
            { date: '2026-04-04', title: 'Controllo', status: 'later' },
            { id: 'checkup-1', patientId: 'patient-1' },
        ),
        { ok: false, error: 'Invalid checkup status' },
    );

    assert.deepEqual(
        normalizeCheckupCreateInput(
            { date: '2026-04-04', title: 'Controllo', source: 7 },
            { id: 'checkup-1', patientId: 'patient-1' },
        ),
        { ok: false, error: 'Invalid source' },
    );
});
