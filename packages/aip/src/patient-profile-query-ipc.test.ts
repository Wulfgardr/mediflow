import assert from 'node:assert/strict';
import test from 'node:test';
import { PROFILE_QUERY_MAX_RESULT_BYTES, assertProfileResultBudget, isProfileResult } from '../../../lib/patient-profile-scoped-contract.ts';
import { encodePatientProfileQueryIpcFrameV1 as encode, decodePatientProfileQueryIpcFrameV1 as decode } from './patient-profile-query-ipc.ts';
const request = { schemaVersion: 'mediflow.patient-profile.ipc.v1', type: 'query',
  requestRef: `ppqr_${'a'.repeat(32)}`, operationId: 'patient-profile.read.v1',
  input: { kind: 'open', contractVersion: 1, projection: 'notes', expectedSelectionEpoch: 2 } };
const result = { schemaVersion: 'mediflow.patient.profile-view.v1', operationId: 'patient-profile.read.v1',
  contractVersion: 1, handle: `pph_${'b'.repeat(64)}`, projection: 'notes',
  currentness: { revision: 3, selectionEpoch: 2, observedAt: 1000, expiresAt: 2000 }, profile: { notes: 'Synthetic note' } };
test('roundtrips bounded profile query/result and finite denial frames canonically', () => {
  for (const frame of [request, { ...request, type: 'query_result', input: undefined },
    { schemaVersion: request.schemaVersion, type: 'query_result', requestRef: request.requestRef,
      operationId: request.operationId, outcome: 'completed', result },
    { schemaVersion: request.schemaVersion, type: 'query_result', requestRef: request.requestRef,
      operationId: request.operationId, outcome: 'denied', denialCode: 'handle_expired' }]) {
    if ('input' in frame && frame.input === undefined) { assert.throws(() => encode(frame)); continue; }
    assert.deepEqual(JSON.parse(encode(frame)), JSON.parse(JSON.stringify(frame)));
    assert.equal(encode(decode(encode(frame))), encode(frame));
  }
});
test('rejects identities, malformed handles, extra profile fields, hostile objects and oversized notes', () => {
  for (const input of [{ ...request.input, patientId: 'forbidden' },
    { kind: 'read', contractVersion: 1, projection: 'notes', handle: 'database-id', expectedRevision: 1 },
    new Proxy(request.input, {})]) assert.throws(() => encode({ ...request, input }));
  const response = { schemaVersion: request.schemaVersion, type: 'query_result', requestRef: request.requestRef,
    operationId: request.operationId, outcome: 'completed', result };
  for (const profile of [{ notes: 'Synthetic', id: 'forbidden' }, { notes: 'x'.repeat(64 * 1024) },
    { get notes() { throw new Error('must not run'); } }]) assert.throws(() => encode({ ...response, result: { ...result, profile } }));
  assert.throws(() => decode(encode(request) + ' '));
  assert.throws(() => decode(encode(request).replace('"kind":"open"', '"kind":"open","kind":"open"')));
});

test('shares the32KiB JSON UTF-8 result budget including Unicode and escaping without truncation', () => {
  const frame = { schemaVersion: request.schemaVersion, type: 'query_result', requestRef: request.requestRef,
    operationId: request.operationId, outcome: 'completed', result };
  for (const seed of ['😀', 'é', '\u0000', '"', '\\']) {
    const candidate = { ...result, profile: { notes: seed.repeat(200) } };
    const overhead = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
    candidate.profile.notes += 'x'.repeat(PROFILE_QUERY_MAX_RESULT_BYTES - overhead);
    assert.equal(Buffer.byteLength(JSON.stringify(candidate), 'utf8'), PROFILE_QUERY_MAX_RESULT_BYTES);
    assert.ok(isProfileResult(candidate)); assertProfileResultBudget(candidate);
    const wire = encode({ ...frame, result: candidate });
    assert.ok(Buffer.byteLength(wire) < 48 * 1024);
    assert.deepEqual(JSON.parse(wire).result.profile, candidate.profile);
    candidate.profile.notes += 'x';
    assert.throws(() => assertProfileResultBudget(candidate), (e: unknown) => (e as {code: string}).code === 'output_too_large');
    assert.throws(() => encode({ ...frame, result: candidate }));
  }
});
