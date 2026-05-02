/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeCheckupCreateInput,
    normalizeCheckupUpdateInput,
    normalizeOptionalCheckupSource,
    normalizeEntryCreateInput,
    normalizeEntryUpdateInput,
    normalizeTherapyCreateInput,
    normalizeTherapyUpdateInput,
} from './api-v1-clinical-write-normalization.ts';

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

    assert.equal(result.values.content, 'updated');
    assert.equal(result.values.date, undefined);
    assert.equal(result.values.type, undefined);
    assert.ok(result.values.updatedAt instanceof Date);
});

test('normalizeEntryCreateInput preserves visit metadata and attachments', () => {
    const now = new Date('2026-04-29T10:00:00.000Z');
    const result = normalizeEntryCreateInput(
        {
            type: 'visit',
            title: 'Visita domiciliare',
            date: '2026-04-29T09:30:00.000Z',
            content: 'Contenuto cifrato lato client',
            setting: 'home',
            metadata: { scale: 'ADL', score: 4 },
            attachments: ['attachment-1'],
            updatedAt: '2026-04-29T09:45:00.000Z',
        },
        { id: 'entry-1', patientId: 'patient-1', now },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.values.title, 'Visita domiciliare');
    assert.equal(result.values.setting, 'home');
    assert.equal(result.values.metadata, '{"scale":"ADL","score":4}');
    assert.equal(result.values.attachments, '["attachment-1"]');
    assert.equal(result.values.createdAt, now);
    assert.equal(result.values.updatedAt.toISOString(), '2026-04-29T09:45:00.000Z');
});

test('normalizeEntryUpdateInput allows explicit soft delete restore fields', () => {
    const deleteResult = normalizeEntryUpdateInput({
        deletedAt: '2026-04-29T10:00:00.000Z',
        deletionReason: 'Errore di inserimento',
    });
    assert.equal(deleteResult.ok, true);
    if (!deleteResult.ok) return;
    assert.equal(deleteResult.values.deletedAt?.toISOString(), '2026-04-29T10:00:00.000Z');
    assert.equal(deleteResult.values.deletionReason, 'Errore di inserimento');

    const restoreResult = normalizeEntryUpdateInput({
        deletedAt: null,
        deletionReason: null,
    });
    assert.equal(restoreResult.ok, true);
    if (!restoreResult.ok) return;
    assert.equal(restoreResult.values.deletedAt, null);
    assert.equal(restoreResult.values.deletionReason, null);
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

test('normalizeTherapyUpdateInput rejects drift-prone invalid PUT fields', () => {
    assert.deepEqual(
        normalizeTherapyUpdateInput({ drugName: '', dosage: '500 mg' }),
        { ok: false, error: 'Invalid drugName' },
    );

    assert.deepEqual(
        normalizeTherapyUpdateInput({ dosage: '   ' }),
        { ok: false, error: 'Invalid dosage' },
    );

    assert.deepEqual(
        normalizeTherapyUpdateInput({ startDate: null }),
        { ok: false, error: 'Invalid startDate' },
    );

    assert.deepEqual(
        normalizeTherapyUpdateInput({ status: 'mystery' }),
        { ok: false, error: 'Invalid therapy status' },
    );

    assert.deepEqual(
        normalizeTherapyUpdateInput({ diagnosisCode: 1234, dosage: '500 mg' }),
        { ok: false, error: 'Invalid diagnosisCode' },
    );
});

test('normalizeTherapyUpdateInput allows partial valid updates and nullable fields', () => {
    const result = normalizeTherapyUpdateInput({
        drugName: 'Metformina',
        dosage: '500 mg x 2',
        status: 'paused',
        startDate: '2026-04-04',
        endDate: '',
        aic: '',
        diagnosisName: null,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.values.drugName, 'Metformina');
    assert.equal(result.values.dosage, '500 mg x 2');
    assert.equal(result.values.status, 'suspended');
    assert.equal(result.values.startDate?.toISOString(), '2026-04-04T00:00:00.000Z');
    assert.equal(result.values.endDate, null);
    assert.equal(result.values.aic, null);
    assert.equal(result.values.diagnosisName, null);
    assert.equal(result.values.atc, undefined);
    assert.ok(result.values.updatedAt instanceof Date);
});

test('normalizeTherapyUpdateInput allows explicit soft delete restore fields', () => {
    const deleteResult = normalizeTherapyUpdateInput({
        deletedAt: '2026-05-02T10:00:00.000Z',
        deletionReason: 'Duplicato',
    });
    assert.equal(deleteResult.ok, true);
    if (!deleteResult.ok) return;
    assert.equal(deleteResult.values.deletedAt?.toISOString(), '2026-05-02T10:00:00.000Z');
    assert.equal(deleteResult.values.deletionReason, 'Duplicato');

    const restoreResult = normalizeTherapyUpdateInput({
        deletedAt: null,
        deletionReason: null,
    });
    assert.equal(restoreResult.ok, true);
    if (!restoreResult.ok) return;
    assert.equal(restoreResult.values.deletedAt, null);
    assert.equal(restoreResult.values.deletionReason, null);
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
            { date: '2026-04-04', title: 'Controllo', source: 'external' },
            { id: 'checkup-1', patientId: 'patient-1' },
        ),
        { ok: false, error: 'Invalid source' },
    );
});

test('normalizeCheckupCreateInput keeps checkup source in the manual or ai_suggestion domain', () => {
    const manualResult = normalizeCheckupCreateInput(
        { date: '2026-04-04', title: 'Controllo' },
        { id: 'checkup-1', patientId: 'patient-1' },
    );
    assert.equal(manualResult.ok, true);
    if (!manualResult.ok) return;
    assert.equal(manualResult.values.source, 'manual');

    const aiResult = normalizeCheckupCreateInput(
        { date: '2026-04-04', title: 'Controllo', source: 'ai_suggestion' },
        { id: 'checkup-1', patientId: 'patient-1' },
    );
    assert.equal(aiResult.ok, true);
    if (!aiResult.ok) return;
    assert.equal(aiResult.values.source, 'ai_suggestion');

    assert.deepEqual(normalizeOptionalCheckupSource(undefined), { ok: true, values: undefined });
    assert.deepEqual(normalizeOptionalCheckupSource(null), { ok: true, values: null });
    assert.deepEqual(normalizeOptionalCheckupSource('manual'), { ok: true, values: 'manual' });
    assert.deepEqual(normalizeOptionalCheckupSource('ai'), { ok: false, error: 'Invalid source' });
});

test('normalizeCheckupUpdateInput rejects drift-prone invalid PUT fields', () => {
    assert.deepEqual(
        normalizeCheckupUpdateInput({ title: '' }),
        { ok: false, error: 'Invalid title' },
    );

    assert.deepEqual(
        normalizeCheckupUpdateInput({ date: 'bad-date' }),
        { ok: false, error: 'Invalid date' },
    );

    assert.deepEqual(
        normalizeCheckupUpdateInput({ status: 'later' }),
        { ok: false, error: 'Invalid checkup status' },
    );

    assert.deepEqual(
        normalizeCheckupUpdateInput({ source: 'external' }),
        { ok: false, error: 'Invalid source' },
    );

    assert.deepEqual(
        normalizeCheckupUpdateInput({ notes: 1234, title: 'Controllo' }),
        { ok: false, error: 'Invalid notes' },
    );
});

test('normalizeCheckupUpdateInput allows partial valid updates and nullable fields', () => {
    const result = normalizeCheckupUpdateInput({
        date: '2026-04-04',
        title: 'Controllo diabetologico',
        notes: '',
        status: 'done',
        source: null,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.values.date?.toISOString(), '2026-04-04T00:00:00.000Z');
    assert.equal(result.values.title, 'Controllo diabetologico');
    assert.equal(result.values.notes, null);
    assert.equal(result.values.status, 'completed');
    assert.equal(result.values.source, null);
});
