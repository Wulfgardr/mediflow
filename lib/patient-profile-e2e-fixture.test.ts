import assert from 'node:assert/strict';
import test from 'node:test';
import { scopedNotesOpenInput, syntheticScopedNotesView } from '../e2e/fixtures/scoped-profile-notes-query';
import { isProfileResult } from './patient-profile-scoped-contract';

const origin = 'http://127.0.0.1:3000';
const patientId = 'synthetic-fixture-patient';
const body = { kind: 'open', contractVersion: 1, projection: 'notes', expectedSelectionEpoch: 7 };
function request(overrides: { method?: string; url?: string; body?: unknown; malformed?: boolean } = {}) {
    return { method: () => overrides.method ?? 'POST',
        url: () => overrides.url ?? `${origin}/api/patients/${patientId}/profile-query`,
        postDataJSON: () => { if (overrides.malformed) throw new Error('synthetic malformed body'); return overrides.body ?? body; } };
}

test('the fixture recognizes only the exact selected-patient open notes request', () => {
    const input = scopedNotesOpenInput(request(), patientId, origin); assert.deepEqual(input, body); assert.ok(input);
    const result = syntheticScopedNotesView(input, { version: 4, notes: 'ENC:synthetic:fixture' });
    assert.equal(isProfileResult(result), true); assert.deepEqual(Object.keys(result.profile), ['notes']);
    assert.equal(result.profile.notes, 'ENC:synthetic:fixture'); assert.equal(result.currentness.revision, 4);
    assert.equal(result.currentness.selectionEpoch, 8); assert.ok(result.currentness.expiresAt > result.currentness.observedAt);
    assert.equal(JSON.stringify(result).includes(patientId), false);
});

test('unknown queries, other patients, extra authority and every clinical write remain outside the read classification', () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) assert.equal(scopedNotesOpenInput(request({ method }), patientId, origin), null);
    for (const url of [
        `${origin}/api/patients/another-patient/profile-query`, `${origin}/api/patients/${patientId}`,
        `${origin}/api/patients/${patientId}/profile-query/`, `${origin}/api/patients/${patientId}/profile-query-extra`,
        `${origin}/api/patients/${patientId}/profile-query?scope=other`,
        `http://127.0.0.1:4444/api/patients/${patientId}/profile-query`,
    ]) assert.equal(scopedNotesOpenInput(request({ url }), patientId, origin), null, url);
    for (const input of [
        { ...body, kind: 'unknown' }, { ...body, contractVersion: 2 }, { ...body, projection: 'profile' },
        { ...body, expectedSelectionEpoch: -1 }, { ...body, scope: 'caller' }, { ...body, notes: 'clinical mutation' },
        { kind: 'read', contractVersion: 1, projection: 'notes', handle: 'pph_' + 'a'.repeat(64), expectedRevision: 4 },
        { version: 4, firstName: 'changed' }, { kind: 'open', projection: 'notes', expectedSelectionEpoch: 7 },
    ]) assert.equal(scopedNotesOpenInput(request({ body: input }), patientId, origin), null);
    assert.equal(scopedNotesOpenInput(request({ malformed: true }), patientId, origin), null);
});
