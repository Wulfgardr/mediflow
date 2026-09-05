/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { types } from 'node:util';

import {
  PORTABLE_SUPERVISOR_WEB_IPC_MAX_FRAME_BYTES_V1,
  PortableSupervisorWebIpcV1Error,
  decodePortableSupervisorWebIpcFrameV1,
  encodePortableSupervisorWebIpcFrameV1,
} from './portable-supervisor-web-ipc-contract.ts';

const SCHEMA = 'mediflow.portable-supervisor.web-ipc.v1';
const REQUEST = `pswr_${'1'.repeat(32)}`;
const CHALLENGE = `pswc_${'2'.repeat(64)}`;

const capture = () => ({
  schemaVersion: 'mediflow.portable-supervisor.web-capture.v1',
  userRef: `user.${'3'.repeat(64)}`,
  parentRef: `parent.${'4'.repeat(64)}`,
  patientId: 'patient.synthetic.01',
  ambulatoryId: 'ambulatory.synthetic.01',
  selectionEpoch: 7,
  expectedPatientVersion: 3,
  expiresAt: 10_000,
});

const frames = () => [
  { schemaVersion: SCHEMA, method: 'prepare', requestRef: REQUEST },
  { schemaVersion: SCHEMA, method: 'activate', requestRef: REQUEST, challenge: CHALLENGE, capture: capture() },
  { schemaVersion: SCHEMA, method: 'revoke_all', requestRef: REQUEST, reason: 'application_lock' },
  { schemaVersion: SCHEMA, method: 'ack', requestRef: REQUEST, outcome: 'prepared', challenge: CHALLENGE,
    expiresAt: 5_000 },
  { schemaVersion: SCHEMA, method: 'ack', requestRef: REQUEST, outcome: 'activated', expiresAt: 10_000 },
  { schemaVersion: SCHEMA, method: 'ack', requestRef: REQUEST, outcome: 'revoked' },
  { schemaVersion: SCHEMA, method: 'ack', requestRef: REQUEST, outcome: 'denied', denialCode: 'challenge_invalid' },
];

const rejects = (code: 'frame_invalid' | 'frame_too_large') => (error: unknown) =>
  error instanceof PortableSupervisorWebIpcV1Error && error.code === code;

test('round-trips every closed request and ack as canonical deeply frozen records', () => {
  for (const input of frames()) {
    const encoded = encodePortableSupervisorWebIpcFrameV1(input);
    const decoded = decodePortableSupervisorWebIpcFrameV1(encoded);
    assert.equal(encodePortableSupervisorWebIpcFrameV1(decoded), encoded);
    assert.equal(Object.getPrototypeOf(decoded), null);
    assert.equal(Object.isFrozen(decoded), true);
    if ('capture' in decoded) {
      assert.equal(Object.getPrototypeOf(decoded.capture), null);
      assert.equal(Object.isFrozen(decoded.capture), true);
    }
  }
});

test('requires canonical byte form and rejects whitespace, reordered and duplicate keys', () => {
  const canonical = encodePortableSupervisorWebIpcFrameV1(frames()[0]);
  assert.throws(() => decodePortableSupervisorWebIpcFrameV1(` ${canonical}`), rejects('frame_invalid'));
  assert.throws(() => decodePortableSupervisorWebIpcFrameV1(
    `{"method":"prepare","schemaVersion":"${SCHEMA}","requestRef":"${REQUEST}"}`,
  ), rejects('frame_invalid'));
  assert.throws(() => decodePortableSupervisorWebIpcFrameV1(
    `{"schemaVersion":"${SCHEMA}","method":"prepare","method":"prepare","requestRef":"${REQUEST}"}`,
  ), rejects('frame_invalid'));
});

test('rejects oversized or non-string transport frames before parsing', () => {
  assert.throws(() => decodePortableSupervisorWebIpcFrameV1('x'.repeat(
    PORTABLE_SUPERVISOR_WEB_IPC_MAX_FRAME_BYTES_V1 + 1,
  )), rejects('frame_too_large'));
  for (const input of [null, {}, new Uint8Array(), 1, true]) {
    assert.throws(() => decodePortableSupervisorWebIpcFrameV1(input), rejects('frame_invalid'));
  }
});

test('rejects extra, missing, inherited, accessor, symbol, proxy and Promise input without reading traps', () => {
  const valid = frames()[0];
  for (const input of [
    { ...valid, extra: true },
    { schemaVersion: SCHEMA, method: 'prepare' },
    Object.assign(Object.create({ inherited: true }), valid),
    Object.defineProperty({ schemaVersion: SCHEMA, method: 'prepare' }, 'requestRef', {
      enumerable: true, get: () => { throw new Error('must not run'); },
    }),
    Object.assign({ ...valid }, { [Symbol('hidden')]: true }),
    Promise.resolve(valid),
  ]) assert.throws(() => encodePortableSupervisorWebIpcFrameV1(input), rejects('frame_invalid'));
  let traps = 0;
  const proxy = new Proxy(valid, { ownKeys: () => { traps += 1; throw new Error('must not run'); } });
  assert.equal(types.isProxy(proxy), true);
  assert.throws(() => encodePortableSupervisorWebIpcFrameV1(proxy), rejects('frame_invalid'));
  assert.equal(traps, 0);
});

test('validates request, challenge, capture identifiers, epochs, versions and expiries', () => {
  const activation = frames()[1] as Record<string, unknown>;
  const invalid = [
    { ...activation, requestRef: 'caller-request' },
    { ...activation, challenge: 'caller-challenge' },
    { ...activation, capture: { ...capture(), userRef: `user.${'G'.repeat(64)}` } },
    { ...activation, capture: { ...capture(), parentRef: `parent.${'0'.repeat(63)}` } },
    { ...activation, capture: { ...capture(), patientId: '../medical.db' } },
    { ...activation, capture: { ...capture(), ambulatoryId: ' spaced ' } },
    { ...activation, capture: { ...capture(), selectionEpoch: -1 } },
    { ...activation, capture: { ...capture(), expectedPatientVersion: 0 } },
    { ...activation, capture: { ...capture(), expiresAt: Number.MAX_SAFE_INTEGER + 1 } },
  ];
  for (const input of invalid) {
    assert.throws(() => encodePortableSupervisorWebIpcFrameV1(input), rejects('frame_invalid'));
  }
});

test('keeps revoke reasons and denial codes closed-world', () => {
  assert.throws(() => encodePortableSupervisorWebIpcFrameV1({
    schemaVersion: SCHEMA, method: 'revoke_all', requestRef: REQUEST, reason: 'caller_reason',
  }), rejects('frame_invalid'));
  assert.throws(() => encodePortableSupervisorWebIpcFrameV1({
    schemaVersion: SCHEMA, method: 'ack', requestRef: REQUEST, outcome: 'denied', denialCode: 'raw_database_error',
  }), rejects('frame_invalid'));
});

test('the portable contract contains no Web, database, listener, secret or clinical-content authority', () => {
  const source = readFileSync(new URL('./portable-supervisor-web-ipc-contract.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:next\/headers|server-auth|db-server|\.\.\/schema|listen\s*\(|createServer|cookie|password|pin|proof|permit|clinicalText|noteText)/iu);
  assert.match(source, /MAX_FRAME_BYTES_V1\s*=\s*4\s*\*\s*1024/u);
});
