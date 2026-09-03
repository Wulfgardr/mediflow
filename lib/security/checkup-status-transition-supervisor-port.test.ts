/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeCheckupStatusTransitionIpcFrameV1, encodeCheckupStatusTransitionIpcFrameV1 } from
  '../../packages/aip/src/checkup-status-transition-ipc.ts';
import { createCheckupStatusTransitionSupervisorPortV1 } from
  './checkup-status-transition-supervisor-port.ts';

const OPERATION = 'mediflow.patient.checkup.status.transition.v1';
const INPUT = { schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1', operationId: OPERATION,
  checkupRef: `hcsr_${'b'.repeat(64)}`, targetStatus: 'completed', expectedRevision: 1 };

function fixture() {
  const sent: string[] = [], terminals: string[] = [], timers: Array<() => void> = [];
  let sendError: Error | null = null;
  const port = createCheckupStatusTransitionSupervisorPortV1({
    randomBytes: () => Buffer.alloc(16, 0x0a),
    sendWeb: (frame, done) => { sent.push(frame); done(sendError); },
    schedule: (_delay, callback) => { timers.push(callback); return () => undefined; },
    onTerminal: (reason) => { terminals.push(reason); },
  });
  return { port, sent, terminals, timers, setSendError: (value: Error) => { sendError = value; } };
}

test('correlates one proposed Web preview without exposing authority payload', async () => {
  const current = fixture(), pending = current.port.preview(INPUT);
  const request = decodeCheckupStatusTransitionIpcFrameV1(current.sent[0]);
  assert.deepEqual({ ...(request.input as Record<string, unknown>) }, INPUT);
  assert.equal(JSON.stringify(request).includes('pin'), false);
  const response = encodeCheckupStatusTransitionIpcFrameV1({ schemaVersion: 'mediflow.checkup-status.ipc.v1',
    type: 'preview_result', requestRef: request.requestRef, operationId: OPERATION, outcome: 'proposed',
    proposalRef: `hcsp_${'c'.repeat(64)}`, expiresAt: 1_900_000_000_000 });
  assert.equal(current.port.acceptWebFrame(response), true);
  assert.deepEqual(await pending, decodeCheckupStatusTransitionIpcFrameV1(response));
  assert.deepEqual(current.terminals, []); current.port.close();
});

test('terminalizes timeout, send failure, wrong correlation, and Web death', async () => {
  const timeout = fixture(), pendingTimeout = timeout.port.preview(INPUT);
  timeout.timers[0]();
  await assert.rejects(pendingTimeout, /preview_unavailable/u);
  assert.deepEqual(timeout.terminals, ['timeout']);

  const send = fixture(); send.setSendError(new Error('cut'));
  await assert.rejects(send.port.preview(INPUT), /preview_unavailable/u);
  assert.deepEqual(send.terminals, ['web_disconnect']);

  const wrong = fixture(), pendingWrong = wrong.port.preview(INPUT);
  const response = encodeCheckupStatusTransitionIpcFrameV1({ schemaVersion: 'mediflow.checkup-status.ipc.v1',
    type: 'preview_result', requestRef: `hcqr_${'d'.repeat(32)}`, operationId: OPERATION,
    outcome: 'denied', denialCode: 'resource_unavailable' });
  assert.equal(wrong.port.acceptWebFrame(response), true);
  await assert.rejects(pendingWrong, /preview_unavailable/u);
  assert.deepEqual(wrong.terminals, ['protocol_invalid']);

  const dead = fixture(), pendingDead = dead.port.preview(INPUT); dead.port.close('web_disconnect');
  await assert.rejects(pendingDead, /preview_unavailable/u);
  assert.deepEqual(dead.terminals, ['web_disconnect']);
});
