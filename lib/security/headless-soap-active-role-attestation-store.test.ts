/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-headless-soap-attestation-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });
const storeModule = await import('./headless-soap-active-role-attestation-store.ts');
const { createHeadlessSoapActiveRoleAttestationStore, isHeadlessSoapActiveRoleAttestationStoreError } = storeModule;
const ACTOR_A = 'synthetic-soap-attestation-actor-a';
const ACTOR_B = 'synthetic-soap-attestation-actor-b';
const ACTOR_C = 'synthetic-soap-attestation-actor-c';
const ACTOR_D = 'synthetic-soap-attestation-actor-d';
const ACTOR_E = 'synthetic-soap-attestation-actor-e';
const ACTOR_F = 'synthetic-soap-attestation-actor-f';
const ACTOR_G = 'synthetic-soap-attestation-actor-g';
function db() { return new Database(path.join(dataDir, 'medical.db')); }
function user(id: string): void {
    const database = db();
    try { database.prepare("INSERT INTO users (id, username, password_hash, encrypted_master_key, salt) VALUES (?, ?, 'synthetic-hash', 'synthetic-key', 'synthetic-salt')").run(id, `${id}-user`); } finally { database.close(); }
}
user(ACTOR_A); user(ACTOR_B); user(ACTOR_C); user(ACTOR_D); user(ACTOR_E); user(ACTOR_F); user(ACTOR_G);
function hasCode(code: string) { return (error: unknown) => isHeadlessSoapActiveRoleAttestationStoreError(error) && error.code === code; }

test('creates a host-generated fixed inactive SOAP attestation for one canonical actor', () => {
    const store = createHeadlessSoapActiveRoleAttestationStore();
    const created = store.createInactive(ACTOR_A);
    assert.equal(Object.getPrototypeOf(created), null);
    assert.ok(Object.isFrozen(created));
    assert.match(created.attestationRef, /^hsar_[0-9a-f]{32}$/);
    assert.deepEqual({ schema: created.schemaVersion, role: created.role, operation: created.operationId, policy: created.policyVersion, status: created.status, version: created.attestationVersion, issuer: created.issuerRef, expiry: created.expiresAt, active: created.activatedAt, generation: created.revocationGeneration, revoked: created.revokedAt }, {
        schema: 'mediflow.headless-soap-active-role-attestation.v1', role: 'physician', operation: 'mediflow.clinical_diary.append_soap.v1', policy: 'clinician_confirmed_single_use.v1', status: 'inactive', version: 1, issuer: null, expiry: null, active: null, generation: 0, revoked: null,
    });
    assert.equal(created.createdAt.getTime() % 1000, 0);
    assert.deepEqual(store.read(ACTOR_A), created);
    assert.equal(typeof store.activate, 'function');
});

test('fails closed for missing, duplicate, and hostile actor references without granting role authority', () => {
    const store = createHeadlessSoapActiveRoleAttestationStore();
    assert.throws(() => store.createInactive('missing-synthetic-actor'), hasCode('actor_missing'));
    assert.throws(() => store.createInactive(ACTOR_A), hasCode('attestation_conflict'));
    assert.throws(() => store.read(ACTOR_B), hasCode('attestation_missing'));
    let traps = 0;
    const transparent = new Proxy({}, { getOwnPropertyDescriptor() { traps++; return undefined; }, ownKeys() { traps++; return []; } });
    for (const value of [null, '', ' actor', 'actor ', 1, transparent]) assert.throws(() => store.createInactive(value), hasCode('actor_invalid'));
    assert.equal(traps, 0);
    assert.equal(isHeadlessSoapActiveRoleAttestationStoreError({ code: 'actor_missing' }), false);
});

test('serializes duplicate creation, persists across a new store, and returns distinct opaque refs', async () => {
    const store = createHeadlessSoapActiveRoleAttestationStore();
    const [one, two] = await Promise.allSettled([
        Promise.resolve().then(() => store.createInactive(ACTOR_B)), Promise.resolve().then(() => store.createInactive(ACTOR_B)),
    ]);
    assert.equal([one, two].filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal([one, two].filter((item) => item.status === 'rejected').length, 1);
    assert.deepEqual(createHeadlessSoapActiveRoleAttestationStore().read(ACTOR_B), store.read(ACTOR_B));
    assert.notEqual(store.read(ACTOR_A).attestationRef, store.read(ACTOR_B).attestationRef);
});

test('activates and renews with host-owned issuer, fixed expiry, and atomic PHI-safe audit', () => {
    const store = createHeadlessSoapActiveRoleAttestationStore();
    const inactive = store.createInactive(ACTOR_E);
    const activated = store.activate(ACTOR_E);
    assert.equal(store.activate.length, 1);
    assert.equal(activated.status, 'active');
    assert.equal(activated.attestationRef, inactive.attestationRef);
    assert.equal(activated.revocationGeneration, 0);
    assert.match(activated.issuerRef, /^hsari_[0-9a-f]{32}$/);
    assert.ok(activated.activatedAt instanceof Date);
    assert.ok(activated.expiresAt instanceof Date);
    assert.equal(activated.expiresAt.getTime() - activated.activatedAt.getTime(), 8 * 60 * 60 * 1000);
    assert.deepEqual(store.read(ACTOR_E), activated);
    assert.throws(() => store.activate(ACTOR_E), hasCode('attestation_conflict'));

    const database = db();
    try {
        database.prepare(`UPDATE headless_soap_active_role_attestations SET created_at = unixepoch() - 28810,
            activated_at = unixepoch() - 28801, expires_at = unixepoch() - 1, updated_at = unixepoch() - 1
            WHERE actor_ref = ?`).run(ACTOR_E);
    } finally { database.close(); }
    const renewed = store.activate(ACTOR_E);
    assert.equal(renewed.status, 'active');
    assert.notEqual(renewed.issuerRef, activated.issuerRef);
    assert.equal(renewed.expiresAt.getTime() - renewed.activatedAt.getTime(), 8 * 60 * 60 * 1000);

    const auditDatabase = db();
    try {
        const events = auditDatabase.prepare(`SELECT event_type AS eventType, actor_ref AS actorRef,
            subject_type AS subjectType, subject_ref AS subjectRef, redacted_metadata AS redactedMetadata
            FROM audit_events WHERE event_type = 'auth.soap_active_role.enrolled' AND actor_ref = ?
            ORDER BY rowid`).all(ACTOR_E);
        assert.deepEqual(events, [0, 1].map(() => ({
            eventType: 'auth.soap_active_role.enrolled', actorRef: ACTOR_E,
            subjectType: 'active_role_attestation', subjectRef: renewed.attestationRef,
            redactedMetadata: '{"flags":["auth:session"],"reasonCode":"controlled_setup"}',
        })));
        assert.equal(JSON.stringify(events).includes('PIN'), false);
        assert.equal(JSON.stringify(events).includes('SOAP'), false);
    } finally { auditDatabase.close(); }
});

test('revokes an active attestation without erasing its activation generation', () => {
    const store = createHeadlessSoapActiveRoleAttestationStore();
    const current = store.read(ACTOR_E);
    assert.equal(current.status, 'active');
    if (current.status !== 'active') throw new Error('expected active attestation');
    const revoked = store.revoke(ACTOR_E, {
        attestationRef: current.attestationRef, attestationVersion: 1, revocationGeneration: 0,
    });
    assert.equal(revoked.status, 'revoked');
    assert.equal(revoked.revocationGeneration, 1);
    assert.equal(revoked.issuerRef, current.issuerRef);
    assert.deepEqual(revoked.activatedAt, current.activatedAt);
    assert.deepEqual(revoked.expiresAt, current.expiresAt);
    assert.throws(() => store.activate(ACTOR_E), hasCode('attestation_conflict'));
});

test('serializes concurrent activation to one winner and one audited generation', async () => {
    const store = createHeadlessSoapActiveRoleAttestationStore();
    store.createInactive(ACTOR_F);
    const outcomes = await Promise.allSettled([
        Promise.resolve().then(() => store.activate(ACTOR_F)),
        Promise.resolve().then(() => store.activate(ACTOR_F)),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected' && hasCode('attestation_conflict')(outcome.reason)).length, 1);
    const database = db();
    try {
        const audit = database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'auth.soap_active_role.enrolled' AND actor_ref = ?").get(ACTOR_F) as { count: number };
        assert.equal(audit.count, 1);
    } finally { database.close(); }
});

test('rejects a stored active lifecycle whose expiry drifts from the fixed eight-hour window', () => {
    const database = db();
    try { database.prepare('UPDATE headless_soap_active_role_attestations SET expires_at = expires_at + 1 WHERE actor_ref = ?').run(ACTOR_F); } finally { database.close(); }
    assert.throws(() => createHeadlessSoapActiveRoleAttestationStore().read(ACTOR_F), hasCode('stored_state_invalid'));
});

test('revokes only the exact current inactive attestation under transactional CAS', async () => {
    const store = createHeadlessSoapActiveRoleAttestationStore();
    const current = store.read(ACTOR_B);
    assert.equal(current.status, 'inactive');
    const expected = { attestationRef: current.attestationRef, attestationVersion: 1, revocationGeneration: 0 };
    const revoked = store.revoke(ACTOR_B, expected);
    assert.equal(revoked.status, 'revoked'); assert.equal(revoked.revocationGeneration, 1); assert.ok(revoked.revokedAt instanceof Date); assert.equal(revoked.revokedAt.getTime() % 1000, 0);
    assert.deepEqual(store.read(ACTOR_B), revoked);
    assert.throws(() => store.revoke(ACTOR_B, expected), hasCode('attestation_conflict'));
    assert.throws(() => store.revoke(ACTOR_A, expected), hasCode('attestation_conflict'));
    let traps = 0;
    const proxy = new Proxy(expected, { ownKeys() { traps++; return []; } });
    for (const invalid of [null, { ...expected, role: 'physician' }, { ...expected, revocationGeneration: 1 }, proxy]) assert.throws(() => store.revoke(ACTOR_A, invalid), hasCode('actor_invalid'));
    assert.equal(traps, 0);
    const contender = store.createInactive(ACTOR_D);
    const winner = { attestationRef: contender.attestationRef, attestationVersion: 1, revocationGeneration: 0 };
    const results = await Promise.allSettled([Promise.resolve().then(() => store.revoke(ACTOR_D, winner)), Promise.resolve().then(() => store.revoke(ACTOR_D, winner))]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    const database = db(); database.pragma('ignore_check_constraints = ON');
    try { database.prepare('UPDATE headless_soap_active_role_attestations SET revocation_generation = 9007199254740991 WHERE actor_ref = ?').run(ACTOR_B); } finally { database.pragma('ignore_check_constraints = OFF'); database.close(); }
    assert.throws(() => store.read(ACTOR_B), hasCode('stored_state_invalid'));
});

test('uses captured SQL and intrinsics after hostile post-import mutation', async () => {
    const { dbServer } = await import('../db-server.ts');
    const objectApi = Object as unknown as { getPrototypeOf: typeof Object.getPrototypeOf; getOwnPropertyDescriptors: typeof Object.getOwnPropertyDescriptors };
    const original = { getPrototypeOf: Object.getPrototypeOf, getOwnPropertyDescriptors: Object.getOwnPropertyDescriptors, ownKeys: Reflect.ownKeys, now: Date.now, error: Error, insert: dbServer.insert, ownInsert: Object.prototype.hasOwnProperty.call(dbServer, 'insert'), then: Object.getOwnPropertyDescriptor(Object.prototype, 'then'), toJSON: Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') };
    let hostileCalls = 0;
    try {
        objectApi.getPrototypeOf = (() => { hostileCalls++; return null; }) as typeof Object.getPrototypeOf;
        objectApi.getOwnPropertyDescriptors = (() => { hostileCalls++; return {}; }) as typeof Object.getOwnPropertyDescriptors;
        Reflect.ownKeys = (() => { hostileCalls++; return []; }) as typeof Reflect.ownKeys;
        Date.now = () => { hostileCalls++; return 0; };
        globalThis.Error = (() => { hostileCalls++; return new original.error('hostile'); }) as typeof Error;
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { hostileCalls++; return undefined; } });
        Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, get() { hostileCalls++; return undefined; } });
        (dbServer as unknown as { insert: unknown }).insert = () => { hostileCalls++; throw new original.error('hostile'); };
        assert.equal(createHeadlessSoapActiveRoleAttestationStore().createInactive(ACTOR_C).actorRef, ACTOR_C);
        assert.throws(() => createHeadlessSoapActiveRoleAttestationStore().read('missing-after-poison'), hasCode('actor_missing'));
    } finally {
        objectApi.getPrototypeOf = original.getPrototypeOf; objectApi.getOwnPropertyDescriptors = original.getOwnPropertyDescriptors;
        Reflect.ownKeys = original.ownKeys; Date.now = original.now; globalThis.Error = original.error;
        if (original.then) Object.defineProperty(Object.prototype, 'then', original.then); else delete (Object.prototype as { then?: unknown }).then;
        if (original.toJSON) Object.defineProperty(Object.prototype, 'toJSON', original.toJSON); else delete (Object.prototype as { toJSON?: unknown }).toJSON;
        if (original.ownInsert) (dbServer as unknown as { insert: unknown }).insert = original.insert;
        else delete (dbServer as unknown as { insert?: unknown }).insert;
    }
    assert.equal(hostileCalls, 0);
});

test('fails closed for corrupt rows and emits neither thenables nor raw storage errors', () => {
    const database = db();
    database.pragma('ignore_check_constraints = ON');
    try { database.prepare("UPDATE headless_soap_active_role_attestations SET role = 'forged' WHERE actor_ref = ?").run(ACTOR_A); } finally { database.pragma('ignore_check_constraints = OFF'); database.close(); }
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); let reads = 0;
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads++; return undefined; } });
    try {
        assert.throws(() => createHeadlessSoapActiveRoleAttestationStore().read(ACTOR_A), (error) => hasCode('stored_state_invalid')(error) && !/sqlite|forged|constraint/i.test(String((error as Error).message)));
    } finally { if (original) Object.defineProperty(Object.prototype, 'then', original); else delete (Object.prototype as { then?: unknown }).then; }
    assert.equal(reads, 0);
});

test('rolls activation back when its append-only audit cannot commit', () => {
    const store = createHeadlessSoapActiveRoleAttestationStore();
    store.createInactive(ACTOR_G);
    const database = db();
    try { database.exec('DROP TABLE audit_events'); } finally { database.close(); }
    assert.throws(() => store.activate(ACTOR_G), hasCode('storage_unavailable'));
    assert.equal(store.read(ACTOR_G).status, 'inactive');
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
