/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { createHeadlessCheckupActiveRoleSessionGrantOwner,
  HeadlessCheckupActiveRoleSessionGrantError } from './headless-checkup-active-role-session-grant.ts';

const ACTOR = 'synthetic-checkup-grant-actor', NOW = 1_900_000_000_000;
const TTL = 8 * 60 * 60 * 1_000;
function record<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), value));
}
function fixture() {
  const state = { now: NOW, patientId: 'synthetic-patient-a', ambulatoryId: 'synthetic-ambulatory-a',
    epoch: 4, terminal: 0, unregister: 0, cancel: 0, registrationDispose: null as (() => void) | null,
    expiryDispose: null as (() => void) | null, attestationReads: 0 };
  const session = record({ id: 'a'.repeat(64), userId: ACTOR, username: 'synthetic-checkup-admin',
    role: 'admin', authChannel: 'web', createdAt: NOW - 2_000, expiresAt: NOW + TTL + 10_000 });
  let currentSession: unknown = session;
  let currentAttestation: unknown = activeAttestation();
  const owner = Object.freeze({
    withLeaseCriticalSection(candidate: unknown, operation: (selection: unknown) => unknown) {
      if (candidate !== currentSession) throw new Error('session unavailable');
      return operation({ patientId: state.patientId, ambulatoryId: state.ambulatoryId });
    },
    snapshotSelectionEpoch(candidate: unknown) {
      if (candidate !== currentSession) throw new Error('session unavailable');
      return state.epoch;
    },
  });
  const context = record({ session, owner });
  const grantOwner = createHeadlessCheckupActiveRoleSessionGrantOwner({
    now: () => state.now,
    readSession: () => currentSession,
    readAttestation: () => { state.attestationReads++; return currentAttestation; },
    registerSessionResource: (_sessionRef, dispose) => {
      state.registrationDispose = dispose; return () => { state.unregister++; state.registrationDispose = null; };
    },
    schedule: (_delay, dispose) => {
      state.expiryDispose = dispose; return () => { state.cancel++; state.expiryDispose = null; };
    },
  });
  return { state, session, owner, context, grantOwner,
    setSession(value: unknown) { currentSession = value; },
    setAttestation(value: unknown) { currentAttestation = value; } };
}
function activeAttestation(change: Record<string, unknown> = {}): unknown {
  return record({ attestationRef: `hcar_${'b'.repeat(32)}`, actorRef: ACTOR,
    schemaVersion: 'mediflow.headless-checkup-active-role-attestation.v1', role: 'physician',
    operationId: 'mediflow.patient.checkup.status.transition.v1', policyVersion: 'physician_confirmed_single_use.v1',
    status: 'active', attestationVersion: 1, issuerRef: `hcari_${'c'.repeat(32)}`,
    activatedAt: new Date(NOW - 1_000), expiresAt: new Date(NOW - 1_000 + TTL),
    revocationGeneration: 0, revokedAt: null, createdAt: new Date(NOW - 2_000),
    updatedAt: new Date(NOW - 1_000), ...change });
}
function hasCode(code: string) {
  return (error: unknown) => error instanceof HeadlessCheckupActiveRoleSessionGrantError
    && error.code === code && !error.message.includes(ACTOR);
}

test('issues an opaque checkup-only grant after stable session, attestation, and selection reads', () => {
  const current = fixture();
  const grant = current.grantOwner.issue(current.context, () => { current.state.terminal++; });
  assert.equal(Object.getPrototypeOf(grant), null); assert.equal(Object.isFrozen(grant), true);
  assert.deepEqual(Reflect.ownKeys(grant), []); assert.equal(JSON.stringify(grant), '{}');
  const scope = current.grantOwner.withCurrent(grant, () => ({ patientId: current.state.patientId,
    ambulatoryId: current.state.ambulatoryId, role: 'physician' }));
  assert.deepEqual(scope, { patientId: 'synthetic-patient-a', ambulatoryId: 'synthetic-ambulatory-a',
    role: 'physician' });
  assert.ok(current.state.attestationReads >= 6);
  assert.equal(current.grantOwner.withCurrentRequest(grant, current.context, () => 'current'), 'current');
});

test('rejects inactive, revoked, expired, wrong-operation, or ineligible session authority', () => {
  for (const [value, code] of [[activeAttestation({ status: 'inactive', issuerRef: null, activatedAt: null,
    expiresAt: null }), 'attestation_inactive'], [activeAttestation({ status: 'revoked',
    revocationGeneration: 1, revokedAt: new Date(NOW) }), 'attestation_revoked'],
  [activeAttestation({ expiresAt: new Date(NOW) }), 'attestation_unavailable'],
  [activeAttestation({ operationId: 'mediflow.other.v1' }), 'attestation_unavailable']] as const) {
    const current = fixture(); current.setAttestation(value);
    assert.throws(() => current.grantOwner.issue(current.context, () => undefined), hasCode(code));
  }
  const current = fixture();
  const foreign = record({ ...current.session, role: 'viewer' }); current.setSession(foreign);
  const foreignContext = record({ session: foreign, owner: current.owner });
  assert.throws(() => current.grantOwner.issue(foreignContext, () => undefined), hasCode('session_unavailable'));
});

test('terminalizes grant on logout, attestation revocation, reselection, expiry, and replay', () => {
  const cases: Array<(current: ReturnType<typeof fixture>) => void> = [
    (current) => current.state.registrationDispose?.(),
    (current) => current.setAttestation(activeAttestation({ status: 'revoked', revocationGeneration: 1,
      revokedAt: new Date(NOW) })),
    (current) => { current.state.epoch += 1; },
    (current) => { current.state.now = NOW + TTL; },
  ];
  for (const mutate of cases) {
    const current = fixture(), grant = current.grantOwner.issue(current.context, () => { current.state.terminal++; });
    mutate(current);
    assert.throws(() => current.grantOwner.withCurrent(grant, () => 'forbidden'),
      (error: unknown) => error instanceof HeadlessCheckupActiveRoleSessionGrantError);
    assert.equal(current.state.terminal, 1);
    assert.throws(() => current.grantOwner.withCurrent(grant, () => 'replay'), hasCode('grant_unavailable'));
  }
});

test('double-read drift and wrong request context publish no usable grant', () => {
  const drift = fixture(); let read = 0;
  const driftOwner = createHeadlessCheckupActiveRoleSessionGrantOwner({
    now: () => NOW, readSession: () => drift.session,
    readAttestation: () => ++read === 1 ? activeAttestation() : activeAttestation({ issuerRef: `hcari_${'d'.repeat(32)}` }),
    registerSessionResource: () => () => undefined, schedule: () => () => undefined,
  });
  assert.throws(() => driftOwner.issue(drift.context, () => undefined), hasCode('projection_stale'));

  const current = fixture(), grant = current.grantOwner.issue(current.context, () => { current.state.terminal++; });
  const otherSession = record({ ...current.session, id: 'e'.repeat(64) });
  const foreign = record({ session: otherSession, owner: current.owner });
  assert.throws(() => current.grantOwner.withCurrentRequest(grant, foreign, () => 'forbidden'),
    hasCode('projection_stale'));
  assert.equal(current.state.terminal, 1);
});

test('synchronous registration retirement and async callbacks fail closed', () => {
  const current = fixture(); let calls = 0;
  const raced = createHeadlessCheckupActiveRoleSessionGrantOwner({
    now: () => NOW, readSession: () => current.session, readAttestation: () => activeAttestation(),
    registerSessionResource: (_session, dispose) => { dispose(); return () => { calls++; }; },
    schedule: () => () => undefined,
  });
  assert.throws(() => raced.issue(current.context, () => { calls++; }), hasCode('lifecycle_unavailable'));
  assert.equal(calls, 2);
  const grant = current.grantOwner.issue(current.context, () => { current.state.terminal++; });
  assert.throws(() => current.grantOwner.withCurrent(grant, async () => 'forbidden'), hasCode('lifecycle_unavailable'));
});

test('imports no request ambient, review authority, PIN, proof, writer, or IPC boundary', () => {
  const source = fs.readFileSync(new URL('./headless-checkup-active-role-session-grant.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /cookies|acquireAuthenticated|physician-review|session-physician-review|fresh-review|proof|writer|ipc/iu);
});
