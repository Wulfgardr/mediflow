/* @Codex */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import { auditEvents, users } from '@/lib/schema';
import {
    changePin,
    PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE,
    type PinChangeServiceDependencies,
} from './pin-change-service';
import {
    abortNativeLegacyUserRetirement,
    clearAllSessions,
    commitNativeLegacyUserRetirement,
    createNativeServerSession,
    getSession,
    prepareNativeLegacyUserRetirement,
    registerServerSessionResource,
} from './server-session';
import type {
    WebAuthAttempt,
    WebAuthIssue,
    WebControlBootstrap,
    WebRetirementReceipt,
    WebSessionProjection,
    WebSessionResolution,
    WebUserRetirementCapability,
} from './web-auth-lifecycle-owner-adapter';

type TestDatabase = NonNullable<PinChangeServiceDependencies['db']>;
type AuditInput = Parameters<NonNullable<PinChangeServiceDependencies['writeAuditEvent']>>[0];
const TEST_USERNAME = ['test', 'user'].join('-');
const OTHER_USERNAME = ['synthetic', 'other'].join('-');

type SourceWebOwner = Readonly<{
    bootstrapControl(controlId?: unknown): WebControlBootstrap | null;
    begin(kind: unknown, transport: unknown): WebAuthAttempt | null;
    issue(attempt: unknown, user: unknown): WebAuthIssue | null;
    resolve(sessionId: unknown, controlId: unknown): WebSessionResolution;
    retire(projection: unknown, reason: unknown, transport?: unknown): WebRetirementReceipt;
    prepareUserRetirement(projection: unknown): WebUserRetirementCapability | null;
    commitUserRetirement(capability: unknown): WebRetirementReceipt;
    abortUserRetirement(capability: unknown): boolean;
}>;

const sourceRequire = createRequire(import.meta.url);
const { createOwner: createSourceWebOwner } = sourceRequire(
    '../../packages/web-auth-lifecycle-owner/internal/owner.cjs',
) as Readonly<{ createOwner(): SourceWebOwner }>;

test.afterEach(() => clearAllSessions());

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

function session(userId: string): WebSessionProjection {
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

function issueSourceWebSession(owner: SourceWebOwner, suffix: string, userId: string) {
    const control = owner.bootstrapControl();
    assert.ok(control);
    const attempt = owner.begin('login', {
        controlId: control.controlId,
        ifMatch: control.etag,
        idempotencyKey: `synthetic-idempotency-${suffix}`,
    });
    assert.ok(attempt);
    const issued = owner.issue(attempt, {
        id: userId,
        username: `synthetic-${suffix}`,
        role: 'admin',
    });
    assert.ok(issued);
    const resolution = owner.resolve(issued.sessionId, control.controlId);
    assert.equal(resolution.status, 'active');
    if (resolution.status !== 'active') throw new Error('synthetic session was not activated');
    return { control, issued, projection: resolution.projection };
}

function databaseWithTransactionTail(db: TestDatabase, tail: () => void): TestDatabase {
    return new Proxy(db, {
        get(target, property, receiver) {
            if (property === 'transaction') {
                return (operation: unknown) => {
                    const transaction = Reflect.get(target, property, target) as (input: unknown) => unknown;
                    const result = Reflect.apply(transaction, target, [operation]);
                    tail();
                    return result;
                };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    }) as TestDatabase;
}

function webRetirement(
    outcome: 'completed' | 'failed' | 'denied' = 'completed',
    expected?: WebSessionProjection,
): Pick<PinChangeServiceDependencies,
    'prepareWebSessionsForUserRetirement' | 'commitWebSessionsForUserRetirement'
    | 'abortWebSessionsForUserRetirement'> {
    const prepared = new Set<unknown>();
    return {
        prepareWebSessionsForUserRetirement: (projection) => {
            if (expected) assert.equal(projection, expected);
            const capability = Object.freeze({});
            prepared.add(capability);
            return capability;
        },
        commitWebSessionsForUserRetirement: (capability) => Object.freeze({
            outcome: prepared.delete(capability) ? outcome : 'denied',
        }),
        abortWebSessionsForUserRetirement: (capability) => prepared.delete(capability),
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
        const projection = session('user-1');
        const dependencies: PinChangeServiceDependencies = {
            db,
            writeAuditEvent: testAuditWriter(db),
            ...webRetirement('completed', projection),
        };

        const result = await changePin({
            session: projection,
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

test('changePin removes all old sessions and session-scoped resources only after a successful rotation', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const active = createNativeServerSession(
            { id: 'user-1', username: TEST_USERNAME, role: 'admin' },
            { clientId: 'synthetic-active', clientPlatform: 'macos' },
        );
        const sibling = createNativeServerSession(
            { id: 'user-1', username: TEST_USERNAME, role: 'admin' },
            { clientId: 'synthetic-sibling', clientPlatform: 'ios' },
        );
        const otherUser = createNativeServerSession(
            { id: 'user-2', username: OTHER_USERNAME, role: 'admin' },
            { clientId: 'synthetic-other', clientPlatform: 'ipados' },
        );
        const disposals: string[] = [];
        registerServerSessionResource(active.id, (reason) => { disposals.push(`active:${reason}`); });
        registerServerSessionResource(sibling.id, (reason) => { disposals.push(`sibling:${reason}`); });
        registerServerSessionResource(otherUser.id, (reason) => { disposals.push(`other:${reason}`); });

        const result = await changePin({
            session: session('user-1'),
            request: new Request('http://127.0.0.1/api/auth/change-pin'),
            currentPin: '1234',
            newPin: '5678',
            encryptedMasterKey: 'v2:rotated-blob',
            salt: 'rotated-salt',
        }, {
            db,
            writeAuditEvent: testAuditWriter(db),
            ...webRetirement(),
        });

        assert.deepEqual(result, { kind: 'success' });
        assert.equal(getSession(active.id), null);
        assert.equal(getSession(sibling.id), null);
        assert.equal(getSession(otherUser.id), otherUser);
        assert.deepEqual(disposals, ['active:session_deleted', 'sibling:session_deleted']);
    } finally {
        sqlite.close();
    }
});

test('changePin preserves sessions when the credential rotation is rejected', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const active = createNativeServerSession(
            { id: 'user-1', username: TEST_USERNAME, role: 'admin' },
            { clientId: 'synthetic-active', clientPlatform: 'macos' },
        );
        const disposals: string[] = [];
        registerServerSessionResource(active.id, (reason) => { disposals.push(reason); });

        const result = await changePin({
            session: session('user-1'),
            request: new Request('http://127.0.0.1/api/auth/change-pin'),
            currentPin: '0000',
            newPin: '5678',
            encryptedMasterKey: 'v2:unchanged-blob',
            salt: 'unchanged-salt',
        }, {
            db,
            writeAuditEvent: testAuditWriter(db),
            ...webRetirement(),
        });

        assert.equal(result.kind, 'failure');
        assert.equal(getSession(active.id), active);
        assert.deepEqual(disposals, []);
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
            ...webRetirement(),
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

test('changePin does not mutate credentials when native retirement cannot be prepared', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const result = await changePin({
            session: session('user-1'),
            request: new Request('http://127.0.0.1/api/auth/change-pin'),
            currentPin: '1234',
            newPin: '5678',
            encryptedMasterKey: 'v2:not-written',
            salt: 'not-written',
        }, {
            db,
            ...webRetirement(),
            prepareNativeSessionsForUserRetirement: () => null,
        });

        assert.deepEqual(result, {
            kind: 'failure',
            status: 409,
            code: PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE,
            message: 'La rotazione delle credenziali non può essere confermata. Riprova dopo un nuovo accesso.',
        });
        const stored = db.select().from(users).where(eq(users.id, 'user-1')).get();
        assert.ok(stored);
        assert.equal(await bcrypt.compare('1234', stored.passwordHash), true);
        assert.equal(stored.encryptedMasterKey, 'blob-before');
        assert.equal(stored.salt, 'salt-before');
    } finally {
        sqlite.close();
    }
});

test('changePin denies confirmation after CAS when Web retirement is not terminally completed', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const native = createNativeServerSession(
            { id: 'user-1', username: TEST_USERNAME, role: 'admin' },
            { clientId: 'synthetic-active', clientPlatform: 'macos' },
        );
        const result = await changePin({
            session: session('user-1'),
            request: new Request('http://127.0.0.1/api/auth/change-pin'),
            currentPin: '1234',
            newPin: '5678',
            encryptedMasterKey: 'v2:written-before-denial',
            salt: 'written-before-denial',
        }, {
            db,
            ...webRetirement('denied'),
        });

        assert.deepEqual(result, {
            kind: 'failure',
            status: 409,
            code: PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE,
            message: 'La rotazione delle credenziali non può essere confermata. Accedi di nuovo.',
        });
        assert.equal(getSession(native.id), null);
        const stored = db.select().from(users).where(eq(users.id, 'user-1')).get();
        assert.ok(stored);
        assert.equal(await bcrypt.compare('5678', stored.passwordHash), true);
    } finally {
        sqlite.close();
    }
});

test('changePin keeps every same-user Web sibling terminal when lock wins after the credential CAS', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const owner = createSourceWebOwner();
        const initiator = issueSourceWebSession(owner, 'pin-race-initiator', 'user-1');
        const sibling = issueSourceWebSession(owner, 'pin-race-sibling', 'user-1');
        const other = issueSourceWebSession(owner, 'pin-race-other', 'user-2');
        const events: string[] = [];
        const raceDb = databaseWithTransactionTail(db, () => {
            events.push('credential.cas');
            const locked = owner.retire(initiator.projection, 'lock', {
                controlId: initiator.control.controlId,
                ifMatch: initiator.issued.etag,
                idempotencyKey: 'synthetic-idempotency-pin-race-lock',
            });
            assert.equal(locked.outcome, 'completed');
            events.push('initiator.lock');
        });
        const persistAudit = testAuditWriter(db);

        const result = await changePin({
            session: initiator.projection,
            request: new Request('http://127.0.0.1/api/auth/change-pin'),
            currentPin: '1234',
            newPin: '5678',
            encryptedMasterKey: 'v2:race-winner',
            salt: 'race-winner-salt',
        }, {
            db: raceDb,
            prepareNativeSessionsForUserRetirement: (userId) => {
                events.push('native.prepare');
                return prepareNativeLegacyUserRetirement(userId);
            },
            commitNativeSessionsForUserRetirement: (capability) => {
                events.push('native.commit');
                return commitNativeLegacyUserRetirement(capability);
            },
            abortNativeSessionsForUserRetirement: (capability) => {
                events.push('native.abort');
                return abortNativeLegacyUserRetirement(capability);
            },
            prepareWebSessionsForUserRetirement: (projection) => {
                events.push('web.prepare');
                return owner.prepareUserRetirement(projection);
            },
            commitWebSessionsForUserRetirement: (capability) => {
                events.push('web.commit');
                return owner.commitUserRetirement(capability);
            },
            abortWebSessionsForUserRetirement: (capability) => {
                events.push('web.abort');
                return owner.abortUserRetirement(capability);
            },
            writeAuditEvent: async (input) => {
                events.push('audit');
                return persistAudit(input);
            },
        });

        assert.deepEqual(result, { kind: 'success' });
        assert.deepEqual(events, [
            'native.prepare',
            'web.prepare',
            'credential.cas',
            'initiator.lock',
            'web.commit',
            'native.commit',
            'audit',
        ]);
        assert.equal(owner.resolve(initiator.issued.sessionId, initiator.control.controlId).status, 'owned_denied');
        assert.equal(owner.resolve(sibling.issued.sessionId, sibling.control.controlId).status, 'owned_denied');
        assert.equal(owner.resolve(other.issued.sessionId, other.control.controlId).status, 'active');
        const stored = db.select().from(users).where(eq(users.id, 'user-1')).get();
        assert.ok(stored);
        assert.equal(await bcrypt.compare('5678', stored.passwordHash), true);
    } finally {
        sqlite.close();
    }
});
