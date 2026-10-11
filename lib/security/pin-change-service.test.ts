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
    adoptPassphrase,
    changePin,
    PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE,
    type PinChangeServiceDependencies,
} from './pin-change-service';
import { verifyHostCredentials, verifyUnlockCredentials } from './host-credential-verification';
import { validatePassphraseAdoptionPayload } from './passphrase-adoption-validation';
import { generateMasterKey } from './security';
import { createRecoveryWrapping, createUnlockWrapping, hashAccessVerifier } from './unlock-credential';
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

/* @Codex: service tests use the real shared owner, with a bounded request-reader seam. */
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
        const result = await changePin({
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
        const result = await changePin({
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
        const result = await changePin({
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

test('changePin never replaces the wrapping of an account that unlocks with a passphrase', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        db.update(users).set({ unlockVerifierHash: 'a'.repeat(64), encryptedMasterKey: 'v3:passphrase-wrapping' }).run();
        const before = db.select().from(users).get();
        let retirements = 0;
        // The current PIN is the right one: it is the authority of the PIN over the wrapping that is gone.
        const result = await changePin({
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
    return { payload, unlock, recovery };
}
const SEEDED_PIN = '1234'; // the PIN seedUser gives the account
const adoptionRequest = () => new Request('http://127.0.0.1/api/auth/passphrase', { headers: { 'x-request-id': 'adoption-test' } });
const storedUser = (db: TestDatabase) => db.select().from(users).where(eq(users.id, 'user-1')).get()!;

test('adoptPassphrase moves the account to the passphrase in one write and keeps the PIN for confirmations', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const before = storedUser(db);
        const projection = session('user-1');
        const { payload, unlock, recovery } = await adoptionPayload();
        const dependencies: PinChangeServiceDependencies = { db, writeAuditEvent: testAuditWriter(db), ...webRetirement('completed', projection) };

        assert.deepEqual(await adoptPassphrase({ session: projection, request: adoptionRequest(), payload }, dependencies), { kind: 'success' });

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
        const before = storedUser(db);
        let prepared = 0;
        const retirement = webRetirement();
        const dependencies: PinChangeServiceDependencies = {
            db, writeAuditEvent: testAuditWriter(db), ...retirement,
            prepareWebSessionsForUserRetirement: (projection) => { prepared += 1; return retirement.prepareWebSessionsForUserRetirement!(projection); },
        };
        const adopt = (payload: Awaited<ReturnType<typeof adoptionPayload>>['payload']) =>
            adoptPassphrase({ session: session('user-1'), request: adoptionRequest(), payload }, dependencies);

        const wrongPin = await adopt((await adoptionPayload('0000')).payload);
        assert.deepEqual(wrongPin.kind === 'failure' && [wrongPin.status, wrongPin.code], [401, 'PASSPHRASE_ADOPTION_INVALID_PIN']);
        assert.deepEqual(storedUser(db), before);
        assert.equal(prepared, 0, 'no session is prepared for retirement before the PIN is verified');

        assert.deepEqual(await adopt((await adoptionPayload()).payload), { kind: 'success' });
        const adopted = storedUser(db);

        // The right PIN and a well-formed request, again: this is how a PIN would take the archive back.
        const again = await adopt((await adoptionPayload()).payload);
        assert.deepEqual(again.kind === 'failure' && [again.status, again.code], [409, 'PASSPHRASE_ALREADY_ADOPTED']);
        assert.deepEqual(storedUser(db), adopted);
        assert.equal(prepared, 1);
    } finally {
        sqlite.close();
    }
});

test('two adoptions at once leave one whole set of credentials, never a mix', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seedUser(db);
        const dependencies: PinChangeServiceDependencies = { db, writeAuditEvent: testAuditWriter(db), ...webRetirement() };
        const candidates = await Promise.all([adoptionPayload(), adoptionPayload()]);
        const results = await Promise.all(candidates.map(({ payload }) =>
            adoptPassphrase({ session: session('user-1'), request: adoptionRequest(), payload }, dependencies)));

        assert.equal(results.filter((result) => result.kind === 'success').length, 1);
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
        const { payload } = await adoptionPayload();

        await assert.rejects(() => adoptPassphrase({ session: session('user-1'), request: adoptionRequest(), payload }, {
            db: interrupted, writeAuditEvent: testAuditWriter(db), ...retirement,
            commitWebSessionsForUserRetirement: (capability) => { outcomes.push('committed'); return retirement.commitWebSessionsForUserRetirement!(capability); },
            abortWebSessionsForUserRetirement: (capability) => { outcomes.push('aborted'); return retirement.abortWebSessionsForUserRetirement!(capability); },
        }), /synthetic interruption/u);

        assert.deepEqual(storedUser(db), before);
        assert.deepEqual(outcomes, ['aborted'], 'the sessions prepared for retirement are released, not retired');
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
        const result = await adoptPassphrase({ session: session('user-1'), request: adoptionRequest(), payload }, {
            db, writeAuditEvent: testAuditWriter(db), ...webRetirement('failed'),
        });
        assert.deepEqual(result.kind === 'failure' && [result.status, result.code], [409, PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE]);
        assert.match(result.kind === 'failure' ? result.message : '', /passphrase è attiva/u);
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
