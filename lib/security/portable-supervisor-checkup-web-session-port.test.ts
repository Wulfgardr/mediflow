/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPortableSupervisorCheckupWebSessionPortV1 } from
  './portable-supervisor-checkup-web-session-port.ts';
import type { PortableSupervisorWebCaptureV1 } from
  '../../packages/aip/src/portable-supervisor-web-ipc-contract.ts';

const NOW = 1_900_000_000_000;
function fixture() {
  let now = NOW;
  let current: PortableSupervisorWebCaptureV1 = Object.freeze({ schemaVersion: 'mediflow.portable-supervisor.web-capture.v1' as const,
    userRef: `user.${'1'.repeat(64)}`, parentRef: `parent.${'2'.repeat(64)}`,
    patientId: 'patient.synthetic.checkup-port', ambulatoryId: 'ambulatory.synthetic.checkup-port',
    selectionEpoch: 3, expectedPatientVersion: 7, expiresAt: NOW + 60_000 });
  let revokes = 0, disposes = 0, reads = 0;
  const owner = Object.freeze({ readCapture() { reads++; return current; }, revoke() { revokes++; return true; },
    dispose() { disposes++; return true; } });
  const processOwner = createPortableSupervisorCheckupWebSessionPortV1({ now: () => now });
  return { ...processOwner, owner, reads: () => reads, revokes: () => revokes, disposes: () => disposes,
    drift(change: Partial<typeof current>) { current = Object.freeze({ ...current, ...change }); },
    advance(milliseconds: number) { now += milliseconds; } };
}

test('publishes one opaque binding only after H1a activation and reads exact capture twice', () => {
  const current = fixture(); let terminal = 0;
  assert.equal(current.port.attach(() => { terminal++; }), null);
  assert.equal(current.controller.activate(current.owner), true);
  const binding = current.port.attach(() => { terminal++; }); assert.ok(binding);
  assert.equal(Object.getPrototypeOf(binding), null); assert.deepEqual(Reflect.ownKeys(binding), []);
  let patient = '';
  assert.equal(current.port.withCurrent(binding, (capture) => { patient = capture.patientId; }), true);
  assert.equal(patient, 'patient.synthetic.checkup-port'); assert.equal(current.reads(), 3);
  assert.equal(current.port.attach(() => undefined), null);
  assert.equal(current.revokes(), 0); assert.equal(current.disposes(), 0); assert.equal(terminal, 0);
});

test('detach and terminal drain never invoke H1a revoke or dispose', () => {
  const current = fixture(); current.controller.activate(current.owner); let terminal = 0;
  const first = current.port.attach(() => { terminal++; }); assert.ok(first);
  assert.equal(current.port.detach(first), true); assert.equal(current.port.detach(first), false);
  const second = current.port.attach(() => { terminal++; }); assert.ok(second);
  assert.equal(current.controller.terminate(), true); assert.equal(current.controller.terminate(), false);
  assert.equal(terminal, 1); assert.equal(current.revokes(), 0); assert.equal(current.disposes(), 0);
  assert.equal(current.port.withCurrent(second, () => undefined), false);
});

test('scope drift, expiry, throw, Promise, and reentry fail closed', () => {
  const drift = fixture(); drift.controller.activate(drift.owner); let terminal = 0, effects = 0;
  const driftBinding = drift.port.attach(() => { terminal++; }); assert.ok(driftBinding);
  assert.equal(drift.port.withCurrent(driftBinding, () => { drift.drift({ selectionEpoch: 4 }); }), false);
  assert.equal(terminal, 1); assert.equal(drift.port.withCurrent(driftBinding, () => { effects++; }), false);

  const expired = fixture(); expired.controller.activate(expired.owner); let expiredTerminal = 0;
  const expiredBinding = expired.port.attach(() => { expiredTerminal++; }); assert.ok(expiredBinding);
  expired.advance(60_001);
  assert.equal(expired.port.withCurrent(expiredBinding, () => { effects++; }), false);
  assert.equal(expiredTerminal, 1);

  for (const operation of [() => { throw new Error('synthetic'); }, () => Promise.resolve()] as const) {
    const current = fixture(); current.controller.activate(current.owner); let drained = 0;
    const binding = current.port.attach(() => { drained++; }); assert.ok(binding);
    assert.equal(current.port.withCurrent(binding, operation), false); assert.equal(drained, 1);
  }

  const nested = fixture(); nested.controller.activate(nested.owner); let inner = true;
  const binding = nested.port.attach(() => undefined); assert.ok(binding);
  assert.equal(nested.port.withCurrent(binding, () => {
    inner = nested.port.withCurrent(binding, () => { effects++; });
  }), false);
  assert.equal(inner, false); assert.equal(effects, 0);
});
