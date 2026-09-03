/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1,
  CheckupStatusTransitionIpcV1Error,
  decodeCheckupStatusTransitionIpcFrameV1,
  encodeCheckupStatusTransitionIpcFrameV1,
} from './checkup-status-transition-ipc.ts';

const OPERATION = 'mediflow.patient.checkup.status.transition.v1';
const request = {
  schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1,
  type: 'preview',
  requestRef: `hcqr_${'a'.repeat(32)}`,
  operationId: OPERATION,
  input: {
    schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
    operationId: OPERATION,
    checkupRef: `hcsr_${'b'.repeat(64)}`,
    targetStatus: 'completed',
    expectedRevision: 3,
  },
};

test('round-trips only the preview request and PHI-safe result frames', () => {
  const proposed = { schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1, type: 'preview_result',
    requestRef: request.requestRef, operationId: OPERATION, outcome: 'proposed',
    proposalRef: `hcsp_${'c'.repeat(64)}`, expiresAt: 1_900_000_000_000 };
  const denied = { schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1, type: 'preview_result',
    requestRef: request.requestRef, operationId: OPERATION, outcome: 'denied', denialCode: 'scope_changed' };
  for (const value of [request, proposed, denied]) {
    const encoded = encodeCheckupStatusTransitionIpcFrameV1(value);
    const decoded = decodeCheckupStatusTransitionIpcFrameV1(encoded);
    assert.equal(Object.getPrototypeOf(decoded), null);
    assert.equal(Object.isFrozen(decoded), true);
    assert.equal(JSON.stringify(decoded), encoded);
  }
});

test('rejects authority, raw identifiers, wrong operations, extras and oversized frames', () => {
  const invalid = [
    { ...request, input: { ...request.input, patientId: 'synthetic-patient' } },
    { ...request, input: { ...request.input, checkupRef: 'raw-checkup-id' } },
    { ...request, operationId: 'mediflow.other.v1' },
    { ...request, role: 'physician' },
    { ...request, proof: {} },
    { ...request, pin: '0000' },
    { ...request, gesture: {} },
  ];
  for (const value of invalid) assert.throws(() => encodeCheckupStatusTransitionIpcFrameV1(value),
    (error: unknown) => error instanceof CheckupStatusTransitionIpcV1Error && error.code === 'frame_invalid');
  assert.throws(() => decodeCheckupStatusTransitionIpcFrameV1(`{"padding":"${'x'.repeat(5_000)}"}`),
    (error: unknown) => error instanceof CheckupStatusTransitionIpcV1Error && error.code === 'frame_too_large');
});

test('accepts only stable redacted denial codes and canonical byte ordering', () => {
  assert.throws(() => encodeCheckupStatusTransitionIpcFrameV1({
    schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1, type: 'preview_result',
    requestRef: request.requestRef, operationId: OPERATION, outcome: 'denied', denialCode: 'sqlite_detail',
  }), (error: unknown) => error instanceof CheckupStatusTransitionIpcV1Error && error.code === 'frame_invalid');
  const encoded = encodeCheckupStatusTransitionIpcFrameV1(request);
  assert.throws(() => decodeCheckupStatusTransitionIpcFrameV1(encoded.replace(
    '"schemaVersion":"mediflow', '"type":"preview","schemaVersion":"mediflow').replace(
    ',"type":"preview"', '')),
  (error: unknown) => error instanceof CheckupStatusTransitionIpcV1Error && error.code === 'frame_invalid');
});
