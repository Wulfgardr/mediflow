/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  decodePortableSupervisorWebIpcFrameV1,
  encodePortableSupervisorWebIpcFrameV1,
} from './portable-supervisor-web-ipc-contract.ts';
import {
  PortableSupervisorWebControlV1Error,
  createPortableSupervisorWebControlV1,
} from './portable-supervisor-web-control.ts';

const SCHEMA = 'mediflow.portable-supervisor.web-ipc.v1';
const REQUEST = `pswr_${'1'.repeat(32)}`;
const CHALLENGE = `pswc_${'2'.repeat(64)}`;
const capture = () => ({ schemaVersion: 'mediflow.portable-supervisor.web-capture.v1',
  userRef: `user.${'3'.repeat(64)}`, parentRef: `parent.${'4'.repeat(64)}`,
  patientId: 'patient.synthetic.control.01', ambulatoryId: 'ambulatory.synthetic.control.01',
  selectionEpoch: 7, expectedPatientVersion: 3, expiresAt: 20_000 });
const request = (value: Record<string, unknown>) => encodePortableSupervisorWebIpcFrameV1({
  schemaVersion: SCHEMA, requestRef: REQUEST, ...value,
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(options: { activate?: (value: unknown) => unknown; revoke?: (reason: string) => unknown;
  challenge?: () => unknown; now?: () => unknown } = {}) {
  let now = 1_000;
  const activations: unknown[] = [], revocations: string[] = [];
  const control = createPortableSupervisorWebControlV1({
    now: options.now ?? (() => now),
    nextChallenge: options.challenge ?? (() => CHALLENGE),
    activate: options.activate ?? ((value: unknown) => {
      activations.push(value); return Promise.resolve(Object.freeze({ expiresAt: 20_000 }));
    }),
    revoke: options.revoke ?? ((reason: string) => { revocations.push(reason); }),
  });
  return { control, activations, revocations, setNow: (value: number) => { now = value; } };
}

const parsed = async (value: Promise<string>) => decodePortableSupervisorWebIpcFrameV1(await value);
const rejects = (code: 'protocol_invalid') => (error: unknown) =>
  error instanceof PortableSupervisorWebControlV1Error && error.code === code;

test('mints one five-second challenge tied to the request and denies a second prepare', async () => {
  const current = fixture();
  const prepared = await parsed(current.control.handle(request({ method: 'prepare' })));
  assert.deepEqual({ ...prepared }, { schemaVersion: SCHEMA, method: 'ack', requestRef: REQUEST,
    outcome: 'prepared', challenge: CHALLENGE, expiresAt: 6_000 });
  const replay = await parsed(current.control.handle(request({ method: 'prepare' })));
  assert.equal(replay.outcome, 'denied'); assert.equal(replay.denialCode, 'replayed');
  assert.deepEqual(current.revocations, []);
});

test('consumes wrong or expired challenge attempts and terminalizes authority', async () => {
  for (const mode of ['wrong', 'expired'] as const) {
    const current = fixture();
    await current.control.handle(request({ method: 'prepare' }));
    if (mode === 'expired') current.setNow(6_000);
    const denied = await parsed(current.control.handle(request({ method: 'activate',
      challenge: mode === 'wrong' ? `pswc_${'9'.repeat(64)}` : CHALLENGE, capture: capture() })));
    assert.equal(denied.outcome, 'denied');
    assert.equal(denied.denialCode, mode === 'wrong' ? 'challenge_invalid' : 'challenge_expired');
    assert.deepEqual(current.revocations, ['explicit']);
    const after = await parsed(current.control.handle(request({ method: 'prepare' })));
    assert.equal(after.denialCode, 'host_unavailable');
  }
});

test('ACKs activation only after the async host bind succeeds with a canonical capture', async () => {
  const pending = deferred<Readonly<{ expiresAt: number }>>();
  let received: unknown = null;
  const current = fixture({ activate: (value) => { received = value; return pending.promise; } });
  await current.control.handle(request({ method: 'prepare' }));
  let settled = false;
  const activation = current.control.handle(request({ method: 'activate', challenge: CHALLENGE, capture: capture() }))
    .then((value) => { settled = true; return value; });
  await Promise.resolve(); assert.equal(settled, false);
  assert.equal(Object.getPrototypeOf(received), null); assert.equal(Object.isFrozen(received), true);
  pending.resolve(Object.freeze({ expiresAt: 19_000 }));
  const activated = decodePortableSupervisorWebIpcFrameV1(await activation);
  assert.equal(activated.outcome, 'activated'); assert.equal(activated.expiresAt, 19_000);
});

test('concurrent external termination prevents a late activation ACK', async () => {
  const pending = deferred<Readonly<{ expiresAt: number }>>();
  const current = fixture({ activate: () => pending.promise });
  await current.control.handle(request({ method: 'prepare' }));
  const activation = current.control.handle(request({ method: 'activate', challenge: CHALLENGE, capture: capture() }));
  assert.equal(await current.control.terminate('mcp_disconnect'), true);
  pending.resolve(Object.freeze({ expiresAt: 19_000 }));
  const denied = await parsed(activation);
  assert.equal(denied.outcome, 'denied'); assert.equal(denied.denialCode, 'activation_failed');
  assert.deepEqual(current.revocations, ['mcp_disconnect']);
});

test('consumes the challenge before a reentrant clock can start a sibling activation', async () => {
  const holder: { control?: ReturnType<typeof createPortableSupervisorWebControlV1> } = {};
  let clockCalls = 0, nested: Promise<string> | null = null;
  const current = fixture({ now: () => {
    clockCalls += 1;
    if (clockCalls === 2) nested = holder.control?.handle(request({ method: 'activate',
      challenge: CHALLENGE, capture: capture() })) ?? null;
    return 1_000;
  } });
  holder.control = current.control;
  await current.control.handle(request({ method: 'prepare' }));
  const activated = await parsed(current.control.handle(request({ method: 'activate',
    challenge: CHALLENGE, capture: capture() })));
  assert.equal(activated.outcome, 'activated');
  assert.ok(nested);
  const sibling = decodePortableSupervisorWebIpcFrameV1(await nested);
  assert.equal(sibling.outcome, 'denied'); assert.equal(sibling.denialCode, 'already_bound');
  assert.equal(current.activations.length, 1);
});

test('activation failure, non-native completion or invalid expiry revoke and deny', async () => {
  for (const result of [Promise.reject(new Error('synthetic bind')), { then: () => undefined },
    Promise.resolve(Object.freeze({ expiresAt: 20_001 }))]) {
    const current = fixture({ activate: () => result });
    await current.control.handle(request({ method: 'prepare' }));
    const denied = await parsed(current.control.handle(request({ method: 'activate',
      challenge: CHALLENGE, capture: capture() })));
    assert.equal(denied.outcome, 'denied'); assert.equal(denied.denialCode, 'activation_failed');
    assert.deepEqual(current.revocations, ['explicit']);
  }
});

test('revoke_all terminalizes once and reports cleanup failure without reviving', async () => {
  const current = fixture();
  const revoked = await parsed(current.control.handle(request({ method: 'revoke_all', reason: 'application_lock' })));
  assert.equal(revoked.outcome, 'revoked'); assert.deepEqual(current.revocations, ['application_lock']);
  assert.equal(await current.control.terminate('explicit'), false);

  const failed = fixture({ revoke: () => Promise.reject(new Error('synthetic revoke')) });
  const denial = await parsed(failed.control.handle(request({ method: 'revoke_all', reason: 'reselection' })));
  assert.equal(denial.outcome, 'denied'); assert.equal(denial.denialCode, 'revoke_failed');
  assert.equal(await failed.control.terminate('explicit'), false);
});

test('malformed or noncanonical input throws protocol_invalid and terminalizes once', async () => {
  for (const input of [' {"bad":true}', {}, Promise.resolve('frame')]) {
    const current = fixture();
    await assert.rejects(current.control.handle(input), rejects('protocol_invalid'));
    assert.deepEqual(current.revocations, ['explicit']);
  }
});

test('control remains portable and owns no child, Web, database, listener or log authority', () => {
  const source = readFileSync(new URL('./portable-supervisor-web-control.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:child_process|next\/|server-auth|db-server|sqlite|net|http|listen\s*\(|process\.|console\.|cookie|password|pin)/iu);
  assert.match(source, /PREPARE_TTL_MS\s*=\s*5_000/u);
});
