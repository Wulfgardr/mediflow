/* @Codex */
export const AUTH_LOCKOUT_MAX_FAILURES = 5;
/* @Codex */
export const AUTH_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
/* @Codex */
export const AUTH_LOCKOUT_DURATION_MS = 15 * 60 * 1000;
/* @Codex */
export const AUTH_INVALID_CREDENTIALS_CODE = 'AUTH_INVALID_CREDENTIALS';
/* @Codex */
export const AUTH_LOCKED_CODE = 'AUTH_LOCKED';

type LockoutState = {
    failedLoginAttempts: number | null | undefined;
    firstFailedLoginAt: Date | string | number | null | undefined;
    lockedUntil: Date | string | number | null | undefined;
};

export type LockoutFailureResult = {
    failedLoginAttempts: number;
    firstFailedLoginAt: Date;
    lockedUntil: Date | null;
    remainingAttempts: number;
    isLocked: boolean;
};

export type AuthFailurePayload = {
    error: string;
    code: string;
    remainingAttempts?: number;
    failedLoginAttempts?: number;
    lockedUntil?: string;
};

/* @Codex */
export function normalizeLockoutDate(value: Date | string | number | null | undefined): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/* @Codex */
export function isLockoutActive(state: LockoutState, now: Date = new Date()): Date | null {
    const lockedUntil = normalizeLockoutDate(state.lockedUntil);
    if (!lockedUntil) return null;
    return lockedUntil.getTime() > now.getTime() ? lockedUntil : null;
}

/* @Codex */
export function resetLockoutState() {
    return {
        failedLoginAttempts: 0,
        firstFailedLoginAt: null,
        lockedUntil: null,
    };
}

/* @Codex */
export function recordFailedLogin(state: LockoutState, now: Date = new Date()): LockoutFailureResult {
    const activeLockout = isLockoutActive(state, now);
    if (activeLockout) {
        return {
            failedLoginAttempts: Math.max(state.failedLoginAttempts ?? AUTH_LOCKOUT_MAX_FAILURES, AUTH_LOCKOUT_MAX_FAILURES),
            firstFailedLoginAt: normalizeLockoutDate(state.firstFailedLoginAt) ?? now,
            lockedUntil: activeLockout,
            remainingAttempts: 0,
            isLocked: true,
        };
    }

    const firstFailedLoginAt = normalizeLockoutDate(state.firstFailedLoginAt);
    const currentAttempts = typeof state.failedLoginAttempts === 'number' && state.failedLoginAttempts > 0
        ? Math.trunc(state.failedLoginAttempts)
        : 0;

    const withinWindow = firstFailedLoginAt
        ? now.getTime() - firstFailedLoginAt.getTime() <= AUTH_LOCKOUT_WINDOW_MS
        : false;

    const nextAttempts = withinWindow ? currentAttempts + 1 : 1;
    const nextFirstFailure = withinWindow && firstFailedLoginAt ? firstFailedLoginAt : now;
    const isLocked = nextAttempts >= AUTH_LOCKOUT_MAX_FAILURES;
    const lockedUntil = isLocked ? new Date(now.getTime() + AUTH_LOCKOUT_DURATION_MS) : null;

    return {
        failedLoginAttempts: nextAttempts,
        firstFailedLoginAt: nextFirstFailure,
        lockedUntil,
        remainingAttempts: Math.max(AUTH_LOCKOUT_MAX_FAILURES - nextAttempts, 0),
        isLocked,
    };
}

/* @Codex */
export function createInvalidCredentialsPayload(
    result?: Pick<LockoutFailureResult, 'remainingAttempts' | 'failedLoginAttempts'>,
): AuthFailurePayload {
    return {
        error: 'Invalid credentials',
        code: AUTH_INVALID_CREDENTIALS_CODE,
        remainingAttempts: result?.remainingAttempts,
        failedLoginAttempts: result?.failedLoginAttempts,
    };
}

/* @Codex */
export function createLockedPayload(
    lockedUntil: Date,
    failedLoginAttempts: number = AUTH_LOCKOUT_MAX_FAILURES,
): AuthFailurePayload {
    return {
        error: 'Account temporarily locked',
        code: AUTH_LOCKED_CODE,
        failedLoginAttempts,
        remainingAttempts: 0,
        lockedUntil: lockedUntil.toISOString(),
    };
}
