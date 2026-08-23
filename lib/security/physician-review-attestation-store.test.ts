/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-review-attestation-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
    env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});

const {
    createPhysicianReviewAttestationStore,
    PhysicianReviewAttestationStoreError,
} = await import('./physician-review-attestation-store.ts');

const ACTOR_A = 'synthetic-attestation-actor-a';
const ACTOR_B = 'synthetic-attestation-actor-b';
function insertCanonicalUser(id: string): void {
    const db = new Database(path.join(dataDir, 'medical.db'));
    try {
        db.prepare(`
            INSERT INTO users (id, username, password_hash, encrypted_master_key, salt)
            VALUES (?, ?, 'synthetic-hash', 'synthetic-key', 'synthetic-salt')
        `).run(id, `${id}-user`);
    } finally {
        db.close();
    }
}
insertCanonicalUser(ACTOR_A);
insertCanonicalUser(ACTOR_B);

test('DDL rejects forged fixed fields, lifecycle values, and timestamp domains', () => {
    const db = new Database(path.join(dataDir, 'medical.db'));
    try {
        const invalidRows = [
            ['forged.schema', 'physician_terminal_review', 'inactive', 1, 'physician_terminal_review.v1', null, 1, 1],
            ['mediflow.physician-review-attestation.v1', 'forged_capability', 'inactive', 1, 'physician_terminal_review.v1', null, 1, 1],
            ['mediflow.physician-review-attestation.v1', 'physician_terminal_review', 'active', 1, 'physician_terminal_review.v1', null, 1, 1],
            ['mediflow.physician-review-attestation.v1', 'physician_terminal_review', 'inactive', 99, 'physician_terminal_review.v1', null, 1, 1],
            ['mediflow.physician-review-attestation.v1', 'physician_terminal_review', 'inactive', 1, 'forged.policy', null, 1, 1],
            ['mediflow.physician-review-attestation.v1', 'physician_terminal_review', 'inactive', 1, 'physician_terminal_review.v1', 1, 1, 1],
            ['mediflow.physician-review-attestation.v1', 'physician_terminal_review', 'revoked', 1, 'physician_terminal_review.v1', null, 1, 1],
            ['mediflow.physician-review-attestation.v1', 'physician_terminal_review', 'inactive', 1, 'physician_terminal_review.v1', null, 'not-a-timestamp', 1],
        ];
        for (const [index, values] of invalidRows.entries()) {
            const actorRef = `synthetic-forged-attestation-${index}`;
            insertCanonicalUser(actorRef);
            assert.throws(() => db.prepare(`
                INSERT INTO physician_review_attestations (
                    actor_ref, schema_version, capability, status, attestation_version, policy_version, revoked_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(actorRef, ...values));
        }
    } finally {
        db.close();
    }
});

test('creates only a fixed, default-inactive attestation for one canonical opaque actor', () => {
    const store = createPhysicianReviewAttestationStore();
    const created = store.createInactive(ACTOR_A);

    assert.deepEqual(
        {
            schemaVersion: created.schemaVersion,
            actorRef: created.actorRef,
            capability: created.capability,
            status: created.status,
            attestationVersion: created.attestationVersion,
            policyVersion: created.policyVersion,
            revokedAt: created.revokedAt,
        },
        {
            schemaVersion: 'mediflow.physician-review-attestation.v1',
            actorRef: ACTOR_A,
            capability: 'physician_terminal_review',
            status: 'inactive',
            attestationVersion: 1,
            policyVersion: 'physician_terminal_review.v1',
            revokedAt: null,
        },
    );
    assert.ok(created.createdAt instanceof Date);
    assert.ok(created.updatedAt instanceof Date);
    assert.deepEqual(store.read(ACTOR_A), created);
});
test('requires a canonical actor atomically and fails closed for a duplicate or missing attestation', () => {
    const store = createPhysicianReviewAttestationStore();

    assert.throws(
        () => store.createInactive('synthetic-missing-actor'),
        (error) => error instanceof PhysicianReviewAttestationStoreError && error.code === 'actor_missing',
    );
    assert.throws(
        () => store.createInactive(ACTOR_A),
        (error) => error instanceof PhysicianReviewAttestationStoreError && error.code === 'attestation_conflict',
    );
    assert.throws(
        () => store.read(ACTOR_B),
        (error) => error instanceof PhysicianReviewAttestationStoreError && error.code === 'attestation_missing',
    );
});
test('exposes no caller control over capability, state, versions, or actor metadata', () => {
    const store = createPhysicianReviewAttestationStore();
    assert.equal(store.createInactive.length, 1);
    assert.equal(store.read.length, 1);

    for (const invalid of [null, '', ' actor', 'actor ', 42, { actorRef: ACTOR_B }]) {
        assert.throws(
            () => store.createInactive(invalid),
            (error) => error instanceof PhysicianReviewAttestationStoreError && error.code === 'actor_invalid',
        );
    }

    if (false) {
        // @ts-expect-error The store does not accept caller-supplied authority fields.
        store.createInactive(ACTOR_B, { status: 'active', capability: 'admin', policyVersion: 'forged' });
    }
});
test('fails closed for corrupt state, invalid dates, orphaned actors, and unconstrained prior tables', () => {
    const db = new Database(path.join(dataDir, 'medical.db'));
    db.pragma('ignore_check_constraints = ON');
    try { db.prepare("UPDATE physician_review_attestations SET status = 'active' WHERE actor_ref = ?").run(ACTOR_A); } finally { db.pragma('ignore_check_constraints = OFF'); }

    const store = createPhysicianReviewAttestationStore();
    assert.throws(
        () => store.read(ACTOR_A),
        (error) => error instanceof PhysicianReviewAttestationStoreError && error.code === 'stored_state_invalid',
    );

    db.pragma('ignore_check_constraints = ON');
    try {
        db.prepare("UPDATE physician_review_attestations SET status = 'inactive', created_at = 'not-a-timestamp' WHERE actor_ref = ?").run(ACTOR_A);
    } finally {
        db.pragma('ignore_check_constraints = OFF');
    }
    assert.throws(
        () => store.read(ACTOR_A),
        (error) => error instanceof PhysicianReviewAttestationStoreError && error.code === 'stored_state_invalid',
    );

    db.prepare('UPDATE physician_review_attestations SET created_at = 1, updated_at = 1 WHERE actor_ref = ?').run(ACTOR_A);
    store.createInactive(ACTOR_B);
    db.pragma('foreign_keys = OFF');
    try { db.prepare('DELETE FROM users WHERE id = ?').run(ACTOR_B); } finally { db.pragma('foreign_keys = ON'); }
    assert.throws(
        () => store.read(ACTOR_B),
        (error) => error instanceof PhysicianReviewAttestationStoreError && error.code === 'actor_missing',
    );

    db.exec('DROP TABLE physician_review_attestations');
    db.exec(`
        CREATE TABLE physician_review_attestations (
            actor_ref TEXT PRIMARY KEY NOT NULL, schema_version TEXT NOT NULL, capability TEXT NOT NULL,
            status TEXT NOT NULL, attestation_version INTEGER NOT NULL, policy_version TEXT NOT NULL,
            revoked_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )
    `);
    db.prepare(`
        INSERT INTO physician_review_attestations VALUES (?, 'mediflow.physician-review-attestation.v1',
            'physician_terminal_review', 'inactive', 1, 'physician_terminal_review.v1', NULL, 1, 1)
    `).run(ACTOR_A);
    assert.throws(
        () => store.read(ACTOR_A),
        (error) => error instanceof PhysicianReviewAttestationStoreError
            && String(error.code) === 'schema_incompatible'
            && !/sqlite|constraint/i.test(error.message),
    );

    db.close();
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
