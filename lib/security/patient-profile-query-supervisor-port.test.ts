import assert from 'node:assert/strict';
import test from 'node:test';
import { createPatientProfileQuerySupervisorPortV1 } from './patient-profile-query-supervisor-port.ts';
import { decodePatientProfileQueryIpcFrameV1, encodePatientProfileQueryIpcFrameV1 } from '../../packages/aip/src/patient-profile-query-ipc.ts';
const input = { kind: 'open', contractVersion: 1, projection: 'notes', expectedSelectionEpoch: 2 } as const;
function fixture() {
  const sent: string[] = [], terminals: string[] = [], timers: Array<() => void> = [];
  let nonce = 0;
  const port = createPatientProfileQuerySupervisorPortV1({ randomBytes: size => Buffer.alloc(size, ++nonce),
    sendWeb: (frame, done) => { sent.push(frame); done(null); },
    schedule: (_ms, callback) => { timers.push(callback); return () => undefined; },
    onTerminal: reason => { terminals.push(reason); } });
  const denied = (requestRef: unknown) => encodePatientProfileQueryIpcFrameV1({
    schemaVersion: 'mediflow.patient-profile.ipc.v1', type: 'query_result', requestRef,
    operationId: 'patient-profile.read.v1', outcome: 'denied', denialCode: 'output_too_large' });
  return { port, sent, terminals, timers, denied };
}
test('correlates typed denials and rejects replayed results without resolving another request', async () => {
  const f = fixture(); const pending = f.port.executeProfileQuery(input);
  const request = decodePatientProfileQueryIpcFrameV1(f.sent[0]);
  const wire = f.denied(request.requestRef); assert.equal(f.port.acceptWebFrame(wire), true);
  await assert.rejects(pending, (e: unknown) => (e as { code: string }).code === 'output_too_large');
  const second = f.port.executeProfileQuery(input);
  f.port.acceptWebFrame(wire);
  await assert.rejects(second); assert.deepEqual(f.terminals, ['protocol_invalid']);
});
test('terminalizes cancellation, timeout, wrong request references and disconnect', async () => {
  for (const mode of ['abort', 'timeout', 'wrong', 'disconnect'] as const) {
    const f = fixture(), controller = new AbortController();
    const pending = f.port.executeProfileQuery(input, controller.signal);
    if (mode === 'abort') controller.abort();
    if (mode === 'timeout') f.timers[0]!();
    if (mode === 'wrong') f.port.acceptWebFrame(f.denied(`ppqr_${'a'.repeat(32)}`));
    if (mode === 'disconnect') f.port.close('web_disconnect');
    await assert.rejects(pending);
    assert.equal(f.terminals.length, 1); assert.equal(f.port.acceptWebFrame('unrelated'), false);
  }
});
