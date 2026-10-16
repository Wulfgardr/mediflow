import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import { auditEvents, users } from '@/lib/schema';
import {
    adoptPassphrase,
    changePin,
    PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE,
    type PinChangeServiceDependencies,
    recoverPassphrase,
    changePassphrase,
} from './pin-change-service';
import { verifyHostCredentials, verifyUnlockCredentials } from './host-credential-verification';
import { validatePassphraseAdoptionPayload, validatePassphraseChangePayload, validatePassphraseRecoveryPayload } from './passphrase-adoption-validation';
import { generateMasterKey } from './security';
import { createRecoveryWrapping, createUnlockWrapping, deriveUnlockMaterial, hashAccessVerifier, openUnlockWrapping } from './unlock-credential';
import {
    abortNativeLegacyUserRetirement,
    captureNativeLoginSessionFence,
    clearAllSessions,
    commitNativeLegacyUserRetirement,
    createNativeServerSession,
    getSession,
    isPairedNativeServerSession,
    prepareNativeLegacyUserRetirement,
    registerServerSessionResource,
} from './server-session';
import * as physicalWebOwner from './web-auth-lifecycle-owner-adapter';
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
const TEST_GENERATION = 'c15c15c1-1111-4111-8111-111111111111';
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
        CREATE TABLE archive_generation (id INTEGER PRIMARY KEY, generation TEXT NOT NULL);
        INSERT INTO archive_generation VALUES (1, '${TEST_GENERATION}');
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
            unlock_verifier_hash TEXT,
            recovery_wrapped_master_key TEXT,
            recovery_salt TEXT,
            recovery_verifier_hash TEXT,
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

/* service tests use the real shared owner, with a bounded request-reader seam. */
function nativePinSession(userId = 'user-1') {
    const binding = { clientId: 'synthetic-pin-ios', clientPlatform: 'ios' as const, tokenHash: 'a'.repeat(64) };
    const native = createNativeServerSession(
        { id: userId, username: TEST_USERNAME, role: 'admin' }, binding, captureNativeLoginSessionFence(),
    );
    assert.ok(isPairedNativeServerSession(native, binding));
    return native;
}

test('native PIN rotation retires both real channel owners and preserves another user', async () => {
    const { sqlite, db } = makeDatabase();
    const web = issueSourceWebSession(physicalWebOwner, 'native-pin-web', 'user-1');
    const other = issueSourceWebSession(physicalWebOwner, 'native-pin-other', 'other-user');
    try {
        await seedUser(db);
        const native = nativePinSession(); const sibling = nativePinSession();
        const result = await changePin({ archiveGeneration: TEST_GENERATION,
            session: native, request: new Request('http://127.0.0.1/api/auth/change-pin'),
            currentPin: '1234', newPin: '5678', encryptedMasterKey: 'v2:native-rewrap', salt: 'native-salt',
        }, { db, readPairedNativeSession: async () => native, writeAuditEvent: testAuditWriter(db) });
        assert.deepEqual(result, { kind: 'success' });
        assert.equal(getSession(native.id), null); assert.equal(getSession(sibling.id), null);
        assert.notEqual(physicalWebOwner.resolve(web.issued.sessionId, web.control.controlId).status, 'active');
        assert.equal(physicalWebOwner.resolve(other.issued.sessionId, other.control.controlId).status, 'active');
        const stored = db.select().from(users).where(eq(users.id, 'user-1')).get(); assert.ok(stored);
        assert.equal(await bcrypt.compare('5678', stored.passwordHash), true);
        assert.equal(stored.encryptedMasterKey, 'v2:native-rewrap');
    } finally {
        physicalWebOwner.retire(other.projection, 'delete');
        physicalWebOwner.retire(web.projection, 'delete');
        sqlite.close();
    }
});

test('a native request becoming stale during hashing aborts both preparations before credential CAS', async () => {
    const { sqlite, db } = makeDatabase();
    const web = issueSourceWebSession(physicalWebOwner, 'native-pin-stale', 'user-1');
    try {
        await seedUser(db); const native = nativePinSession(); let reads = 0;
        const result = await changePin({ archiveGeneration: TEST_GENERATION,
            session: native, request: new Request('http://127.0.0.1/api/auth/change-pin'),
            currentPin: '1234', newPin: '5678', encryptedMasterKey: 'v2:must-not-save', salt: 'must-not-save',
        }, { db, readPairedNativeSession: async () => ++reads === 1 ? native : null });
        assert.deepEqual(result, { kind: 'unauthorized' });
        assert.equal(reads, 2);
        assert.equal(getSession(native.id), native);
        assert.equal(physicalWebOwner.resolve(web.issued.sessionId, web.control.controlId).status, 'active');
        assert.equal(db.select().from(users).where(eq(users.id, 'user-1')).get()?.encryptedMasterKey, 'blob-before');
    } finally { physicalWebOwner.retire(web.projection, 'delete'); sqlite.close(); }
});

test('native PIN CAS conflict preserves the winning credential and existing channel sessions', async () => {
    const { sqlite, db } = makeDatabase();
    const web = issueSourceWebSession(physicalWebOwner, 'native-pin-conflict', 'user-1');
    try {
        await seedUser(db); const native = nativePinSession(); let reads = 0;
        const result = await changePin({ archiveGeneration: TEST_GENERATION,
            session: native, request: new Request('http://127.0.0.1/api/auth/change-pin'),
            currentPin: '1234', newPin: '5678', encryptedMasterKey: 'v2:loser', salt: 'loser',
        }, { db, readPairedNativeSession: async () => {
            if (++reads === 2) db.update(users).set({ passwordHash: 'synthetic-winner-hash', encryptedMasterKey: 'v2:winner' })
                .where(eq(users.id, 'user-1')).run();
            return native;
        } });
        assert.equal(result.kind, 'failure');
        if (result.kind === 'failure') assert.equal(result.code, 'PIN_CHANGE_CONFLICT');
        assert.equal(getSession(native.id), native);
        assert.equal(physicalWebOwner.resolve(web.issued.sessionId, web.control.controlId).status, 'active');
        assert.equal(db.select().from(users).where(eq(users.id, 'user-1')).get()?.encryptedMasterKey, 'v2:winner');
    } finally { physicalWebOwner.retire(web.projection, 'delete'); sqlite.close(); }
});

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

        const result = await changePin({ archiveGeneration: TEST_GENERATION,
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

        const result = await changePin({ archiveGeneration: TEST_GENERATION,
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

        const result = await changePin({ archiveGeneration: TEST_GENERATION,
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

test('changePin never replaces the wrapping of an account that unlocks with a passphrase', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        db.update(users).set({ unlockVerifierHash: 'a'.repeat(64), encryptedMasterKey: 'v3:passphrase-wrapping' }).run();
        const before = db.select().from(users).get();
        let retirements = 0;
        // The current PIN is the right one: it is the authority of the PIN over the wrapping that is gone.
        const result = await changePin({ archiveGeneration: TEST_GENERATION,
            session: session('user-1'),
            request: new Request('http://127.0.0.1/api/auth/change-pin'),
            currentPin: '1234',
            newPin: '5678',
            encryptedMasterKey: 'v2:pin-wrapping',
            salt: 'pin-salt',
        }, {
            db,
            writeAuditEvent: testAuditWriter(db),
            ...webRetirement(),
            prepareWebSessionsForUserRetirement: () => { retirements += 1; return null; },
        });

        assert.deepEqual(result.kind === 'failure' && [result.status, result.code], [409, 'PIN_CHANGE_PASSPHRASE_ACCOUNT']);
        assert.deepEqual(db.select().from(users).get(), before);
        assert.equal(retirements, 0, 'no session is retired for a rotation that cannot happen');
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

        const results = await Promise.all(rotations.map((rotation) => changePin({ archiveGeneration: TEST_GENERATION,
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
        const result = await changePin({ archiveGeneration: TEST_GENERATION,
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
        const result = await changePin({ archiveGeneration: TEST_GENERATION,
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

        const result = await changePin({ archiveGeneration: TEST_GENERATION,
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

/** What the browser sends, made with the browser primitives at their production cost (ADR 0143). */
async function adoptionPayload(currentPin = '1234') {
    const masterKey = await generateMasterKey();
    const unlock = await createUnlockWrapping(masterKey, 'cavallo batteria graffetta corretta');
    const recovery = await createRecoveryWrapping(masterKey);
    const payload = validatePassphraseAdoptionPayload({
        currentPin, encryptedMasterKey: unlock.encryptedMasterKey, salt: unlock.salt, verifier: unlock.verifier,
        recovery: { wrappedMasterKey: recovery.wrappedMasterKey, salt: recovery.salt, verifier: recovery.verifier },
    });
    assert.ok(payload, 'the server accepts what the browser primitives produce');
    return { payload, unlock, recovery, masterKey };
}
const SEEDED_PIN = '1234'; // the PIN seedUser gives the account
const adoptionRequest = () => new Request('http://127.0.0.1/api/auth/passphrase', { headers: { 'x-request-id': 'adoption-test' } });
const storedUser = (db: TestDatabase) => db.select().from(users).where(eq(users.id, 'user-1')).get()!;
const credentialColumns = (db: TestDatabase) => {
    const { passwordHash, encryptedMasterKey, salt, unlockVerifierHash, recoveryWrappedMasterKey, recoverySalt, recoveryVerifierHash } = storedUser(db);
    return { passwordHash, encryptedMasterKey, salt, unlockVerifierHash, recoveryWrappedMasterKey, recoverySalt, recoveryVerifierHash };
};

/** Stands for the removal of what still holds the PIN wrapping beside the archive, and records whom it ran for. */
function residueRemoval(complete = true) {
    const runs: string[] = [];
    const retirePinEraResidues: NonNullable<PinChangeServiceDependencies['retirePinEraResidues']> = (userId) => {
        runs.push(userId);
        return { removed: [], kept: [], logEmptied: complete, complete };
    };
    return { runs, retirePinEraResidues };
}

test('adoptPassphrase moves the account to the passphrase in one write and keeps the PIN for confirmations', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const before = storedUser(db);
        const projection = session('user-1');
        const { payload, unlock, recovery } = await adoptionPayload();
        const residues = residueRemoval();
        const dependencies: PinChangeServiceDependencies = {
            db, writeAuditEvent: testAuditWriter(db), ...webRetirement('completed', projection), retirePinEraResidues: residues.retirePinEraResidues,
        };

        assert.deepEqual(await adoptPassphrase({ archiveGeneration: TEST_GENERATION, session: projection, request: adoptionRequest(), payload }, dependencies), { kind: 'success', earlierCopiesCleared: true });
        assert.deepEqual(residues.runs, ['user-1'], 'what still held the PIN wrapping beside the archive is removed for this account');

        assert.deepEqual(storedUser(db), {
            ...before,
            encryptedMasterKey: unlock.encryptedMasterKey,
            salt: unlock.salt,
            unlockVerifierHash: await hashAccessVerifier(unlock.verifier),
            recoveryWrappedMasterKey: recovery.wrappedMasterKey,
            recoverySalt: recovery.salt,
            recoveryVerifierHash: await hashAccessVerifier(recovery.verifier),
            failedLoginAttempts: 0, firstFailedLoginAt: null, lockedUntil: null,
        }, 'the PIN hash is the only credential column left as it was');

        const quiet = { db, writeAuditEvent: async () => 'audit' };
        assert.equal((await verifyUnlockCredentials({ username: TEST_USERNAME, verifier: unlock.verifier }, quiet)).kind, 'verified');
        assert.equal((await verifyUnlockCredentials({ username: TEST_USERNAME, pin: SEEDED_PIN }, quiet)).kind, 'denied');
        assert.equal((await verifyHostCredentials({ username: TEST_USERNAME, pin: SEEDED_PIN }, quiet)).kind, 'verified');

        const audit = db.select().from(auditEvents).get();
        assert.equal(audit?.subjectRef, 'security.unlock-credential');
        const metadata = JSON.parse(audit?.redactedMetadata ?? '{}') as Record<string, unknown>;
        assert.equal(metadata.reasonCode, 'passphrase_adopted');
        for (const secret of ['1234', unlock.verifier, recovery.verifier, recovery.recoveryKey]) {
            assert.equal(JSON.stringify(audit).includes(secret), false, 'no secret reaches the audit record');
        }
    } finally {
        sqlite.close();
    }
});

test('adoptPassphrase needs the current PIN and happens once: the PIN cannot replace a passphrase', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const before = credentialColumns(db);
        let prepared = 0;
        const retirement = webRetirement();
        const residues = residueRemoval();
        const dependencies: PinChangeServiceDependencies = {
            db, writeAuditEvent: testAuditWriter(db), ...retirement, retirePinEraResidues: residues.retirePinEraResidues,
            prepareWebSessionsForUserRetirement: (projection) => { prepared += 1; return retirement.prepareWebSessionsForUserRetirement!(projection); },
        };
        const adopt = (payload: Awaited<ReturnType<typeof adoptionPayload>>['payload']) =>
            adoptPassphrase({ archiveGeneration: TEST_GENERATION, session: session('user-1'), request: adoptionRequest(), payload }, dependencies);

        const wrongPin = await adopt((await adoptionPayload('0000')).payload);
        assert.deepEqual(wrongPin.kind === 'failure' && [wrongPin.status, wrongPin.code], [401, 'PASSPHRASE_ADOPTION_INVALID_PIN']);
        assert.deepEqual(credentialColumns(db), before);
        assert.equal(storedUser(db).failedLoginAttempts, 1, 'a wrong PIN is counted here as it is at login');
        assert.equal(prepared, 0, 'no session is prepared for retirement before the PIN is verified');
        assert.deepEqual(residues.runs, [], 'and no copy of the archive is touched');

        assert.deepEqual(await adopt((await adoptionPayload()).payload), { kind: 'success', earlierCopiesCleared: true });
        const adopted = storedUser(db);

        // The right PIN and a well-formed request, again: this is how a PIN would take the archive back.
        const again = await adopt((await adoptionPayload()).payload);
        assert.deepEqual(again.kind === 'failure' && [again.status, again.code], [409, 'PASSPHRASE_ALREADY_ADOPTED']);
        assert.deepEqual(storedUser(db), adopted);
        assert.equal(prepared, 1);
        assert.deepEqual(residues.runs, ['user-1'], 'only the move itself removes the copies');
    } finally {
        sqlite.close();
    }
});

test('two adoptions at once leave one whole set of credentials, never a mix', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const residues = residueRemoval(false);
        const dependencies: PinChangeServiceDependencies = { db, writeAuditEvent: testAuditWriter(db), ...webRetirement(), retirePinEraResidues: residues.retirePinEraResidues };
        const candidates = await Promise.all([adoptionPayload(), adoptionPayload()]);
        const results = await Promise.all(candidates.map(({ payload }) =>
            adoptPassphrase({ archiveGeneration: TEST_GENERATION, session: session('user-1'), request: adoptionRequest(), payload }, dependencies)));

        assert.equal(results.filter((result) => result.kind === 'success').length, 1);
        assert.deepEqual(results.find((result) => result.kind === 'success'), { kind: 'success', earlierCopiesCleared: false },
            'the move says when something that holds the PIN wrapping could not be cleared');
        assert.deepEqual(residues.runs, ['user-1'], 'the adoption that lost removes nothing');
        const winner = candidates[results.findIndex((result) => result.kind === 'success')];
        const stored = storedUser(db);
        assert.deepEqual(
            [stored.encryptedMasterKey, stored.salt, stored.unlockVerifierHash, stored.recoveryWrappedMasterKey, stored.recoverySalt, stored.recoveryVerifierHash],
            [winner.unlock.encryptedMasterKey, winner.unlock.salt, await hashAccessVerifier(winner.unlock.verifier),
                winner.recovery.wrappedMasterKey, winner.recovery.salt, await hashAccessVerifier(winner.recovery.verifier)],
        );
    } finally {
        sqlite.close();
    }
});

test('an interruption inside the write leaves the PIN account as it was, with its sessions', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        db.update(users).set({ failedLoginAttempts: 0, firstFailedLoginAt: null, lockedUntil: null }).run();
        const before = storedUser(db);
        const interrupted = new Proxy(db, {
            get(target, property, receiver) {
                if (property === 'transaction') return () => { throw new Error('synthetic interruption'); };
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }) as TestDatabase;
        const outcomes: string[] = [];
        const retirement = webRetirement();
        const residues = residueRemoval();
        const { payload } = await adoptionPayload();

        await assert.rejects(() => adoptPassphrase({ archiveGeneration: TEST_GENERATION, session: session('user-1'), request: adoptionRequest(), payload }, {
            db: interrupted, writeAuditEvent: testAuditWriter(db), ...retirement, retirePinEraResidues: residues.retirePinEraResidues,
            commitWebSessionsForUserRetirement: (capability) => { outcomes.push('committed'); return retirement.commitWebSessionsForUserRetirement!(capability); },
            abortWebSessionsForUserRetirement: (capability) => { outcomes.push('aborted'); return retirement.abortWebSessionsForUserRetirement!(capability); },
        }), /synthetic interruption/u);

        assert.deepEqual(storedUser(db), before);
        assert.deepEqual(outcomes, ['aborted'], 'the sessions prepared for retirement are released, not retired');
        assert.deepEqual(residues.runs, [], 'the copies of an account still on its PIN are its safety net: they stay');
        const quiet = { db, writeAuditEvent: async () => 'audit' };
        assert.equal((await verifyUnlockCredentials({ username: TEST_USERNAME, pin: SEEDED_PIN }, quiet)).kind, 'verified');
    } finally {
        sqlite.close();
    }
});

test('when the retirement of the sessions cannot be confirmed the passphrase is already the credential', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const { payload, unlock } = await adoptionPayload();
        const residues = residueRemoval();
        const result = await adoptPassphrase({ archiveGeneration: TEST_GENERATION, session: session('user-1'), request: adoptionRequest(), payload }, {
            db, writeAuditEvent: testAuditWriter(db), ...webRetirement('failed'), retirePinEraResidues: residues.retirePinEraResidues,
        });
        assert.deepEqual(result.kind === 'failure' && [result.status, result.code], [409, PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE]);
        assert.match(result.kind === 'failure' ? result.message : '', /passphrase è attiva/u);
        assert.deepEqual(residues.runs, ['user-1'], 'the PIN wrapping beside the archive goes all the same: the passphrase is the credential');
        assert.equal(storedUser(db).unlockVerifierHash, await hashAccessVerifier(unlock.verifier));
    } finally {
        sqlite.close();
    }
});

test('the adoption request is accepted only in the shapes the browser primitives produce', async () => {
    const { payload } = await adoptionPayload();
    const rejected: Array<[string, unknown]> = [
        ['a PIN wrapping in place of the passphrase one', { ...payload, encryptedMasterKey: `v2:${payload.encryptedMasterKey.slice(3)}` }],
        ['a truncated wrapping', { ...payload, encryptedMasterKey: payload.encryptedMasterKey.slice(0, -4) }],
        ['a recovery wrapping labelled as a passphrase one', { ...payload, recovery: { ...payload.recovery, wrappedMasterKey: payload.encryptedMasterKey } }],
        ['a short verifier', { ...payload, verifier: Buffer.alloc(16, 1).toString('base64') }],
        ['one verifier for both secrets', { ...payload, recovery: { ...payload.recovery, verifier: payload.verifier } }],
        ['one salt for both wrappings', { ...payload, recovery: { ...payload.recovery, salt: payload.salt } }],
        ['no recovery wrapping', { ...payload, recovery: undefined }],
        ['no current PIN', { ...payload, currentPin: '' }],
        ['not an object', 'v3:'],
    ];
    for (const [name, candidate] of rejected) assert.equal(validatePassphraseAdoptionPayload(candidate), null, name);
    assert.deepEqual(validatePassphraseAdoptionPayload({ ...payload, unexpected: 'ignored' }), payload);
});

test('a session cannot guess the PIN through the adoption: wrong PINs lock the account, and a lock stops the right one', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        db.update(users).set({ failedLoginAttempts: 0, firstFailedLoginAt: null, lockedUntil: null }).run();
        const before = credentialColumns(db);
        const dependencies: PinChangeServiceDependencies = { db, writeAuditEvent: testAuditWriter(db), ...webRetirement() };
        const adopt = async (pin: string) =>
            adoptPassphrase({ archiveGeneration: TEST_GENERATION, session: session('user-1'), request: adoptionRequest(), payload: (await adoptionPayload(pin)).payload }, dependencies);

        for (let attempt = 1; attempt <= 4; attempt += 1) {
            const wrong = await adopt('0000');
            assert.deepEqual(wrong.kind === 'failure' && wrong.status, 401, `attempt ${attempt}`);
        }
        const fifth = await adopt('0000');
        assert.deepEqual(fifth.kind === 'failure' && [fifth.status, fifth.code], [423, 'AUTH_LOCKED']);
        const whileLocked = await adopt(SEEDED_PIN);
        assert.deepEqual(whileLocked.kind === 'failure' && whileLocked.status, 423);
        assert.deepEqual(credentialColumns(db), before);
        assert.ok(storedUser(db).lockedUntil, 'the lock stands');
    } finally {
        sqlite.close();
    }
});

test('a lock established after the PIN was verified is not cleared by the adoption', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const before = credentialColumns(db);
        const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
        const result = await adoptPassphrase({ archiveGeneration: TEST_GENERATION, session: session('user-1'), request: adoptionRequest(), payload: (await adoptionPayload()).payload }, {
            db, writeAuditEvent: testAuditWriter(db), ...webRetirement(),
            // The PIN is verified, then five wrong attempts elsewhere lock the account before the write.
            verifyPin: async (input, verifierDependencies) => {
                const { verifyHostCredentials: verify } = await import('./host-credential-verification');
                const verified = await verify(input, verifierDependencies);
                db.update(users).set({ failedLoginAttempts: 5, lockedUntil }).run();
                return verified;
            },
        });
        assert.deepEqual(result.kind === 'failure' && result.code, 'PASSPHRASE_ADOPTION_CONFLICT');
        assert.deepEqual(credentialColumns(db), before);
        assert.equal(storedUser(db).lockedUntil?.getTime(), Math.floor(lockedUntil.getTime() / 1000) * 1000);
    } finally {
        sqlite.close();
    }
});

/** A new passphrase and a new recovery key, authorized by the verifier of the recovery key being replaced. */
async function recoveryPayload(recoveryVerifier: string) {
    const masterKey = await generateMasterKey();
    const unlock = await createUnlockWrapping(masterKey, 'una passphrase del tutto nuova');
    const recovery = await createRecoveryWrapping(masterKey);
    const payload = validatePassphraseRecoveryPayload({
        username: TEST_USERNAME, recoveryVerifier,
        encryptedMasterKey: unlock.encryptedMasterKey, salt: unlock.salt, verifier: unlock.verifier,
        recovery: { wrappedMasterKey: recovery.wrappedMasterKey, salt: recovery.salt, verifier: recovery.verifier },
    });
    assert.ok(payload, 'the server accepts what the browser primitives produce');
    return { payload, unlock, recovery };
}
const recoveryRequest = () => new Request('http://127.0.0.1/api/auth/passphrase/recover', { headers: { 'x-request-id': 'recovery-test' } });

/** The session the route opens for a recovery through the Web auth control, and what became of it. */
function recoverySession(available = true) {
    const opened: WebSessionProjection[] = [];
    const closed: WebSessionProjection[] = [];
    return {
        opened, closed,
        openSession: (account: { id: string }) => {
            if (!available) return null;
            opened.push(session(account.id));
            return opened.at(-1)!;
        },
        retireWebSession: (projection: WebSessionProjection) => { closed.push(projection); },
    };
}
/** A recovery asked with `recoveryVerifier`, with the retirement of the sessions ending in `outcome`. */
async function recover(db: TestDatabase, recoveryVerifier: string, options: {
    outcome?: 'completed' | 'failed'; own?: ReturnType<typeof recoverySession>; dependencies?: PinChangeServiceDependencies;
} = {}) {
    const own = options.own ?? recoverySession();
    const candidate = await recoveryPayload(recoveryVerifier);
    const result = await recoverPassphrase({ archiveGeneration: TEST_GENERATION, request: recoveryRequest(), payload: candidate.payload, openSession: own.openSession }, {
        db, writeAuditEvent: testAuditWriter(db), ...webRetirement(options.outcome ?? 'completed'), retireWebSession: own.retireWebSession,
        ...options.dependencies,
    });
    return { result, own, ...candidate };
}
async function adoptedAccount(db: TestDatabase) {
    await seedUser(db);
    const adoption = await adoptionPayload();
    assert.equal((await adoptPassphrase({ archiveGeneration: TEST_GENERATION, session: session('user-1'), request: adoptionRequest(), payload: adoption.payload }, {
        db, writeAuditEvent: testAuditWriter(db), ...webRetirement(), retirePinEraResidues: residueRemoval().retirePinEraResidues,
    })).kind, 'success');
    return adoption;
}

test('changing a passphrase preserves encrypted history, retires sessions and rejects the previous verifier', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        const adopted = await adoptedAccount(db);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const text = new TextEncoder().encode('synthetic history before rotation');
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, adopted.masterKey, text);
        const unlock = await createUnlockWrapping(adopted.masterKey, 'una passphrase del tutto nuova');
        const recovery = await createRecoveryWrapping(adopted.masterKey);
        const payload = validatePassphraseChangePayload({ ...unlock, recovery, currentVerifier: adopted.unlock.verifier });
        assert.ok(payload);
        const projection = session('user-1');
        const retirement = webRetirement();
        let retired: unknown = null;
        const dependencies = {
            db, writeAuditEvent: testAuditWriter(db), ...retirement,
            prepareWebSessionsForUserRetirement: (value: unknown) => {
                retired = value; return retirement.prepareWebSessionsForUserRetirement!(value);
            },
        };
        const result = await changePassphrase({ archiveGeneration: TEST_GENERATION, session: projection, request: adoptionRequest(), payload }, dependencies);
        assert.equal(result.kind, 'success');
        assert.equal(retired, projection);
        const material = await deriveUnlockMaterial('una passphrase del tutto nuova', Buffer.from(unlock.salt, 'base64'));
        const reopened = await openUnlockWrapping(storedUser(db).encryptedMasterKey, material.kek);
        assert.deepEqual(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, reopened, ciphertext)), text);
        const before = credentialColumns(db);
        const denied = await changePassphrase({ archiveGeneration: TEST_GENERATION, session: projection, request: adoptionRequest(), payload }, dependencies);
        assert.equal(denied.kind === 'denied' && denied.status, 401);
        assert.deepEqual(credentialColumns(db), before);
        assert.equal(storedUser(db).failedLoginAttempts, 1);
        const audit = db.select().from(auditEvents).all().findLast((event) => JSON.parse(event.redactedMetadata ?? '{}').reasonCode === 'passphrase_changed');
        assert.ok(audit);
        for (const secret of [payload.currentVerifier, unlock.verifier, recovery.verifier, recovery.recoveryKey]) {
            assert.equal(JSON.stringify(audit).includes(secret), false);
        }
    } finally { sqlite.close(); }
});

test('a concurrent credential change or an unavailable retirement leaves the proposed passphrase unapplied', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        const adopted = await adoptedAccount(db);
        const candidate = await recoveryPayload(adopted.recovery.verifier);
        const payload = validatePassphraseChangePayload({ ...candidate.payload, currentVerifier: adopted.unlock.verifier });
        assert.ok(payload);
        const input = { archiveGeneration: TEST_GENERATION, session: session('user-1'), request: adoptionRequest(), payload };
        const before = credentialColumns(db);
        const refused = await changePassphrase(input, {
            db, ...webRetirement(), prepareWebSessionsForUserRetirement: () => null,
        });
        assert.equal(refused.kind === 'failure' && refused.status, 409);
        assert.deepEqual(credentialColumns(db), before);
        const winnerHash = await hashAccessVerifier(candidate.unlock.verifier);
        const raced = await changePassphrase(input, {
            db, ...webRetirement(), writeAuditEvent: testAuditWriter(db),
            verifyUnlock: async (credential, dependencies) => {
                const verified = await verifyUnlockCredentials(credential, dependencies);
                db.update(users).set({ unlockVerifierHash: winnerHash }).run();
                return verified;
            },
        });
        assert.equal(raced.kind === 'failure' && raced.status, 409);
        assert.deepEqual(credentialColumns(db), { ...before, unlockVerifierHash: winnerHash });
    } finally { sqlite.close(); }
});

test('recoverPassphrase sets a new passphrase and a new recovery key in one write, for whoever holds the old recovery key', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        const adopted = await adoptedAccount(db);
        const before = credentialColumns(db);
        db.update(users).set({ failedLoginAttempts: 3, firstFailedLoginAt: new Date() }).run();
        const own = recoverySession();
        let retired: unknown = null;
        const retirement = webRetirement();

        const { result, unlock, recovery } = await recover(db, adopted.recovery.verifier, { own, dependencies: {
            // The owner retires the sessions of an account only for an authentic session of that account.
            prepareWebSessionsForUserRetirement: (projection) => { retired = projection; return retirement.prepareWebSessionsForUserRetirement!(projection); },
            commitWebSessionsForUserRetirement: retirement.commitWebSessionsForUserRetirement,
        } });
        assert.deepEqual(result, { kind: 'success' });

        assert.deepEqual(credentialColumns(db), {
            passwordHash: before.passwordHash,
            encryptedMasterKey: unlock.encryptedMasterKey,
            salt: unlock.salt,
            unlockVerifierHash: await hashAccessVerifier(unlock.verifier),
            recoveryWrappedMasterKey: recovery.wrappedMasterKey,
            recoverySalt: recovery.salt,
            recoveryVerifierHash: await hashAccessVerifier(recovery.verifier),
        });
        assert.equal(storedUser(db).failedLoginAttempts, 0);
        assert.equal(own.opened.length, 1, 'one session is opened for the recovery');
        assert.equal(retired, own.opened[0], 'and it is the one that retires every session of the account, itself included');
        assert.deepEqual(own.closed, [], 'so it is never closed on its own');

        const quiet = { db, writeAuditEvent: async () => 'audit' };
        assert.equal((await verifyUnlockCredentials({ username: TEST_USERNAME, verifier: unlock.verifier }, quiet)).kind, 'verified');
        assert.equal((await verifyUnlockCredentials({ username: TEST_USERNAME, verifier: adopted.unlock.verifier }, quiet)).kind, 'denied');
        assert.equal((await verifyHostCredentials({ username: TEST_USERNAME, pin: SEEDED_PIN }, quiet)).kind, 'verified');
        db.update(users).set({ failedLoginAttempts: 0, firstFailedLoginAt: null }).run();

        const audit = db.select().from(auditEvents).all().at(-1);
        const metadata = JSON.parse(audit?.redactedMetadata ?? '{}') as Record<string, unknown>;
        assert.deepEqual([audit?.subjectRef, audit?.actorRef, metadata.reasonCode], ['security.unlock-credential', 'user-1', 'passphrase_recovered']);
        assert.deepEqual(metadata.flags, ['credential-rotation', 'recovery-key', 'auth:anonymous']);
        for (const secret of [adopted.recovery.verifier, adopted.recovery.recoveryKey, unlock.verifier, recovery.verifier, recovery.recoveryKey]) {
            assert.equal(JSON.stringify(audit).includes(secret), false, 'no secret reaches the audit record');
        }

        // The recovery key that was typed is spent: it cannot set a third passphrase, and opens no session.
        const after = credentialColumns(db);
        const again = await recover(db, adopted.recovery.verifier);
        assert.deepEqual(again.result.kind === 'denied' && again.result.status, 401);
        assert.deepEqual(credentialColumns(db), after);
        assert.deepEqual(again.own.opened, []);
    } finally {
        sqlite.close();
    }
});

test('a wrong recovery key changes nothing, opens no session and is counted until the account locks; an account on its PIN has no recovery', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        db.update(users).set({ failedLoginAttempts: 0, firstFailedLoginAt: null, lockedUntil: null }).run();
        const onPin = credentialColumns(db);
        const stranger = (await adoptionPayload()).recovery.verifier;
        const noRecovery = await recover(db, stranger);
        assert.equal(noRecovery.result.kind, 'denied');
        assert.deepEqual(credentialColumns(db), onPin);
        assert.deepEqual(noRecovery.own.opened, []);

        const adoption = await adoptionPayload();
        assert.equal((await adoptPassphrase({ archiveGeneration: TEST_GENERATION, session: session('user-1'), request: adoptionRequest(), payload: adoption.payload }, {
            db, writeAuditEvent: testAuditWriter(db), ...webRetirement(), retirePinEraResidues: residueRemoval().retirePinEraResidues,
        })).kind, 'success');
        const adopted = credentialColumns(db);
        const own = recoverySession();
        const wrong = await recover(db, stranger, { own });
        assert.deepEqual(wrong.result.kind === 'denied' && [wrong.result.status, wrong.result.body.remainingAttempts], [401, 4]);
        // The verifier of the passphrase itself is not the recovery key either.
        assert.equal((await recover(db, adoption.unlock.verifier, { own })).result.kind, 'denied');
        assert.equal(storedUser(db).failedLoginAttempts, 2);
        for (let attempt = 3; attempt <= 5; attempt += 1) await recover(db, stranger, { own });
        assert.ok(storedUser(db).lockedUntil, 'five wrong recovery keys lock the account');
        // While it is locked, the right recovery key is refused as well.
        const locked = await recover(db, adoption.recovery.verifier, { own });
        assert.deepEqual(locked.result.kind === 'denied' && locked.result.status, 423);
        assert.deepEqual(credentialColumns(db), adopted);
        assert.deepEqual(own.opened, [], 'no session is opened before the recovery key is verified');
    } finally {
        sqlite.close();
    }
});

test('a recovery that cannot retire the sessions writes nothing and closes the session it opened', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        const adopted = await adoptedAccount(db);
        const before = credentialColumns(db);
        const unconfirmed = (outcome: Awaited<ReturnType<typeof recover>>['result']) =>
            outcome.kind === 'failure' && [outcome.status, outcome.code];

        // The Web auth control gives no session: nothing was opened, nothing is written.
        const noSession = await recover(db, adopted.recovery.verifier, { own: recoverySession(false) });
        assert.deepEqual(unconfirmed(noSession.result), [409, PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE]);
        assert.deepEqual(credentialColumns(db), before);

        // The owner will not prepare the retirement: the session opened for the recovery is closed.
        const refused = await recover(db, adopted.recovery.verifier, { dependencies: { prepareWebSessionsForUserRetirement: () => null } });
        assert.deepEqual(unconfirmed(refused.result), [409, PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE]);
        assert.deepEqual(refused.own.closed, refused.own.opened);
        assert.equal(refused.own.opened.length, 1);
        assert.deepEqual(credentialColumns(db), before);

        // A lock established after the recovery key was verified stands: the write is refused.
        const lockedUntil = new Date(Math.floor(Date.now() / 1000) * 1000 + 60_000); // the column keeps whole seconds
        const lateLock = await recover(db, adopted.recovery.verifier, { dependencies: {
            prepareNativeSessionsForUserRetirement: (userId) => {
                db.update(users).set({ lockedUntil }).run();
                return prepareNativeLegacyUserRetirement(userId);
            },
        } });
        assert.deepEqual(lateLock.result.kind === 'failure' && [lateLock.result.status, lateLock.result.code], [409, 'PASSPHRASE_ADOPTION_CONFLICT']);
        assert.deepEqual(lateLock.own.closed, lateLock.own.opened);
        assert.deepEqual(credentialColumns(db), before);
        assert.equal(storedUser(db).lockedUntil?.getTime(), lockedUntil.getTime());
    } finally {
        sqlite.close();
    }
});

test('two recoveries at once, or one interrupted inside its write, leave one whole set of credentials', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        const adopted = await adoptedAccount(db);
        const before = credentialColumns(db);
        const interrupted = new Proxy(db, {
            get(target, property, receiver) {
                if (property === 'transaction') return () => { throw new Error('synthetic interruption'); };
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }) as TestDatabase;
        const own = recoverySession();
        await assert.rejects(() => recover(db, adopted.recovery.verifier, { own, dependencies: { db: interrupted } }), /synthetic interruption/u);
        assert.deepEqual(credentialColumns(db), before, 'the old passphrase and the old recovery key still stand');
        assert.deepEqual(own.closed, own.opened, 'and the session opened for the recovery is closed');

        const attempts = await Promise.all([recover(db, adopted.recovery.verifier), recover(db, adopted.recovery.verifier)]);
        assert.equal(attempts.filter(({ result }) => result.kind === 'success').length, 1);
        const winner = attempts.find(({ result }) => result.kind === 'success')!;
        const loser = attempts.find(({ result }) => result.kind !== 'success')!;
        assert.deepEqual(credentialColumns(db), {
            passwordHash: before.passwordHash,
            encryptedMasterKey: winner.unlock.encryptedMasterKey,
            salt: winner.unlock.salt,
            unlockVerifierHash: await hashAccessVerifier(winner.unlock.verifier),
            recoveryWrappedMasterKey: winner.recovery.wrappedMasterKey,
            recoverySalt: winner.recovery.salt,
            recoveryVerifierHash: await hashAccessVerifier(winner.recovery.verifier),
        });
        assert.deepEqual(loser.own.closed, loser.own.opened, 'the recovery that lost closes whatever it opened');
    } finally {
        sqlite.close();
    }
});

test('when the retirement of the sessions cannot be confirmed after a recovery the new passphrase is already the credential', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        const adopted = await adoptedAccount(db);
        const { result, unlock } = await recover(db, adopted.recovery.verifier, { outcome: 'failed' });
        assert.deepEqual(result.kind === 'failure' && [result.status, result.code], [409, PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE]);
        assert.match(result.kind === 'failure' ? result.message : '', /nuova passphrase è attiva/u);
        assert.equal(storedUser(db).unlockVerifierHash, await hashAccessVerifier(unlock.verifier));
    } finally {
        sqlite.close();
    }
});

test('the recovery request must carry a new recovery key and nothing that stands in for another secret', async () => {
    const adopted = await adoptionPayload();
    const { payload } = await recoveryPayload(adopted.recovery.verifier);
    const rejected: Array<[string, unknown]> = [
        ['the old recovery key kept as the new one', { ...payload, recovery: { ...payload.recovery, verifier: payload.recoveryVerifier } }],
        ['the recovery verifier offered as the new access verifier', { ...payload, verifier: payload.recoveryVerifier }],
        ['no proof of the recovery key', { ...payload, recoveryVerifier: undefined }],
        ['a short proof', { ...payload, recoveryVerifier: Buffer.alloc(16, 1).toString('base64') }],
        ['a PIN wrapping', { ...payload, encryptedMasterKey: `v2:${payload.encryptedMasterKey.slice(3)}` }],
        ['a username that is not text', { ...payload, username: 7 }],
    ];
    for (const [name, candidate] of rejected) assert.equal(validatePassphraseRecoveryPayload(candidate), null, name);
    const { username: _omitted, ...withoutUsername } = payload;
    assert.deepEqual(validatePassphraseRecoveryPayload(withoutUsername), { ...payload, username: '' });
});


test('credential CAS rejects archive B with the same account and credentials after verification on A', async () => {
    for (const mode of ['adopt', 'change', 'recover'] as const) {
        const { sqlite, db } = makeDatabase();
        try {
            const adopted = mode === 'adopt' ? null : await adoptedAccount(db);
            if (!adopted) await seedUser(db);
            const candidate = adopted ? await recoveryPayload(adopted.recovery.verifier) : await adoptionPayload();
            const before = credentialColumns(db);
            const auditsBefore = db.select().from(auditEvents).all();
            let commits = 0;
            const owner = webRetirement();
            const dependencies: PinChangeServiceDependencies = {
                db, ...owner, writeAuditEvent: testAuditWriter(db),
                retirePinEraResidues: residueRemoval().retirePinEraResidues,
                prepareNativeSessionsForUserRetirement: (userId) => {
                    sqlite.prepare('UPDATE archive_generation SET generation = ? WHERE id = 1')
                        .run('c15c15c1-2222-4222-8222-222222222222');
                    return prepareNativeLegacyUserRetirement(userId);
                },
                commitWebSessionsForUserRetirement: (capability) => { commits += 1; return owner.commitWebSessionsForUserRetirement!(capability); },
            };
            const common = { archiveGeneration: TEST_GENERATION, request: adoptionRequest() };
            await assert.rejects(async () => {
                if (mode === 'adopt') return adoptPassphrase({ ...common, session: session('user-1'),
                    payload: (candidate as Awaited<ReturnType<typeof adoptionPayload>>).payload }, dependencies);
                const recovery = candidate as Awaited<ReturnType<typeof recoveryPayload>>;
                if (mode === 'recover') return recoverPassphrase({ ...common, payload: recovery.payload,
                    openSession: recoverySession().openSession }, dependencies);
                const { username: _username, recoveryVerifier: _previous, ...credentials } = recovery.payload;
                return changePassphrase({ ...common, session: session('user-1'),
                    payload: { ...credentials, currentVerifier: adopted!.unlock.verifier } }, dependencies);
            }, { code: 'ARCHIVE_REPLACED' }, mode);
            assert.deepEqual(credentialColumns(db), before, mode);
            assert.deepEqual(db.select().from(auditEvents).all(), auditsBefore, mode);
            assert.equal(commits, 0, mode);
        } finally { sqlite.close(); }
    }
});
