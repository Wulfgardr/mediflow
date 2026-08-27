/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import { users } from '@/lib/schema';
import {
    verifyHostCredentials,
    type HostCredentialVerifierDependencies,
} from './host-credential-verification';

const PIN = '2468';
const WRONG_PIN = ['0', '0', '0', '0'].join('');
const USERNAME = 'synthetic-admin';
const OTHER_USERNAME = ['synthetic', 'other'].join('-');
type TestDatabase = NonNullable<HostCredentialVerifierDependencies['db']>;
type AuditInput = Parameters<NonNullable<HostCredentialVerifierDependencies['writeAuditEvent']>>[0];

function makeDatabase() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT, ambulatory_name TEXT, role TEXT,
        password_hash TEXT NOT NULL, encrypted_master_key TEXT NOT NULL, salt TEXT NOT NULL,
        failed_login_attempts INTEGER NOT NULL DEFAULT 0, first_failed_login_at INTEGER, locked_until INTEGER, created_at INTEGER
    )`);
    return { sqlite, db: drizzle(sqlite) as TestDatabase };
}

async function seed(db: TestDatabase, state: Partial<{
    passwordHash: string; failedLoginAttempts: number; firstFailedLoginAt: Date | null; lockedUntil: Date | null;
}> = {}) {
    const passwordHash = state.passwordHash ?? await bcrypt.hash(PIN, 4);
    db.insert(users).values({
        id: 'synthetic-user-1', username: USERNAME, role: 'admin', passwordHash,
        encryptedMasterKey: 'synthetic-key-blob', salt: 'synthetic-salt',
        failedLoginAttempts: state.failedLoginAttempts ?? 0, firstFailedLoginAt: state.firstFailedLoginAt,
        lockedUntil: state.lockedUntil, createdAt: new Date(),
    }).run();
    return passwordHash;
}

test('stays server-only and imports no route, session, cookie, channel, or token authority', () => {
    const source = readFileSync(new URL('./host-credential-verification.ts', import.meta.url), 'utf8');
    const imports = source.split('\n').filter((line) => line.startsWith('import'));
    const forbiddenImports = ['next/server', 'server-session', 'local-api', 'request-transport'];
    for (const forbidden of forbiddenImports) {
        assert.equal(imports.some((line) => line.includes(forbidden)), false, forbidden);
    }
    assert.equal(verifyHostCredentials.length, 1);
});

test('resolves an omitted username only for one account', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        await seed(db);
        const dependencies = { db, writeAuditEvent: async () => 'audit' };
        const single = await verifyHostCredentials({ username: '', pin: PIN }, dependencies);
        assert.equal(single.kind, 'verified');
        db.insert(users).values({
            id: 'synthetic-user-2', username: OTHER_USERNAME, role: 'admin',
            passwordHash: await bcrypt.hash('1357', 4), encryptedMasterKey: 'synthetic-other-key',
            salt: 'synthetic-other-salt', failedLoginAttempts: 0, createdAt: new Date(),
        }).run();
        const ambiguous = await verifyHostCredentials({ username: '', pin: PIN }, dependencies);
        assert.equal(ambiguous.kind, 'denied');
        assert.equal(ambiguous.status, 401);
        assert.equal(ambiguous.failureClass, 'invalid_credentials');
    } finally { sqlite.close(); }
});

test('unknown account and wrong PIN share a sanitized credential denial', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        const hash = await seed(db);
        const audits: AuditInput[] = [];
        const dependencies = { db, writeAuditEvent: async (event: AuditInput) => { audits.push(event); return 'audit'; } };
        const unknown = await verifyHostCredentials({ username: ['synthetic', 'unknown'].join('-'), pin: PIN }, dependencies);
        const wrong = await verifyHostCredentials({ username: USERNAME, pin: WRONG_PIN }, dependencies);
        assert.equal(unknown.kind, 'denied');
        assert.equal(wrong.kind, 'denied');
        assert.equal(unknown.failureClass, 'invalid_credentials');
        assert.equal(wrong.failureClass, 'invalid_credentials');
        assert.equal(unknown.status, wrong.status);
        assert.equal(unknown.status, 401);
        assert.equal(unknown.body.code, wrong.body.code);
        assert.equal(audits.length, 2);
        assert.equal(JSON.stringify(audits).includes(PIN) || JSON.stringify(audits).includes(hash), false);
    } finally { sqlite.close(); }
});

test('hostile input shapes deny before reflection, reads, or dependency observation', async () => {
    let traps = 0; let reads = 0; let calls = 0;
    const transparent = new Proxy({ username: USERNAME, pin: PIN }, {});
    const throwing = new Proxy({ username: USERNAME, pin: PIN }, {
        get: () => { traps += 1; throw new Error('proxy trap'); },
        getPrototypeOf: () => { traps += 1; throw new Error('proxy trap'); },
        ownKeys: () => { traps += 1; throw new Error('proxy trap'); },
    });
    const accessor = Object.defineProperty({ username: USERNAME }, 'pin', {
        enumerable: true, get: () => { reads += 1; return PIN; },
    });
    const hidden = Object.defineProperty({ username: USERNAME, pin: PIN }, 'hidden', { value: 'synthetic' });
    const sparse: unknown[] = []; sparse[1] = { username: USERNAME, pin: PIN };
    const hostileInputs: unknown[] = [
        transparent, throwing, accessor, hidden, { username: USERNAME, pin: PIN, extra: 'synthetic' },
        { username: USERNAME, pin: PIN, [Symbol('synthetic')]: true },
        Object.assign(Object.create({ inherited: true }), { username: USERNAME, pin: PIN }), sparse,
        { username: USERNAME, pin: PIN, then: () => undefined },
        Object.assign(async () => undefined, { username: USERNAME, pin: PIN }),
    ];
    const dependencies = {
        get db() { calls += 1; throw new Error('database observed'); },
        compare: async () => { calls += 1; return true; },
        writeAuditEvent: async () => { calls += 1; return 'audit'; },
    } as HostCredentialVerifierDependencies;
    for (const input of hostileInputs) {
        const result = await verifyHostCredentials(input, dependencies);
        assert.equal(result.kind, 'denied');
        assert.equal(result.failureClass, 'invalid_credentials');
        assert.equal(result.status, 401);
    }
    assert.equal(traps, 0); assert.equal(reads, 0); assert.equal(calls, 0);
});

test('fifth failure locks exactly, while a stale window restarts at one', async () => {
    const { sqlite, db } = makeDatabase(); const now = new Date('2026-08-27T12:00:00.000Z');
    try {
        await seed(db, { failedLoginAttempts: 4, firstFailedLoginAt: new Date(now.getTime() - 1_000) });
        const dependencies = { db, now: () => now, writeAuditEvent: async () => 'audit' };
        const fifth = await verifyHostCredentials({ username: USERNAME, pin: WRONG_PIN }, dependencies);
        assert.equal(fifth.kind, 'denied'); assert.equal(fifth.failureClass, 'locked');
        assert.equal(fifth.status, 423); assert.equal(fifth.body.failedLoginAttempts, 5);
        const locked = db.select().from(users).where(eq(users.username, USERNAME)).get();
        assert.equal(locked?.lockedUntil?.getTime(), now.getTime() + (15 * 60 * 1000));
        db.update(users).set({ failedLoginAttempts: 4, firstFailedLoginAt: new Date(now.getTime() - (16 * 60 * 1000)), lockedUntil: null })
            .where(eq(users.username, USERNAME)).run();
        const stale = await verifyHostCredentials({ username: USERNAME, pin: WRONG_PIN }, dependencies);
        assert.equal(stale.kind, 'denied'); assert.equal(stale.failureClass, 'invalid_credentials');
        assert.equal(stale.status, 401); assert.equal(stale.body.failedLoginAttempts, 1);
    } finally { sqlite.close(); }
});

test('credential CAS denies hash changes before compare and before failure or reset updates', async () => {
    const cases = [
        { name: 'before compare', pin: PIN, mutate: 'now' },
        { name: 'before reset update', pin: PIN, mutate: 'compare' },
        { name: 'before failure update', pin: WRONG_PIN, mutate: 'compare' },
    ] as const;
    for (const scenario of cases) {
        const { sqlite, db } = makeDatabase();
        try {
            const original = await seed(db, { failedLoginAttempts: 2, firstFailedLoginAt: new Date('2026-08-27T11:59:00.000Z') });
            const replacement = await bcrypt.hash('1357', 4); let changed = false;
            const replace = () => { if (!changed) { changed = true; db.update(users).set({ passwordHash: replacement }).where(eq(users.username, USERNAME)).run(); } };
            const result = await verifyHostCredentials({ username: USERNAME, pin: scenario.pin }, {
                db,
                now: () => { if (scenario.mutate === 'now') replace(); return new Date('2026-08-27T12:00:00.000Z'); },
                compare: async (pin, hash) => {
                    const matched = await bcrypt.compare(pin, hash);
                    if (scenario.mutate === 'compare') replace();
                    return matched;
                },
                writeAuditEvent: async () => 'audit',
            });
            assert.equal(result.kind, 'denied', scenario.name);
            assert.equal(result.failureClass, 'invalid_credentials');
            const stored = db.select().from(users).where(eq(users.username, USERNAME)).get();
            assert.equal(await bcrypt.compare(PIN, stored!.passwordHash), false);
            assert.equal(stored?.failedLoginAttempts, 2);
            assert.equal(original === replacement, false);
        } finally { sqlite.close(); }
    }
});

test('audit is awaited, redacted, and absorbs rejected promise, thenable, species, and proxy outputs', async () => {
    const { sqlite, db } = makeDatabase();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    const pairedToken = 'synthetic-paired-token';
    const localToken = 'synthetic-local-token';
    const cookie = 'synthetic-cookie';
    const rawPayload = 'synthetic-raw-payload';
    const freeFormSecret = 'synthetic-free-form-secret';
    let settled = false;
    let speciesReads = 0;
    let proxyReads = 0;
    process.on('unhandledRejection', onUnhandled);
    try {
        const hash = await seed(db); const events: AuditInput[] = [];
        const delayed = { then: (resolve: (value: string) => void) => setTimeout(() => { settled = true; resolve('audit'); }, 1) };
        const first = await verifyHostCredentials({ username: USERNAME, pin: WRONG_PIN }, { db, writeAuditEvent: ((event: AuditInput) => { events.push(event); return delayed as unknown as Promise<string>; }) as never });
        assert.equal(first.kind, 'denied'); assert.equal(settled, true);
        const serialized = JSON.stringify(events);
        const forbidden = [
            PIN, hash, 'synthetic-salt', 'synthetic-key-blob', pairedToken,
            localToken, cookie, rawPayload, freeFormSecret,
        ];
        for (const secret of forbidden) assert.equal(serialized.includes(secret), false);
        assert.equal(events[0]?.subjectRef, undefined);
        assert.equal(events[0]?.requestId, undefined);
        const rejectedThenable = { then: (_resolve: unknown, reject: (reason: unknown) => void) => setTimeout(() => reject(new Error('synthetic rejection')), 1) };
        class SpeciesAuditPromise extends Promise<string> { static get [Symbol.species](): PromiseConstructor { speciesReads += 1; return Promise; } }
        const writers = [
            async () => Promise.reject(new Error('synthetic rejection')),
            (() => rejectedThenable as unknown as Promise<string>),
            (() => SpeciesAuditPromise.reject(new Error('synthetic rejection'))),
            (() => new Proxy({}, { get: () => { proxyReads += 1; throw new Error('proxy audit output'); } }) as unknown as Promise<string>),
        ];
        for (const writeAuditEvent of writers) {
            const result = await verifyHostCredentials({ username: USERNAME, pin: WRONG_PIN }, { db, writeAuditEvent: writeAuditEvent as never });
            assert.equal(result.kind, 'denied');
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(unhandled, []);
        assert.ok(speciesReads > 0);
        assert.equal(proxyReads, 1);
    } finally { process.off('unhandledRejection', onUnhandled); sqlite.close(); }
});

test('hostile dependency values deny without a grant, uncaught rejection, or later work', async () => {
    const { sqlite, db } = makeDatabase();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
        await seed(db); let compares = 0; let databaseTraps = 0;
        const asyncLikeClock = { then: () => { throw new Error('clock then must not run'); } };
        const databaseProxy = new Proxy({}, { get: () => { databaseTraps += 1; throw new Error('database proxy'); } });
        const cases: HostCredentialVerifierDependencies[] = [
            { db, compare: async () => { compares += 1; throw new Error('compare rejection'); } },
            { db, now: () => asyncLikeClock as unknown as Date, compare: async () => { compares += 1; return true; } },
            { db: databaseProxy as HostCredentialVerifierDependencies['db'] },
        ];
        for (const dependencies of cases) {
            const result = await verifyHostCredentials({ username: USERNAME, pin: PIN }, dependencies);
            assert.equal(result.kind, 'denied');
            assert.equal(result.failureClass, 'invalid_credentials');
            assert.equal(result.status, 401);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(unhandled, []); assert.equal(compares, 1); assert.equal(databaseTraps, 1);
    } finally { process.off('unhandledRejection', onUnhandled); sqlite.close(); }
});

test('verified accounts return only the route-neutral account projection', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        const hash = await seed(db);
        const result = await verifyHostCredentials({ username: USERNAME, pin: PIN }, { db, writeAuditEvent: async () => 'audit' });
        assert.equal(result.kind, 'verified');
        const serialized = JSON.stringify(result.account);
        for (const forbidden of [hash, 'passwordHash', 'failedLoginAttempts', 'firstFailedLoginAt', 'lockedUntil']) {
            assert.equal(serialized.includes(forbidden), false);
        }
    } finally { sqlite.close(); }
});

test('active locks deny before compare and a valid PIN resets the persisted lock state', async () => {
    const { sqlite, db } = makeDatabase(); const now = new Date('2026-08-27T12:00:00.000Z');
    try {
        await seed(db, { failedLoginAttempts: 5, lockedUntil: new Date(now.getTime() + 60_000) });
        let compares = 0;
        const locked = await verifyHostCredentials({ username: USERNAME, pin: PIN }, {
            db, now: () => now, compare: async () => { compares += 1; return true; }, writeAuditEvent: async () => 'audit',
        });
        assert.equal(locked.kind, 'denied'); assert.equal(locked.failureClass, 'locked'); assert.equal(compares, 0);
        db.update(users).set({ failedLoginAttempts: 2, firstFailedLoginAt: now, lockedUntil: null }).where(eq(users.username, USERNAME)).run();
        const verified = await verifyHostCredentials({ username: USERNAME, pin: PIN }, { db, now: () => now, writeAuditEvent: async () => 'audit' });
        assert.equal(verified.kind, 'verified');
        const stored = db.select().from(users).where(eq(users.username, USERNAME)).get();
        assert.deepEqual([stored?.failedLoginAttempts, stored?.firstFailedLoginAt, stored?.lockedUntil], [0, null, null]);
    } finally { sqlite.close(); }
});

test('a password-hash change after bcrypt compare denies rather than authenticating the stale hash', async () => {
    const { sqlite, db } = makeDatabase();
    try {
        const original = await seed(db); const replacement = await bcrypt.hash('1357', 4);
        const result = await verifyHostCredentials({ username: USERNAME, pin: PIN }, {
            db,
            compare: async (pin, hash) => {
                assert.equal(hash, original);
                db.update(users).set({ passwordHash: replacement }).where(eq(users.username, USERNAME)).run();
                return bcrypt.compare(pin, hash);
            },
            writeAuditEvent: async () => 'audit',
        });
        assert.equal(result.kind, 'denied'); assert.equal(result.failureClass, 'invalid_credentials');
        const stored = db.select().from(users).where(eq(users.username, USERNAME)).get();
        assert.equal(await bcrypt.compare(PIN, stored!.passwordHash), false);
    } finally { sqlite.close(); }
});
