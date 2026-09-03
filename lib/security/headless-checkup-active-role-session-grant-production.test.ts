/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-checkup-grant-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
  env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});
const production = await import('./headless-checkup-active-role-session-grant-production.ts');
const storeModule = await import('./headless-checkup-active-role-attestation-store.ts');
const fixtureModule = await import('./web-auth-lifecycle-owner-test-fixture.ts');
const sessions: Array<ReturnType<typeof fixtureModule.issueSyntheticWebSession>> = [];

function user(actorRef: string): void {
  const db = new Database(path.join(dataDir, 'medical.db'));
  try { db.prepare(`INSERT INTO users (id,username,password_hash,encrypted_master_key,salt)
    VALUES (?,?,'synthetic-hash','synthetic-key','synthetic-salt')`).run(actorRef, `${actorRef}-user`); }
  finally { db.close(); }
}
function context(session: ReturnType<typeof fixtureModule.issueSyntheticWebSession>) {
  const owner = Object.freeze({
    withLeaseCriticalSection(candidate: unknown, operation: (selection: unknown) => unknown) {
      if (candidate !== session) throw new Error('wrong session');
      return operation({ patientId: 'synthetic-patient-production', ambulatoryId: 'synthetic-ambulatory-production' });
    },
    snapshotSelectionEpoch(candidate: unknown) { if (candidate !== session) throw new Error('wrong session'); return 5; },
  });
  return Object.freeze(Object.assign(Object.create(null), { session, owner }));
}

test('exports only the checkup-specific process owner without ambient auth resolution', () => {
  assert.deepEqual(Reflect.ownKeys(production.headlessCheckupActiveRoleSessionGrant).sort(),
    ['dispose', 'issue', 'withCurrent', 'withCurrentRequest']);
  const source = fs.readFileSync(new URL('./headless-checkup-active-role-session-grant-production.ts', import.meta.url), 'utf8');
  assert.match(source, /createHeadlessCheckupActiveRoleAttestationStoreV1/u);
  assert.doesNotMatch(source, /peekSession|registerServerSessionResource/u);
  assert.doesNotMatch(source, /readAuthenticatedWebSession|acquireAuthenticated|cookies|physician-review|fresh-review|proof|writer|ipc/iu);
});

test('issues against a real external P3 admin projection and denies an unenrolled actor', () => {
  const enrolledActor = 'synthetic-checkup-production-enrolled'; user(enrolledActor);
  const store = storeModule.createHeadlessCheckupActiveRoleAttestationStoreV1();
  store.createInactive(enrolledActor); store.activate(enrolledActor);
  const enrolled = fixtureModule.issueSyntheticWebSession({ id: enrolledActor,
    username: 'synthetic-checkup-production-enrolled-user', role: 'admin' }, 'checkup-production-enrolled');
  sessions.push(enrolled); let terminal = 0;
  const grant = production.headlessCheckupActiveRoleSessionGrant.issue(context(enrolled), () => { terminal++; });
  assert.equal(production.headlessCheckupActiveRoleSessionGrant.withCurrent(grant, () => 'current'), 'current');
  fixtureModule.retireSyntheticWebSession(enrolled);
  assert.equal(terminal, 1);
  assert.throws(() => production.headlessCheckupActiveRoleSessionGrant.withCurrent(grant, () => 'replay'),
    (error: unknown) => (error as { code?: unknown }).code === 'grant_unavailable');

  const absentActor = 'synthetic-checkup-production-not-enrolled'; user(absentActor);
  const absent = fixtureModule.issueSyntheticWebSession({ id: absentActor,
    username: 'synthetic-checkup-production-not-enrolled-user', role: 'admin' }, 'checkup-production-absent');
  sessions.push(absent);
  assert.throws(() => production.headlessCheckupActiveRoleSessionGrant.issue(context(absent), () => undefined),
    (error: unknown) => (error as { code?: unknown }).code === 'attestation_unavailable');
});

after(() => {
  while (sessions.length > 0) fixtureModule.retireSyntheticWebSession(sessions.pop()!);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
