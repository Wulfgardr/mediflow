/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, test } from 'node:test';

import { createHeadlessCheckupActiveRoleSessionGrantOwner,
  HeadlessCheckupActiveRoleSessionGrantError } from './headless-checkup-active-role-session-grant.ts';
import { beginResourceUse, commitResourceUse, mintResourcePort } from
  './web-auth-lifecycle-owner-adapter.ts';
import { issueSyntheticWebSession, retireSyntheticWebSession } from
  './web-auth-lifecycle-owner-test-fixture.ts';

const ACTOR = 'synthetic-checkup-grant-actor', NOW = Date.now() + 1_000;
const TTL = 8 * 60 * 60 * 1_000;
const sessions: Array<ReturnType<typeof issueSyntheticWebSession>> = [];
let sequence = 0;
function record<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), value));
}
function fixture() {
  const state = { now: NOW, patientId: 'synthetic-patient-a', ambulatoryId: 'synthetic-ambulatory-a',
    epoch: 4, terminal: 0, cancel: 0, expiryDispose: null as (() => void) | null, attestationReads: 0,
    onAttestationRead: null as (() => void) | null };
  const session = issueSyntheticWebSession({ id: ACTOR, username: 'synthetic-checkup-admin', role: 'admin' },
    `checkup-grant-${sequence += 1}`);
  sessions.push(session);
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
    readAttestation: () => {
      state.attestationReads++;
      state.onAttestationRead?.();
      return currentAttestation;
    },
    schedule: (_delay, dispose) => {
      state.expiryDispose = dispose; return () => { state.cancel++; state.expiryDispose = null; };
    },
  });
  return { state, session, owner, context, grantOwner,
    setSession(value: unknown) { currentSession = value; },
    setAttestation(value: unknown) { currentAttestation = value; } };
}

afterEach(() => {
  while (sessions.length > 0) retireSyntheticWebSession(sessions.pop()!);
});
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

test('keeps projection and downstream checks outside the external P3 critical section', () => {
  const current = fixture();
  const witnessPort = mintResourcePort(current.session);
  assert.ok(witnessPort);
  const witness = () => {
    const use = beginResourceUse(witnessPort);
    assert.ok(use);
    assert.equal(commitResourceUse(use), true);
  };
  const owner = Object.freeze({
    withLeaseCriticalSection(candidate: unknown, operation: (selection: unknown) => unknown) {
      assert.equal(candidate, current.session); witness();
      return operation({ patientId: current.state.patientId, ambulatoryId: current.state.ambulatoryId });
    },
    snapshotSelectionEpoch(candidate: unknown) {
      assert.equal(candidate, current.session); witness(); return current.state.epoch;
    },
  });
  const context = record({ session: current.session, owner });
  const grant = current.grantOwner.issue(context, () => { current.state.terminal++; });
  assert.equal(current.grantOwner.withCurrent(grant, () => { witness(); return 'current'; }), 'current');
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
    (current) => { retireSyntheticWebSession(current.session); },
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
    now: () => NOW,
    readAttestation: () => ++read === 1 ? activeAttestation() : activeAttestation({ issuerRef: `hcari_${'d'.repeat(32)}` }),
    schedule: () => () => undefined,
  });
  assert.throws(() => driftOwner.issue(drift.context, () => undefined), hasCode('projection_stale'));

  const current = fixture(), grant = current.grantOwner.issue(current.context, () => { current.state.terminal++; });
  const otherSession = record({ ...current.session, id: 'e'.repeat(64) });
  const foreign = record({ session: otherSession, owner: current.owner });
  assert.throws(() => current.grantOwner.withCurrentRequest(grant, foreign, () => 'forbidden'),
    hasCode('projection_stale'));
  assert.equal(current.state.terminal, 1);
});

test('external P3 retirement and async callbacks fail closed', () => {
  const current = fixture();
  const grant = current.grantOwner.issue(current.context, () => { current.state.terminal++; });
  assert.throws(() => current.grantOwner.withCurrent(grant, async () => 'forbidden'), hasCode('lifecycle_unavailable'));
  assert.equal(current.state.terminal, 0);
  assert.equal(current.grantOwner.withCurrent(grant, () => 'current'), 'current');
});

test('poisons an outer operation when currentness checks trigger reentry', () => {
  const before = fixture();
  const beforeGrant = before.grantOwner.issue(before.context, () => { before.state.terminal++; });
  before.state.attestationReads = 0;
  before.state.onAttestationRead = () => {
    before.state.onAttestationRead = null;
    assert.throws(() => before.grantOwner.withCurrent(beforeGrant, () => 'nested'),
      hasCode('lifecycle_unavailable'));
  };
  let beforeCalls = 0;
  assert.throws(() => before.grantOwner.withCurrent(beforeGrant, () => {
    beforeCalls += 1; return 'outer';
  }), hasCode('lifecycle_unavailable'));
  assert.equal(beforeCalls, 0, 'reentry in the first stable read must stop the downstream callback');
  assert.throws(() => before.grantOwner.withCurrent(beforeGrant, () => 'replay'), hasCode('grant_unavailable'));

  const after = fixture();
  const afterGrant = after.grantOwner.issue(after.context, () => { after.state.terminal++; });
  after.state.attestationReads = 0;
  after.state.onAttestationRead = () => {
    if (after.state.attestationReads !== 3) return;
    after.state.onAttestationRead = null;
    assert.throws(() => after.grantOwner.withCurrent(afterGrant, () => 'nested'),
      hasCode('lifecycle_unavailable'));
  };
  let afterCalls = 0;
  assert.throws(() => after.grantOwner.withCurrent(afterGrant, () => {
    afterCalls += 1; return 'outer';
  }), hasCode('lifecycle_unavailable'));
  assert.equal(afterCalls, 1, 'the completed callback result must not escape a poisoned final read');
  assert.throws(() => after.grantOwner.withCurrent(afterGrant, () => 'replay'), hasCode('grant_unavailable'));
});

test('imports no request ambient, review authority, PIN, proof, writer, or IPC boundary', () => {
  const source = fs.readFileSync(new URL('./headless-checkup-active-role-session-grant.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /cookies|acquireAuthenticated|physician-review|session-physician-review|fresh-review|proof|writer|ipc/iu);
});
