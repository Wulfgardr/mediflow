/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encodeCheckupStatusTransitionIpcFrameV1 } from
  '../../packages/aip/src/checkup-status-transition-ipc.ts';
import { createCheckupStatusTransitionWebParentChannelV1 } from
  './checkup-status-transition-web-parent-channel.ts';

const OPERATION = 'mediflow.patient.checkup.status.transition.v1';
const request = encodeCheckupStatusTransitionIpcFrameV1({
  schemaVersion: 'mediflow.checkup-status.ipc.v1', type: 'preview',
  requestRef: `hcqr_${'a'.repeat(32)}`, operationId: OPERATION,
  input: { schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1', operationId: OPERATION,
    checkupRef: `hcsr_${'b'.repeat(64)}`, targetStatus: 'completed', expectedRevision: 1 },
});
const result = encodeCheckupStatusTransitionIpcFrameV1({
  schemaVersion: 'mediflow.checkup-status.ipc.v1', type: 'preview_result',
  requestRef: `hcqr_${'a'.repeat(32)}`, operationId: OPERATION, outcome: 'proposed',
  proposalRef: `hcsp_${'c'.repeat(64)}`, expiresAt: 1_900_000_000_000,
});

function fixture(handle = async () => result) {
  let message: ((value: unknown) => void) | null = null, disconnect: (() => void) | null = null;
  let connected = true, releaseSend: (() => void) | null = null;
  const sent: string[] = [], terminal: string[] = [];
  const channel = createCheckupStatusTransitionWebParentChannelV1({
    connected: () => connected,
    send: (frame, done) => { sent.push(frame); releaseSend = () => done(null); },
    onMessage: (listener) => { message = listener; }, offMessage: () => { message = null; },
    onDisconnect: (listener) => { disconnect = listener; }, offDisconnect: () => { disconnect = null; },
    handlePreview: handle, onTerminal: (reason) => { terminal.push(reason); },
  });
  return { channel, sent, terminal, emit: (value: unknown) => message?.(value),
    disconnect: () => { connected = false; disconnect?.(); }, release: () => releaseSend?.() };
}

test('accepts only the exact parent checkup channel and ignores H1a traffic', async () => {
  const current = fixture();
  current.emit('{"schemaVersion":"mediflow.portable-supervisor.web-ipc.v1"}');
  current.emit(request);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(current.sent, [result]); assert.deepEqual(current.terminal, []);
  current.release(); current.channel.dispose();
});

test('terminalizes malformed, concurrent, send-failed, and disconnected checkup channels', async () => {
  let release!: (value: string) => void;
  const delayed = new Promise<string>((resolve) => { release = resolve; });
  const concurrent = fixture(() => delayed);
  concurrent.emit(request); concurrent.emit(request);
  assert.deepEqual(concurrent.terminal, ['protocol_invalid']);
  release(result); await new Promise((resolve) => setImmediate(resolve));

  const malformed = fixture();
  malformed.emit('{"schemaVersion":"mediflow.checkup-status.ipc.v1","type":"preview"}');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(malformed.terminal, ['protocol_invalid']);

  const cut = fixture(); cut.disconnect();
  assert.deepEqual(cut.terminal, ['parent_disconnect']);
  assert.equal(cut.channel.dispose(), false, 'terminalization is one-shot');
});
