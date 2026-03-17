import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AUTH_LOCKOUT_DURATION_MS,
    AUTH_LOCKOUT_MAX_FAILURES,
    AUTH_LOCKOUT_WINDOW_MS,
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
