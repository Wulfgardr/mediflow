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
function db() { return new Database(path.join(dataDir, 'medical.db')); }
function user(id: string): void {
    const database = db();
    try { database.prepare("INSERT INTO users (id, username, password_hash, encrypted_master_key, salt) VALUES (?, ?, 'synthetic-hash', 'synthetic-key', 'synthetic-salt')").run(id, `${id}-user`); } finally { database.close(); }
}
user(ACTOR_A); user(ACTOR_B); user(ACTOR_C);
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
    assert.equal(Object.prototype.hasOwnProperty.call(store, 'activate'), false);
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

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
