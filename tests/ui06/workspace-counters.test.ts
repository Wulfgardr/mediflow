/* @Codex UI06: synthetic projection records, not DB fixtures or clinical data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPatientWorkspaceFromRecords, countTodayCheckups, countPlannedCheckups, mapCheckupsForKree8, type Kree8CheckupSource } from '../../lib/patient-workspace';

type Records = Parameters<typeof buildPatientWorkspaceFromRecords>[0];
function records(): Records {
    const date = (day: number) => new Date(2026, 0, day, 12);
    // Only fields read by this pure projection are needed; these are NOT valid API payloads.
    return {
        patient: { id: 'ui06-patient', firstName: 'Persona', lastName: 'Sintetica', diagnoses: [], documentInsights: [] },
        entries: Array.from({ length: 9 }, (_, i) => ({ id: `e${i}`, date: date(i + 1), title: `Voce ${i}`, type: 'note', deletedAt: i === 8 ? date(10) : null })),
        therapies: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, drugName: `Nome sintetico ${i}`, status: i === 7 ? 'suspended' : 'active', createdAt: date(i + 1) })),
        checkups: Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, patientId: 'ui06-patient', date: date(i + 1), title: 'Controllo sintetico', status: i === 6 ? 'completed' : i === 7 ? 'cancelled' : 'pending' })),
        observations: [{ id: 'o1', code: 'SYNTHETIC', value: 2, observedAt: date(1) }, { id: 'o2', code: 'SYNTHETIC', value: 0, observedAt: date(2) }],
        attachments: Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, name: `Documento inventato ${i}`, createdAt: date(i + 1) })),
    } as unknown as Records;
}

test('full counts are not truncated to the three-item previews', () => {
    const result = buildPatientWorkspaceFromRecords(records());
    assert.equal(result.entriesCount, 8);
    assert.equal(result.activeTherapiesCount, 7); assert.equal(result.therapyLabels.length, 3);
    assert.equal(result.pendingCheckupsCount, 6);
    assert.equal(result.attachmentsCount, 8); assert.equal(result.recentAttachmentNames.length, 3);
});

test('zero remains an explicit latest observation value', () => {
    const result = buildPatientWorkspaceFromRecords(records());
    assert.equal(result.latestObservation?.value, '0');
    assert.equal(result.latestObservation?.label, 'SYNTHETIC: 0');
});

test('sorting a reader projection does not reorder arrays shared with diary/documents/therapies', () => {
    const input = records(); const before = structuredClone(input);
    buildPatientWorkspaceFromRecords(input);
    assert.deepEqual(input, before);
});

test('empty counters render data zeros, not invented summaries', () => {
    const input = records();
    for (const key of ['entries', 'therapies', 'checkups', 'observations', 'attachments'] as const) input[key] = [];
    const result = buildPatientWorkspaceFromRecords(input);
    for (const key of ['entriesCount', 'activeTherapiesCount', 'pendingCheckupsCount', 'observationsCount', 'attachmentsCount', 'documentInsightCount'] as const) assert.equal(result[key], 0);
    assert.equal(result.latestEntry, undefined); assert.equal(result.latestObservation, undefined);
});

test('agenda counters cover all pending rows, even beyond the six-row presentation', () => {
    const date = new Date(); date.setHours(12, 0, 0, 0);
    const rows: Kree8CheckupSource[] = Array.from({ length: 12 }, (_, i) => ({ id: `ui06-${i}`, patientId: 'ui06-patient', date, title: 'Passaggio sintetico', status: i === 10 ? 'completed' : i === 11 ? 'cancelled' : 'pending' }));
    assert.equal(countTodayCheckups(rows), 10); assert.equal(countPlannedCheckups(rows), 10);
    const rendered = mapCheckupsForKree8(rows, []);
    assert.equal(rendered.length, 6); assert.equal(new Set(rendered.map(row => row.id)).size, 6);
});
