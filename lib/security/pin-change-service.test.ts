import assert from 'node:assert/strict';
import test from 'node:test';

import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import { auditEvents, users } from '@/lib/schema';
import {
    changePin,
    type PinChangeServiceDependencies,
} from './pin-change-service';
import { type ServerSession } from './server-session';

type TestDatabase = NonNullable<PinChangeServiceDependencies['db']>;
type AuditInput = Parameters<NonNullable<PinChangeServiceDependencies['writeAuditEvent']>>[0];
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
        id: 'session-test',
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

async function seedUser(db: TestDatabase, userId = 'user-1') {
    const passwordHash = await bcrypt.hash('1234', 10);
    db.insert(users).values({
        id: userId,
        username: TEST_USERNAME,
        role: 'admin',
        passwordHash,
        encryptedMasterKey: 'blob-before',
        salt: 'salt-before',
        failedLoginAttempts: 4,
        firstFailedLoginAt: new Date('2026-01-01T00:00:00.000Z'),
        lockedUntil: new Date('2026-01-01T00:15:00.000Z'),
        createdAt: new Date(),
    }).run();
}

test('changePin persists the client re-wrap, resets lockout, and writes a redacted audit record', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const dependencies: PinChangeServiceDependencies = {
            db,
            writeAuditEvent: testAuditWriter(db),
        };

        const result = await changePin({
            session: session('user-1'),
            request: new Request('http://127.0.0.1/api/auth/change-pin', { headers: { 'x-request-id': 'pin-test' } }),
            currentPin: '1234',
            newPin: '5678',
            encryptedMasterKey: 'v2:winner-blob',
            salt: 'winner-salt',
        }, dependencies);

        assert.deepEqual(result, { kind: 'success' });
        const updated = db.select().from(users).where(eq(users.id, 'user-1')).get();
        assert.ok(updated);
        assert.equal(await bcrypt.compare('5678', updated.passwordHash), true);
        assert.equal(await bcrypt.compare('1234', updated.passwordHash), false);
        assert.equal(updated.encryptedMasterKey, 'v2:winner-blob');
        assert.equal(updated.salt, 'winner-salt');
        assert.equal(updated.failedLoginAttempts, 0);
        assert.equal(updated.firstFailedLoginAt, null);
        assert.equal(updated.lockedUntil, null);

        const audit = db.select().from(auditEvents).get();
        assert.ok(audit);
        assert.equal(audit.eventType, 'settings.updated');
        assert.equal(audit.subjectRef, 'security.pin');
        const metadata = JSON.parse(audit.redactedMetadata ?? '{}') as Record<string, unknown>;
        assert.deepEqual(metadata.changedFields, ['passwordHash', 'encryptedMasterKey', 'salt']);
        assert.deepEqual(metadata.flags, ['credential-rotation', 'auth:session']);
        assert.equal(metadata.reasonCode, 'pin_change');
        assert.equal(JSON.stringify(metadata).includes('1234'), false);
        assert.equal(JSON.stringify(metadata).includes('5678'), false);
    } finally {
        sqlite.close();
    }
});

test('changePin compare-and-swap allows exactly one concurrent rotation', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const dependencies: PinChangeServiceDependencies = {
            db,
            writeAuditEvent: testAuditWriter(db),
        };
        const request = new Request('http://127.0.0.1/api/auth/change-pin');
        const rotations = [
            { newPin: '5678', encryptedMasterKey: 'v2:blob-a', salt: 'salt-a' },
            { newPin: '9012', encryptedMasterKey: 'v2:blob-b', salt: 'salt-b' },
        ];

        const results = await Promise.all(rotations.map((rotation) => changePin({
            session: session('user-1'),
            request,
            currentPin: '1234',
            ...rotation,
        }, dependencies)));

        assert.equal(results.filter((result) => result.kind === 'success').length, 1);
        const conflict = results.find((result) => result.kind === 'failure');
        assert.deepEqual(conflict, {
            kind: 'failure',
            status: 409,
            code: 'PIN_CHANGE_CONFLICT',
            message: 'Il PIN è stato modificato da un’altra sessione. Ricarica e riprova.',
        });

        const winnerIndex = results.findIndex((result) => result.kind === 'success');
        const winner = rotations[winnerIndex];
        const stored = db.select().from(users).where(eq(users.id, 'user-1')).get();
        assert.ok(stored);
        assert.equal(stored.encryptedMasterKey, winner.encryptedMasterKey);
        assert.equal(stored.salt, winner.salt);
        assert.equal(await bcrypt.compare(winner.newPin, stored.passwordHash), true);
    } finally {
        sqlite.close();
    }
});
