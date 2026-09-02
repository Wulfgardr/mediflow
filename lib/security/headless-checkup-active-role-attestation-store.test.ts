/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-checkup-active-role-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
  env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});
const storeModule = await import('./headless-checkup-active-role-attestation-store.ts');
const { createHeadlessCheckupActiveRoleAttestationStoreV1 } = storeModule;
const databasePath = path.join(dataDir, 'medical.db');
const actors = Array.from({ length: 7 }, (_, index) => `synthetic-checkup-active-role-${index + 1}`);

function db(): Database.Database { return new Database(databasePath); }
function insertActor(actorRef: string): void {
  const database = db();
  try {
    database.prepare(`INSERT INTO users (id,username,password_hash,encrypted_master_key,salt)
      VALUES (?,?,'synthetic-hash','synthetic-key','synthetic-salt')`).run(actorRef, `${actorRef}-user`);
  } finally { database.close(); }
}
for (const actorRef of actors) insertActor(actorRef);

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof storeModule.HeadlessCheckupActiveRoleAttestationError
    && error.code === expected;
}
function controlledSources(start = 1, at = 1_900_000_000_000) {
  let byte = start, event = start, now = at;
  return {
    sources: {
      now: () => now,
      entropy: (size: number) => new Uint8Array(size).fill(byte++),
      eventRef: () => `00000000-0000-4000-8000-${String(event++).padStart(12, '0')}`,
    },
    advance(milliseconds: number) { now += milliseconds; },
  };
}

test('creates only the fixed inactive checkup authority for one canonical actor', () => {
  const clock = controlledSources();
  const store = createHeadlessCheckupActiveRoleAttestationStoreV1(clock.sources);
  const created = store.createInactive(actors[0]);
  assert.ok(Object.isFrozen(created)); assert.equal(Object.getPrototypeOf(created), null);
  assert.match(created.attestationRef, /^hcar_[0-9a-f]{32}$/);
  assert.deepEqual({
    schema: created.schemaVersion, role: created.role, operation: created.operationId,
    policy: created.policyVersion, status: created.status, version: created.attestationVersion,
    issuer: created.issuerRef, expiry: created.expiresAt, generation: created.revocationGeneration,
  }, {
    schema: 'mediflow.headless-checkup-active-role-attestation.v1', role: 'physician',
    operation: 'mediflow.patient.checkup.status.transition.v1',
    policy: 'physician_confirmed_single_use.v1', status: 'inactive', version: 1,
    issuer: null, expiry: null, generation: 0,
  });
  assert.deepEqual(store.read(actors[0]), created);
  assert.throws(() => store.createInactive(actors[0]), code('attestation_conflict'));
  assert.throws(() => store.createInactive('missing-synthetic-actor'), code('actor_missing'));
  for (const invalid of [null, '', ' actor', 'actor ', 1]) {
    assert.throws(() => store.createInactive(invalid), code('actor_invalid'));
  }
});

test('bounds opaque-ref collision retries without adopting another actor attestation', () => {
  const first = createHeadlessCheckupActiveRoleAttestationStoreV1({
    now: () => 1_900_000_000_000, entropy: (size) => new Uint8Array(size).fill(40),
  });
  first.createInactive(actors[1]);
  const collision = createHeadlessCheckupActiveRoleAttestationStoreV1({
    now: () => 1_900_000_000_000, entropy: (size) => new Uint8Array(size).fill(40),
  });
  assert.throws(() => collision.createInactive(actors[2]), code('attestation_conflict'));
  assert.throws(() => collision.read(actors[2]), code('attestation_missing'));
});

test('activates and renews with an eight-hour window and atomic PHI-safe audit', () => {
  const clock = controlledSources(60);
  const store = createHeadlessCheckupActiveRoleAttestationStoreV1(clock.sources);
  const inactive = store.createInactive(actors[3]);
  const active = store.activate(actors[3]);
  assert.equal(active.attestationRef, inactive.attestationRef); assert.equal(active.status, 'active');
  assert.match(active.issuerRef ?? '', /^hcari_[0-9a-f]{32}$/);
  assert.equal((active.expiresAt?.getTime() ?? 0) - (active.activatedAt?.getTime() ?? 0),
    storeModule.HEADLESS_CHECKUP_ACTIVE_ROLE_ATTESTATION_TTL_SECONDS * 1_000);
  assert.throws(() => store.activate(actors[3]), code('attestation_conflict'));
  clock.advance((storeModule.HEADLESS_CHECKUP_ACTIVE_ROLE_ATTESTATION_TTL_SECONDS + 1) * 1_000);
  const renewed = store.activate(actors[3]);
  assert.notEqual(renewed.issuerRef, active.issuerRef);

  const database = db();
  try {
    const events = database.prepare(`SELECT event_type AS eventType,actor_ref AS actorRef,
      subject_ref AS subjectRef,redacted_metadata AS metadata FROM audit_events
      WHERE event_type='auth.checkup_active_role.enrolled' AND actor_ref=? ORDER BY rowid`).all(actors[3]);
    assert.deepEqual(events, [0, 1].map(() => ({
      eventType: 'auth.checkup_active_role.enrolled', actorRef: actors[3],
      subjectRef: inactive.attestationRef,
      metadata: '{"flags":["auth:session"],"reasonCode":"controlled_setup"}',
    })));
    assert.equal(/pin|patient|targetStatus|expectedRevision/i.test(JSON.stringify(events)), false);
  } finally { database.close(); }
});

test('rolls activation back when its append-only audit reference is invalid', () => {
  const clock = controlledSources(80);
  const createStore = createHeadlessCheckupActiveRoleAttestationStoreV1(clock.sources);
  createStore.createInactive(actors[4]);
  const invalidAudit = createHeadlessCheckupActiveRoleAttestationStoreV1({
    ...clock.sources, eventRef: () => 'not-an-event-ref',
  });
  assert.throws(() => invalidAudit.activate(actors[4]), code('storage_unavailable'));
  assert.equal(createStore.read(actors[4]).status, 'inactive');
});

test('revokes only the exact current generation and terminalizes replay', () => {
  const clock = controlledSources(100);
  const store = createHeadlessCheckupActiveRoleAttestationStoreV1(clock.sources);
  store.createInactive(actors[5]);
  const active = store.activate(actors[5]);
  const expected = { attestationRef: active.attestationRef, attestationVersion: 1 as const,
    revocationGeneration: 0 as const };
  assert.throws(() => store.revoke(actors[5], { ...expected, attestationRef: 'hcar_' + '0'.repeat(32) }),
    code('attestation_conflict'));
  const revoked = store.revoke(actors[5], expected);
  assert.equal(revoked.status, 'revoked'); assert.equal(revoked.revocationGeneration, 1);
  assert.ok(revoked.revokedAt instanceof Date);
  assert.throws(() => store.revoke(actors[5], expected), code('attestation_conflict'));
  assert.throws(() => store.activate(actors[5]), code('attestation_conflict'));
});

test('schema constraints reject wrong operation and the decoder fails closed on drift', () => {
  const clock = controlledSources(120);
  const store = createHeadlessCheckupActiveRoleAttestationStoreV1(clock.sources);
  const current = store.createInactive(actors[6]);
  const database = db();
  try {
    assert.throws(() => database.prepare(`UPDATE headless_checkup_active_role_attestations
      SET operation_id='mediflow.other.operation.v1' WHERE actor_ref=?`).run(actors[6]));
    database.pragma('ignore_check_constraints = ON');
    database.prepare(`UPDATE headless_checkup_active_role_attestations
      SET policy_version='forged' WHERE actor_ref=?`).run(actors[6]);
    database.pragma('ignore_check_constraints = OFF');
  } finally { database.close(); }
  assert.throws(() => store.read(actors[6]), code('stored_state_invalid'));
  assert.match(current.attestationRef, /^hcar_/);
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
