import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AUTH_INVALID_CREDENTIALS_CODE,
    AUTH_LOCKED_CODE,
    AUTH_LOCKOUT_DURATION_MS,
    AUTH_LOCKOUT_MAX_FAILURES,
    AUTH_LOCKOUT_WINDOW_MS,
    createFailureResponseFromResult,
    createInvalidCredentialsResponse,
    createLockoutResponse,
    getActiveLockoutResponse,
    isLockoutActive,
    recordFailedLogin,
    resetLockoutState,
} from './auth-lockout';

test('recordFailedLogin starts a fresh window when no failures exist', () => {
    const now = new Date('2026-03-17T10:00:00.000Z');
    const result = recordFailedLogin(resetLockoutState(), now);

    assert.equal(result.failedLoginAttempts, 1);
    assert.equal(result.remainingAttempts, AUTH_LOCKOUT_MAX_FAILURES - 1);
    assert.equal(result.isLocked, false);
    assert.equal(result.firstFailedLoginAt.toISOString(), now.toISOString());
    assert.equal(result.lockedUntil, null);
});

test('recordFailedLogin accumulates attempts inside the active window', () => {
    const firstFailure = new Date('2026-03-17T10:00:00.000Z');
    const now = new Date(firstFailure.getTime() + 2 * 60 * 1000);
    const result = recordFailedLogin({
        failedLoginAttempts: 3,
        firstFailedLoginAt: firstFailure,
        lockedUntil: null,
    }, now);

    assert.equal(result.failedLoginAttempts, 4);
    assert.equal(result.remainingAttempts, 1);
    assert.equal(result.isLocked, false);
    assert.equal(result.firstFailedLoginAt.toISOString(), firstFailure.toISOString());
});

test('recordFailedLogin resets stale windows before counting again', () => {
    const firstFailure = new Date('2026-03-17T10:00:00.000Z');
    const now = new Date(firstFailure.getTime() + AUTH_LOCKOUT_WINDOW_MS + 1);
    const result = recordFailedLogin({
        failedLoginAttempts: 4,
        firstFailedLoginAt: firstFailure,
        lockedUntil: null,
    }, now);

    assert.equal(result.failedLoginAttempts, 1);
    assert.equal(result.remainingAttempts, AUTH_LOCKOUT_MAX_FAILURES - 1);
    assert.equal(result.isLocked, false);
    assert.equal(result.firstFailedLoginAt.toISOString(), now.toISOString());
});

test('recordFailedLogin locks the account at the threshold', () => {
    const firstFailure = new Date('2026-03-17T10:00:00.000Z');
    const now = new Date(firstFailure.getTime() + 4 * 60 * 1000);
    const result = recordFailedLogin({
        failedLoginAttempts: AUTH_LOCKOUT_MAX_FAILURES - 1,
        firstFailedLoginAt: firstFailure,
        lockedUntil: null,
    }, now);

    assert.equal(result.failedLoginAttempts, AUTH_LOCKOUT_MAX_FAILURES);
    assert.equal(result.remainingAttempts, 0);
    assert.equal(result.isLocked, true);
    assert.equal(
        result.lockedUntil?.toISOString(),
        new Date(now.getTime() + AUTH_LOCKOUT_DURATION_MS).toISOString(),
    );
});

test('isLockoutActive returns the lock expiry when still active', () => {
    const now = new Date('2026-03-17T10:00:00.000Z');
    const lockedUntil = new Date(now.getTime() + 60_000);
    assert.equal(
        isLockoutActive({
            failedLoginAttempts: AUTH_LOCKOUT_MAX_FAILURES,
            firstFailedLoginAt: now,
            lockedUntil,
        }, now)?.toISOString(),
        lockedUntil.toISOString(),
    );
});

test('isLockoutActive ignores expired locks', () => {
    const now = new Date('2026-03-17T10:00:00.000Z');
    assert.equal(
        isLockoutActive({
            failedLoginAttempts: 0,
            firstFailedLoginAt: null,
            lockedUntil: new Date(now.getTime() - 1000),
        }, now),
        null,
    );
});

test('createInvalidCredentialsResponse returns 401 with standard code', () => {
    const response = createInvalidCredentialsResponse(2);

    assert.equal(response.status, 401);
    assert.equal(response.body.code, AUTH_INVALID_CREDENTIALS_CODE);
    assert.equal(response.body.remainingAttempts, 2);
    assert.match(response.body.message, /Tentativi rimasti: 2/);
    assert.equal(response.retryAfterSeconds, undefined);
});

test('createFailureResponseFromResult returns 423 once the threshold is hit', () => {
    const now = new Date('2026-03-17T10:00:00.000Z');
    const lockedUntil = new Date(now.getTime() + AUTH_LOCKOUT_DURATION_MS);
    const response = createFailureResponseFromResult(
        {
            lockedUntil,
            remainingAttempts: 0,
        },
        now,
    );

    assert.equal(response.status, 423);
    assert.equal(response.body.code, AUTH_LOCKED_CODE);
    assert.match(response.body.message, /Riprova tra 15 minuti/);
    assert.equal(response.body.retryAfterSeconds, AUTH_LOCKOUT_DURATION_MS / 1000);
    assert.equal(response.body.lockedUntil, lockedUntil.toISOString());
});

test('getActiveLockoutResponse returns 423 for already locked accounts', () => {
    const now = new Date('2026-03-17T10:00:00.000Z');
    const lockedUntil = new Date(now.getTime() + 30_000);
    const response = getActiveLockoutResponse(
        {
            failedLoginAttempts: AUTH_LOCKOUT_MAX_FAILURES,
            firstFailedLoginAt: new Date(now.getTime() - 60_000),
            lockedUntil,
        },
        now,
    );

    assert.equal(response?.status, 423);
    assert.equal(response?.body.code, AUTH_LOCKED_CODE);
    assert.equal(response?.body.retryAfterSeconds, 30);
});

test('createLockoutResponse rounds retry-after up to the next second', () => {
    const now = new Date('2026-03-17T10:00:00.000Z');
    const response = createLockoutResponse(new Date(now.getTime() + 1_500), now);

    assert.equal(response.retryAfterSeconds, 2);
    assert.equal(response.body.code, AUTH_LOCKED_CODE);
});
