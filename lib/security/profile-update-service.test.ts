import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import { auditEvents, settings, users } from '@/lib/schema';
import { deriveNetworkDisplayName } from '@/lib/network-contract';
import {
    updateProfile,
    type ProfileUpdateServiceDependencies,
} from './profile-update-service';
import { type ServerSession } from './server-session';

type TestDatabase = NonNullable<ProfileUpdateServiceDependencies['db']>;
type AuditInput = Parameters<NonNullable<ProfileUpdateServiceDependencies['writeAuditEvent']>>[0];
const TEST_USERNAME = ['test', 'user'].join('-');

function makeDatabase() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE users (
            id TEXT PRIMARY KEY NOT NULL,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT,
            ambulatory_name TEXT,
            role TEXT,
            password_hash TEXT NOT NULL,
            encrypted_master_key TEXT NOT NULL,
            salt TEXT NOT NULL,
            failed_login_attempts INTEGER NOT NULL DEFAULT 0,
            first_failed_login_at INTEGER,
            locked_until INTEGER,
            created_at INTEGER
        );
        CREATE TABLE settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE audit_events (
            event_id TEXT PRIMARY KEY NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            event_type TEXT NOT NULL,
            occurred_at INTEGER NOT NULL,
            outcome TEXT NOT NULL,
            actor_type TEXT NOT NULL,
            actor_ref TEXT NOT NULL,
            subject_type TEXT NOT NULL,
            subject_ref TEXT,
            source_surface TEXT NOT NULL,
            request_id TEXT,
            redacted_metadata TEXT,
            created_at INTEGER
        );
    `);
    return { sqlite, db: drizzle(sqlite) as TestDatabase };
}

function session(userId: string): ServerSession {
    return {
        id: 'session-profile-test',
        userId,
        username: TEST_USERNAME,
        role: 'admin',
        authChannel: 'web',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
    };
}

function testAuditWriter(db: TestDatabase) {
    return async (input: AuditInput): Promise<string> => {
        const eventId = `audit-${Math.random()}`;
        db.insert(auditEvents).values({
            eventId,
            schemaVersion: 1,
            eventType: input.eventType,
            occurredAt: input.occurredAt ?? new Date(),
            outcome: input.outcome,
            actorType: input.actorType,
            actorRef: input.actorRef,
            subjectType: input.subjectType,
            subjectRef: input.subjectRef ?? null,
            sourceSurface: input.sourceSurface,
            requestId: input.requestId ?? null,
            redactedMetadata: input.redactedMetadata ? JSON.stringify(input.redactedMetadata) : null,
            createdAt: new Date(),
        }).run();
        return eventId;
    };
}

function seed(db: TestDatabase) {
    db.insert(users).values({
        id: 'user-1',
        username: TEST_USERNAME,
        role: 'admin',
        passwordHash: 'hash',
        encryptedMasterKey: 'blob',
        salt: 'salt',
        createdAt: new Date(),
    }).run();
    db.insert(settings).values([
        { key: 'doctorName', value: 'Dott.ssa Prima' },
        { key: 'clinicName', value: 'Ambulatorio Prima' },
    ]).run();
}

test('updateProfile atomically refreshes user, network identity settings, and profile audit', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        seed(db);
        const result = await updateProfile({
            session: session('user-1'),
            request: new Request('http://127.0.0.1/api/auth/profile'),
            displayName: 'Dott. Dopo',
            ambulatoryName: 'Ambulatorio Dopo',
        }, {
            db,
            writeAuditEvent: testAuditWriter(db),
        });

        assert.deepEqual(result, { kind: 'success' });
        const user = db.select().from(users).where(eq(users.id, 'user-1')).get();
        assert.equal(user?.displayName, 'Dott. Dopo');
        assert.equal(user?.ambulatoryName, 'Ambulatorio Dopo');

        const networkSettings = db.select().from(settings).all();
        const snapshot = Object.fromEntries(networkSettings.map((row) => [row.key, row.value]));
        assert.equal(snapshot.doctorName, 'Dott. Dopo');
        assert.equal(snapshot.clinicName, 'Ambulatorio Dopo');
        assert.equal(deriveNetworkDisplayName(snapshot, 'mediflow-mac.local'), 'Ambulatorio Dopo');

        const audit = db.select().from(auditEvents).get();
        assert.equal(audit?.subjectRef, 'profile.identity');
        assert.deepEqual(
            JSON.parse(audit?.redactedMetadata ?? '{}').changedFields,
            ['displayName', 'ambulatoryName', 'doctorName', 'clinicName'],
        );
    } finally {
        sqlite.close();
    }
});

test('updateProfile rolls back the user and both identity settings when a settings write fails', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        seed(db);
        sqlite.exec(`
            CREATE TRIGGER abort_clinic_name
            BEFORE INSERT ON settings
            WHEN NEW.key = 'clinicName'
            BEGIN
                SELECT RAISE(ABORT, 'simulated clinic settings failure');
            END;
        `);

        await assert.rejects(
            updateProfile({
                session: session('user-1'),
                request: new Request('http://127.0.0.1/api/auth/profile'),
                displayName: 'Dott. Dopo',
                ambulatoryName: 'Ambulatorio Dopo',
            }, { db, writeAuditEvent: testAuditWriter(db) }),
            /simulated clinic settings failure/,
        );

        const user = db.select().from(users).where(eq(users.id, 'user-1')).get();
        assert.equal(user?.displayName, null);
        assert.equal(user?.ambulatoryName, null);
        const snapshot = Object.fromEntries(db.select().from(settings).all().map((row) => [row.key, row.value]));
        assert.equal(snapshot.doctorName, 'Dott.ssa Prima');
        assert.equal(snapshot.clinicName, 'Ambulatorio Prima');
        assert.equal(db.select().from(auditEvents).all().length, 0);
    } finally {
        sqlite.close();
    }
});
