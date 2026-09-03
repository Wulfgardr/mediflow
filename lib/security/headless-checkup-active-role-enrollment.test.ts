/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { createHeadlessCheckupActiveRoleEnrollmentService,
  HeadlessCheckupActiveRoleEnrollmentError,
  type HeadlessCheckupActiveRoleEnrollmentSources } from './headless-checkup-active-role-enrollment.ts';

const NOW = 1_900_000_000_000, TTL = 8 * 60 * 60 * 1_000, PIN = '2468';
const ACTOR = 'synthetic-checkup-enrollment-actor', USERNAME = 'synthetic-checkup-admin';
const SESSION_REF = 'a'.repeat(64);
function record<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), value));
}
function session(change: Record<string, unknown> = {}): unknown {
  return record({ id: SESSION_REF, userId: ACTOR, username: USERNAME, role: 'admin', authChannel: 'web',
    createdAt: NOW - 2_000, expiresAt: NOW + TTL, ...change });
}
function attestation(change: Record<string, unknown> = {}): unknown {
  return record({ attestationRef: `hcar_${'b'.repeat(32)}`, actorRef: ACTOR,
    schemaVersion: 'mediflow.headless-checkup-active-role-attestation.v1', role: 'physician',
    operationId: 'mediflow.patient.checkup.status.transition.v1', policyVersion: 'physician_confirmed_single_use.v1',
    status: 'active', attestationVersion: 1, issuerRef: `hcari_${'c'.repeat(32)}`,
    activatedAt: new Date(NOW - 1_000), expiresAt: new Date(NOW - 1_000 + TTL),
    revocationGeneration: 0, revokedAt: null, createdAt: new Date(NOW - 2_000),
    updatedAt: new Date(NOW - 1_000), ...change });
}
function sources(change: Partial<HeadlessCheckupActiveRoleEnrollmentSources> = {}): HeadlessCheckupActiveRoleEnrollmentSources {
  return { now: () => NOW, resolveCurrentWebAdmin: async () => session(),
    verifyAdminPin: async () => ({ kind: 'verified', account: { id: ACTOR, username: USERNAME,
      role: 'admin', encryptedMasterKey: 'not-observed' } }),
    readAttestation: () => ({ kind: 'missing' }),
    createInactive: () => ({ kind: 'ok', value: attestation({ status: 'inactive', issuerRef: null,
      activatedAt: null, expiresAt: null }) }),
    activate: () => ({ kind: 'ok', value: attestation() }),
    revoke: () => ({ kind: 'ok', value: attestation({ status: 'revoked', revocationGeneration: 1,
      revokedAt: new Date(NOW), updatedAt: new Date(NOW) }) }), ...change };
}
function hasCode(code: string) {
  return (error: unknown) => error instanceof HeadlessCheckupActiveRoleEnrollmentError
    && error.code === code && !error.message.includes(PIN) && !error.message.includes(ACTOR);
}

test('enrolls only after same current Web admin and PIN, returning no authority or actor', async () => {
  const trace: string[] = [];
  const service = createHeadlessCheckupActiveRoleEnrollmentService(sources({
    resolveCurrentWebAdmin: async () => { trace.push(trace.length === 0 ? 'before' : 'after'); return session(); },
    verifyAdminPin: async (input) => { trace.push('pin'); assert.deepEqual(input, { username: USERNAME, pin: PIN });
      return { kind: 'verified', account: { id: ACTOR, username: USERNAME, role: 'admin' } }; },
    readAttestation: (actorRef) => { trace.push(`read:${actorRef}`); return { kind: 'missing' }; },
    createInactive: (actorRef) => { trace.push(`create:${actorRef}`); return { kind: 'ok', value: null }; },
    activate: (actorRef) => { trace.push(`activate:${actorRef}`); return { kind: 'ok', value: attestation() }; },
  }));
  const projection = await service.enroll(PIN);
  assert.deepEqual(trace, ['before', 'pin', 'after', `read:${ACTOR}`, `create:${ACTOR}`, `activate:${ACTOR}`]);
  assert.deepEqual({ ...projection }, { schemaVersion: 'mediflow.headless-checkup-active-role-enrollment.v1',
    status: 'active', attestationVersion: 1 });
  assert.equal(JSON.stringify(projection).includes(PIN) || JSON.stringify(projection).includes(ACTOR), false);
});

test('denies invalid input, non-admin context, PIN mismatch, and session drift before persistence', async () => {
  for (const candidate of [null, '123', '123456789']) {
    let acquired = 0;
    await assert.rejects(createHeadlessCheckupActiveRoleEnrollmentService(sources({
      resolveCurrentWebAdmin: async () => { acquired++; return session(); },
    })).enroll(candidate), hasCode('enrollment_denied'));
    assert.equal(acquired, 0);
  }
  for (const current of [null, session({ role: 'clinician' }), session({ authChannel: 'native' }),
    session({ expiresAt: NOW })]) {
    let verified = 0;
    await assert.rejects(createHeadlessCheckupActiveRoleEnrollmentService(sources({
      resolveCurrentWebAdmin: async () => current, verifyAdminPin: async () => { verified++; return null; },
    })).enroll(PIN), hasCode('enrollment_denied'));
    assert.equal(verified, 0);
  }
  let stores = 0;
  await assert.rejects(createHeadlessCheckupActiveRoleEnrollmentService(sources({
    verifyAdminPin: async () => ({ kind: 'verified', account: { id: 'other', username: USERNAME, role: 'admin' } }),
    readAttestation: () => { stores++; return { kind: 'missing' }; },
  })).enroll(PIN), hasCode('enrollment_denied'));
  assert.equal(stores, 0);
  let calls = 0;
  await assert.rejects(createHeadlessCheckupActiveRoleEnrollmentService(sources({
    resolveCurrentWebAdmin: async () => ++calls === 1 ? session() : session({ id: 'd'.repeat(64) }),
  })).enroll(PIN), hasCode('enrollment_denied'));
});

test('preserves lifecycle conflicts and rejects expired or wrong-operation activation', async () => {
  await assert.rejects(createHeadlessCheckupActiveRoleEnrollmentService(sources({
    activate: () => ({ kind: 'conflict' }),
  })).enroll(PIN), hasCode('enrollment_conflict'));
  for (const forged of [attestation({ operationId: 'mediflow.other.v1' }),
    attestation({ expiresAt: new Date(NOW) }), attestation({ role: 'reviewer' }),
    attestation({ policyVersion: 'other' })]) {
    await assert.rejects(createHeadlessCheckupActiveRoleEnrollmentService(sources({
      activate: () => ({ kind: 'ok', value: forged }),
    })).enroll(PIN), hasCode('storage_unavailable'));
  }
});

test('revokes only the exact active attestation after a fresh same-admin PIN check', async () => {
  const trace: string[] = [];
  const service = createHeadlessCheckupActiveRoleEnrollmentService(sources({
    resolveCurrentWebAdmin: async () => { trace.push(trace.length === 0 ? 'before' : 'after'); return session(); },
    verifyAdminPin: async () => { trace.push('pin'); return { kind: 'verified',
      account: { id: ACTOR, username: USERNAME, role: 'admin' } }; },
    readAttestation: () => { trace.push('read'); return { kind: 'ok', value: attestation() }; },
    revoke: (actorRef, expected) => { trace.push('revoke'); assert.equal(actorRef, ACTOR);
      assert.deepEqual(expected, { attestationRef: `hcar_${'b'.repeat(32)}`, attestationVersion: 1,
        revocationGeneration: 0 }); return { kind: 'ok', value: attestation({ status: 'revoked',
        revocationGeneration: 1, revokedAt: new Date(NOW), updatedAt: new Date(NOW) }) }; },
  }));
  assert.deepEqual({ ...await service.revoke(PIN) }, {
    schemaVersion: 'mediflow.headless-checkup-active-role-revocation.v1', status: 'revoked',
    attestationVersion: 1, revocationGeneration: 1,
  });
  assert.deepEqual(trace, ['before', 'pin', 'after', 'read', 'revoke']);
  await assert.rejects(createHeadlessCheckupActiveRoleEnrollmentService(sources({
    readAttestation: () => ({ kind: 'ok', value: attestation({ status: 'revoked', revocationGeneration: 1,
      revokedAt: new Date(NOW) }) }),
  })).revoke(PIN), hasCode('enrollment_conflict'));
});

test('keeps enrollment separate from review authority and clinical writers', () => {
  const source = fs.readFileSync(new URL('./headless-checkup-active-role-enrollment.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /physician-review|session-physician-review|active-review-binding|clinical-diary|fabric/iu);
});
