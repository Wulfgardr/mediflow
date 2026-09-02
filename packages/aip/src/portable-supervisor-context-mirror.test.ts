/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  decodePortableSupervisorWebIpcFrameV1,
  encodePortableSupervisorWebIpcFrameV1,
} from './portable-supervisor-web-ipc-contract.ts';
import {
  PortableSupervisorContextMirrorV1Error,
  createPortableSupervisorContextMirrorV1,
} from './portable-supervisor-context-mirror.ts';

const capture = (overrides: Record<string, unknown> = {}) => {
  const frame = decodePortableSupervisorWebIpcFrameV1(encodePortableSupervisorWebIpcFrameV1({
    schemaVersion: 'mediflow.portable-supervisor.web-ipc.v1', method: 'activate',
    requestRef: `pswr_${'1'.repeat(32)}`, challenge: `pswc_${'2'.repeat(64)}`,
    capture: { schemaVersion: 'mediflow.portable-supervisor.web-capture.v1',
      userRef: `user.${'3'.repeat(64)}`, parentRef: `parent.${'4'.repeat(64)}`,
      patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01',
      selectionEpoch: 7, expectedPatientVersion: 3, expiresAt: 20_000, ...overrides },
  }));
  return frame.capture;
};

function fixture(options: { version?: () => unknown; hash?: (value: string) => unknown;
  schedule?: (delay: number, callback: () => void) => unknown; onTerminal?: (reason: string) => unknown } = {}) {
  let now = 1_000;
  const events: string[] = [];
  const timers: Array<{ delay: number; callback: () => void; cancelled: boolean }> = [];
  const mirror = createPortableSupervisorContextMirrorV1({
    now: () => now,
    hashRef: options.hash ?? ((value: string) => `sha256:${value.includes('\0user.') ? 'a' : 'b'}`.padEnd(71, value.includes('\0user.') ? 'a' : 'b')),
    readPatientVersion: options.version ?? (() => 3),
    schedule: options.schedule ?? ((delay: number, callback: () => void) => {
      const timer = { delay, callback, cancelled: false }; timers.push(timer);
      return () => { timer.cancelled = true; };
    }),
    onTerminal: options.onTerminal ?? ((reason: string) => { events.push(reason); }),
  });
  return { mirror, events, timers, setNow: (value: number) => { now = value; } };
}

const rejects = (code: 'input_invalid' | 'context_unavailable' | 'already_bound') => (error: unknown) =>
  error instanceof PortableSupervisorContextMirrorV1Error && error.code === code;

test('mints one Supervisor-owned synchronous context from a canonical Web capture', () => {
  const current = fixture();
  assert.equal(current.mirror.activate(capture()), true);
  const context = current.mirror.readHostContext();
  assert.deepEqual({ ...context }, {
    status: 'available', userRef: `user.${'a'.repeat(64)}`, parentRef: `parent.${'b'.repeat(64)}`,
    purposeCode: 'care_coordination', patientId: 'patient.synthetic.01',
    ambulatoryId: 'ambulatory.synthetic.01', generation: 1, revocationGeneration: 0,
    selectionEpoch: 7, restartGeneration: 1, parentGeneration: 1, policyGeneration: 1,
    expiresAt: 20_000, bootstrapExpiresAt: 6_000,
  });
  assert.equal(Object.getPrototypeOf(context), null);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(current.timers[0]?.delay, 19_000);
});

test('rejects raw, extended, accessor, proxy and Promise captures before currentness sources', () => {
  let versions = 0;
  const current = fixture({ version: () => { versions += 1; return 3; } });
  const raw = { schemaVersion: 'mediflow.portable-supervisor.web-capture.v1' };
  for (const input of [raw, { ...(capture() as Record<string, unknown>), extra: true }, Promise.resolve(capture()),
    new Proxy(capture() as object, { ownKeys: () => { throw new Error('must not run'); } })]) {
    assert.throws(() => current.mirror.activate(input), rejects('input_invalid'));
  }
  assert.equal(versions, 0);
});

test('allows only one binding for the lifetime even after explicit revoke', () => {
  const current = fixture();
  assert.equal(current.mirror.activate(capture()), true);
  assert.throws(() => current.mirror.activate(capture()), rejects('already_bound'));
  assert.equal(current.mirror.revoke(), true);
  assert.equal(current.mirror.revoke(), false);
  assert.throws(() => current.mirror.activate(capture()), rejects('already_bound'));
  assert.throws(() => current.mirror.readHostContext(), rejects('context_unavailable'));
  assert.deepEqual(current.events, ['revoked']);
  assert.equal(current.timers[0]?.cancelled, true);
});

test('patient-version drift terminalizes before publishing another context', () => {
  let version = 3;
  const current = fixture({ version: () => version });
  current.mirror.activate(capture());
  current.mirror.readHostContext();
  version = 4;
  assert.throws(() => current.mirror.readHostContext(), rejects('context_unavailable'));
  assert.deepEqual(current.events, ['currentness_denied']);
  assert.equal(current.timers[0]?.cancelled, true);
});

test('expiry timer and independent clock fence terminalize exactly once', () => {
  const scheduled = fixture();
  scheduled.mirror.activate(capture({ expiresAt: 1_500 }));
  scheduled.timers[0]?.callback();
  scheduled.timers[0]?.callback();
  assert.deepEqual(scheduled.events, ['expired']);
  assert.throws(() => scheduled.mirror.readHostContext(), rejects('context_unavailable'));

  const fenced = fixture(); fenced.mirror.activate(capture({ expiresAt: 1_500 })); fenced.setNow(1_499);
  assert.throws(() => fenced.mirror.readHostContext(), rejects('context_unavailable'));
  assert.deepEqual(fenced.events, ['expired']);
});

test('restart is terminal, increments its private generation and never permits rebinding', () => {
  const current = fixture(); current.mirror.activate(capture());
  assert.equal(current.mirror.restart(), true);
  assert.deepEqual(current.events, ['restarted']);
  assert.throws(() => current.mirror.activate(capture()), rejects('already_bound'));
});

test('fails closed on clock, hash, version and scheduler dependency failures', () => {
  assert.throws(() => fixture({ hash: () => 'caller-hash' }).mirror.activate(capture()), rejects('context_unavailable'));
  assert.throws(() => fixture({ version: () => Promise.resolve(3) }).mirror.activate(capture()), rejects('context_unavailable'));
  assert.throws(() => fixture({ schedule: () => Promise.resolve(() => {}) }).mirror.activate(capture()), rejects('context_unavailable'));
  const rollback = fixture(); rollback.setNow(-1);
  assert.throws(() => rollback.mirror.activate(capture()), rejects('context_unavailable'));
});

test('synchronous scheduler reentry and terminal notification failure cannot publish or revive authority', () => {
  const reentrant = fixture({ schedule: (_delay, callback) => { callback(); return () => undefined; } });
  assert.throws(() => reentrant.mirror.activate(capture()), rejects('context_unavailable'));
  const notification = fixture({ onTerminal: () => { throw new Error('synthetic terminal observer'); } });
  notification.mirror.activate(capture());
  assert.equal(notification.mirror.dispose(), true);
  assert.throws(() => notification.mirror.readHostContext(), rejects('context_unavailable'));
});

test('the mirror stays portable and contains no Web, database, transport or listener authority', () => {
  const source = readFileSync(new URL('./portable-supervisor-context-mirror.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:next\/headers|server-auth|db-server|\.\.\/schema|child_process|net|http|listen\s*\(|cookie|password|pin|proof|permit)/iu);
});
