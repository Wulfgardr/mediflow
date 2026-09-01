/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ClinicalEntry, Patient, Therapy } from '../../db.ts';
import {
    buildTreatmentReasoningProjectionAttachment,
    snapshotTreatmentReasoningProjectionAttachment,
    TreatmentReasoningProjectionError,
} from './treatment-reasoning-projection.ts';

const NOW = new Date('2026-09-01T10:00:00.000Z');
const patient = (): Patient => ({
    id: 'patient.synthetic.tr.01', firstName: 'Synthetic', lastName: 'Person',
    taxCode: 'SYNTHETIC0000000', address: 'Synthetic address', phone: '0000000000',
    birthDate: new Date('1950-01-01T00:00:00.000Z'), notes: 'Rivalutare la tolleranza della terapia.',
    diagnoses: [{ system: 'ICD-11', code: 'SYN-1', description: 'Diagnosi sintetica' }],
    version: 7, createdAt: NOW, updatedAt: NOW,
});
const therapy = (): Therapy => ({
    id: 'therapy.synthetic.tr.01', patientId: 'patient.synthetic.tr.01', drugName: 'Farmaco sintetico',
    dosage: '5 mg', status: 'active', version: 3, startDate: NOW, createdAt: NOW, updatedAt: NOW,
});
const entry = (): ClinicalEntry => ({
    id: 'entry.synthetic.tr.01', patientId: 'patient.synthetic.tr.01', type: 'note', title: 'Controllo sintetico',
    content: '<p>Controllare parametro sintetico prima di modificare la terapia.</p>', version: 2,
    date: NOW, createdAt: NOW, updatedAt: NOW,
});

function capture() {
    return buildTreatmentReasoningProjectionAttachment({
        patient: patient(), entries: [entry()], therapies: [therapy()], observations: [], attachments: [], now: NOW,
    });
}

test('builds one deeply frozen minimized projection without structured identifiers', () => {
    const value = capture();
    assert.equal(value.schemaVersion, 'mediflow.ai.treatment-reasoning-projection-attachment.v1');
    assert.equal(value.capability, 'treatment_reasoning');
    assert.equal(value.patientRevision, 7);
    assert.equal(value.capturedAt, NOW.toISOString());
    assert.ok(value.sources.length >= 3 && value.sources.length <= 16);
    assert.deepEqual(value.evidenceRefs, value.sources.map(({ id }) => id));
    assert.deepEqual(value.therapyRefs, ['therapy:therapy.synthetic.tr.01']);
    assert.equal(Object.isFrozen(value), true);
    assert.ok(value.sources.every(Object.isFrozen));
    assert.doesNotMatch(JSON.stringify(value), /Synthetic Person|SYNTHETIC0000000|Synthetic address|0000000000/u);
});

test('snapshots the exact bounded attachment and fails closed on stale or authority-bearing input', () => {
    const value = capture();
    assert.deepEqual(snapshotTreatmentReasoningProjectionAttachment(value, NOW.toISOString()), value);
    const stale = { ...value, capturedAt: '2026-09-01T09:54:59.999Z' };
    assert.throws(
        () => snapshotTreatmentReasoningProjectionAttachment(stale, NOW.toISOString()),
        (error) => error instanceof TreatmentReasoningProjectionError && error.code === 'projection_stale',
    );
    for (const extra of [
        { prompt: 'caller prompt' }, { provider: 'athena_mlx' }, { apply: true }, { patientId: 'patient.synthetic.tr.01' },
    ]) {
        assert.throws(
            () => snapshotTreatmentReasoningProjectionAttachment({ ...value, ...extra }, NOW.toISOString()),
            (error) => error instanceof TreatmentReasoningProjectionError && error.code === 'projection_invalid',
        );
    }
});

test('rejects duplicate, unknown, sparse, accessor, and oversized source sets', () => {
    const value = capture();
    const duplicate = { ...value, evidenceRefs: [value.evidenceRefs[0], value.evidenceRefs[0]] };
    const unknown = { ...value, evidenceRefs: [...value.evidenceRefs.slice(0, -1), 'evidence.unknown'] };
    const sparse = { ...value, sources: new Array(2) };
    const accessor = { ...value } as Record<string, unknown>;
    Object.defineProperty(accessor, 'patientRevision', { enumerable: true, get: () => 7 });
    const oversized = { ...value, sources: Array.from({ length: 17 }, (_, index) => ({ ...value.sources[0], id: `evidence.synthetic.${index}` })) };
    for (const invalid of [duplicate, unknown, sparse, accessor, oversized]) {
        assert.throws(
            () => snapshotTreatmentReasoningProjectionAttachment(invalid, NOW.toISOString()),
            (error) => error instanceof TreatmentReasoningProjectionError && error.code === 'projection_invalid',
        );
    }
});

test('keeps the projection builder pure and outside provider, selection, persistence, and apply boundaries', () => {
    const source = readFileSync(new URL('./treatment-reasoning-projection.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /server-only|AIService|generateWithAthena|fetch\(|db\.|\/api\/|provider-lifecycle|apply|write/u);
    assert.match(source, /buildTreatmentReasoningContextBundle/u);
});
