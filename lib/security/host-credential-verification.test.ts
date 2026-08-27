/* @Codex */
import assert from 'node:assert/strict';
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

test('transparent and throwing proxies deny before reflection or dependency observation', async () => {
    let traps = 0; let calls = 0;
    const transparent = new Proxy({ username: USERNAME, pin: PIN }, {});
    const throwing = new Proxy({ username: USERNAME, pin: PIN }, {
        get: () => { traps += 1; throw new Error('proxy trap'); },
        getPrototypeOf: () => { traps += 1; throw new Error('proxy trap'); },
        ownKeys: () => { traps += 1; throw new Error('proxy trap'); },
    });
    const dependencies = {
        get db() { calls += 1; throw new Error('database observed'); },
        compare: async () => { calls += 1; return true; },
        writeAuditEvent: async () => { calls += 1; return 'audit'; },
    } as HostCredentialVerifierDependencies;
    for (const input of [transparent, throwing]) {
        const result = await verifyHostCredentials(input, dependencies);
        assert.equal(result.kind, 'denied');
        assert.equal(result.failureClass, 'invalid_credentials');
        assert.equal(result.status, 401);
    }
    assert.equal(traps, 0); assert.equal(calls, 0);
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
