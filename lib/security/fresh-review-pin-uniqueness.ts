/* @Codex */
import 'server-only';

import bcrypt from 'bcryptjs';
import { users } from '@/lib/schema';
import { dbServer } from '@/lib/db-server';
import {
    AUTH_LOCKOUT_DURATION_MS,
    AUTH_LOCKOUT_MAX_FAILURES,
    AUTH_LOCKOUT_WINDOW_MS,
} from './auth-lockout';
import { SECURITY_CONFIG } from './security';
import type { AuthenticatedReviewPrincipalV1 } from './authenticated-review-principal';
import { resolveAuthenticatedReviewPrincipal } from './authenticated-review-principal-production';

type CanonicalCredential = Readonly<{ id: string; passwordHash: string }>;
type ResolvePrincipal = () => Promise<AuthenticatedReviewPrincipalV1>;

export type FreshReviewPinUniquenessVerifierSources = Readonly<{
    resolvePrincipal: ResolvePrincipal;
    loadCanonicalCredentials?: () => Promise<readonly CanonicalCredential[]>;
    compare?: (candidatePin: string, passwordHash: string) => Promise<boolean>;
    now?: () => number;
}>;

export type FreshReviewPinProofV1 = Readonly<{
    actorRef: string;
    sessionRef: string;
}>;

export type FreshReviewPinErrorCode =
    | 'attempt_budget_unavailable'
    | 'credential_store_unavailable'
    | 'comparison_unavailable'
    | 'pin_ambiguous'
    | 'pin_attempts_exhausted'
    | 'pin_input_invalid'
    | 'pin_mismatch'
    | 'pin_not_matched'
    | 'principal_ambiguous'
    | 'principal_changed'
    | 'principal_mismatch'
    | 'principal_missing'
    | 'principal_unavailable'
    | 'session_ineligible'
    | 'session_unavailable'
    | 'storage_unavailable';

type PinAttemptRecord = {
    failedAttempts: number;
    firstFailedAt: number | null;
    inFlight: number;
    lastObservedAt: number;
    lockedUntil: number | null;
};

type PinAttemptReservation = {
    active: boolean;
    actorRef: string;
    record: PinAttemptRecord;
    sessionRef: string;
};

const PIN_ATTEMPT_LEDGER_MAX_RECORDS = 64;

export class FreshReviewPinError extends Error {
    readonly code: FreshReviewPinErrorCode;

    constructor(code: FreshReviewPinErrorCode) {
        super(`Fresh review PIN rejected: ${code}`);
        this.name = 'FreshReviewPinError';
        this.code = code;
    }
}

function fail(code: FreshReviewPinErrorCode): never {
    throw new FreshReviewPinError(code);
}

async function loadCanonicalCredentials(): Promise<readonly CanonicalCredential[]> {
    return dbServer.select({ id: users.id, passwordHash: users.passwordHash }).from(users).all();
}

function isValidPin(candidatePin: unknown): candidatePin is string {
    return typeof candidatePin === 'string'
        && candidatePin.length >= SECURITY_CONFIG.PIN_MIN_LENGTH
        && candidatePin.length <= SECURITY_CONFIG.PIN_MAX_LENGTH;
}

function principalFailureCode(error: unknown): FreshReviewPinErrorCode {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    switch (code) {
        case 'principal_ambiguous':
        case 'principal_mismatch':
        case 'principal_missing':
        case 'session_ineligible':
        case 'session_unavailable':
        case 'storage_unavailable':
            return code;
        default:
            return 'principal_unavailable';
    }
}

async function resolvePrincipal(resolve: ResolvePrincipal): Promise<AuthenticatedReviewPrincipalV1> {
    try {
        return await resolve();
    } catch (error) {
        return fail(principalFailureCode(error));
    }
}

/** @Codex Bounded, process-local ledger for one verifier; it stores no credential or authority. */
function createPinAttemptBudget(readNow: () => number) {
    const actors = new Map<string, Map<string, PinAttemptRecord>>();
    let latestObservedAt: number | null = null;

    const observedTime = (): number => {
        let value: unknown;
        try { value = readNow(); } catch { return fail('attempt_budget_unavailable'); }
        if (!Number.isSafeInteger(value) || (value as number) < 0
            || (value as number) > Number.MAX_SAFE_INTEGER - AUTH_LOCKOUT_DURATION_MS) {
            return fail('attempt_budget_unavailable');
        }
        const now = value as number;
        if (latestObservedAt !== null && now < latestObservedAt) {
            return fail('attempt_budget_unavailable');
        }
        latestObservedAt = now;
        return now;
    };
    const remove = (actorRef: string, sessionRef: string, record: PinAttemptRecord): void => {
        const sessions = actors.get(actorRef);
        if (sessions?.get(sessionRef) !== record) return;
        sessions.delete(sessionRef);
        if (sessions.size === 0) actors.delete(actorRef);
    };
    const retainedRecordCount = (): number => {
        let count = 0;
        for (const sessions of actors.values()) count += sessions.size;
        return count;
    };
    const isExpired = (record: PinAttemptRecord, now: number): boolean => {
        if (record.inFlight !== 0) return false;
        if (record.lockedUntil !== null) return record.lockedUntil <= now;
        if (record.firstFailedAt !== null) {
            return now - record.firstFailedAt > AUTH_LOCKOUT_WINDOW_MS;
        }
        return record.failedAttempts === 0;
    };
    const evictExpired = (now: number): void => {
        for (const [actorRef, sessions] of actors) {
            for (const [sessionRef, record] of sessions) {
                if (isExpired(record, now)) sessions.delete(sessionRef);
            }
            if (sessions.size === 0) actors.delete(actorRef);
        }
    };
    const reserve = (principal: AuthenticatedReviewPrincipalV1): PinAttemptReservation => {
        const now = observedTime();
        evictExpired(now);
        let sessions = actors.get(principal.actorRef);
        let current = sessions?.get(principal.sessionRef);
        if (current && now < current.lastObservedAt) return fail('attempt_budget_unavailable');
        if (current?.lockedUntil !== null && current?.lockedUntil !== undefined) {
            if (current.lockedUntil > now) return fail('pin_attempts_exhausted');
            if (current.inFlight !== 0) return fail('attempt_budget_unavailable');
            remove(principal.actorRef, principal.sessionRef, current);
            current = undefined;
        }
        if (current?.firstFailedAt !== null && current?.firstFailedAt !== undefined
            && now - current.firstFailedAt > AUTH_LOCKOUT_WINDOW_MS && current.inFlight === 0) {
            remove(principal.actorRef, principal.sessionRef, current);
            current = undefined;
        }
        if (!current) {
            if (retainedRecordCount() >= PIN_ATTEMPT_LEDGER_MAX_RECORDS) {
                return fail('attempt_budget_unavailable');
            }
            sessions = actors.get(principal.actorRef);
            if (!sessions) {
                sessions = new Map<string, PinAttemptRecord>();
                actors.set(principal.actorRef, sessions);
            }
            current = { failedAttempts: 0, firstFailedAt: null, inFlight: 0,
                lastObservedAt: now, lockedUntil: null };
            sessions.set(principal.sessionRef, current);
        }
        current.lastObservedAt = now;
        if (current.failedAttempts + current.inFlight >= AUTH_LOCKOUT_MAX_FAILURES) {
            return fail('pin_attempts_exhausted');
        }
        current.inFlight += 1;
        return { active: true, actorRef: principal.actorRef, record: current,
            sessionRef: principal.sessionRef };
    };
    const cancel = (reservation: PinAttemptReservation): void => {
        if (!reservation.active) return;
        reservation.active = false;
        const sessions = actors.get(reservation.actorRef);
        if (sessions?.get(reservation.sessionRef) !== reservation.record) return;
        reservation.record.inFlight = Math.max(0, reservation.record.inFlight - 1);
        if (reservation.record.failedAttempts === 0 && reservation.record.inFlight === 0) {
            remove(reservation.actorRef, reservation.sessionRef, reservation.record);
        }
    };
    const reject = (reservation: PinAttemptReservation): boolean => {
        if (!reservation.active) return true;
        const now = observedTime();
        if (now < reservation.record.lastObservedAt) return fail('attempt_budget_unavailable');
        reservation.active = false;
        const sessions = actors.get(reservation.actorRef);
        if (sessions?.get(reservation.sessionRef) !== reservation.record) return false;
        const current = reservation.record;
        current.inFlight = Math.max(0, current.inFlight - 1);
        const withinWindow = current.firstFailedAt !== null
            && now - current.firstFailedAt <= AUTH_LOCKOUT_WINDOW_MS;
        current.failedAttempts = withinWindow ? current.failedAttempts + 1 : 1;
        current.firstFailedAt = withinWindow ? current.firstFailedAt : now;
        current.lastObservedAt = now;
        if (current.failedAttempts >= AUTH_LOCKOUT_MAX_FAILURES) {
            current.lockedUntil = now + AUTH_LOCKOUT_DURATION_MS;
            return true;
        }
        return false;
    };
    const accept = (reservation: PinAttemptReservation): void => {
        if (!reservation.active) return;
        reservation.active = false;
        const sessions = actors.get(reservation.actorRef);
        if (sessions?.get(reservation.sessionRef) !== reservation.record) return;
        const current = reservation.record;
        current.inFlight = Math.max(0, current.inFlight - 1);
        current.failedAttempts = 0;
        current.firstFailedAt = null;
        current.lockedUntil = null;
        if (current.inFlight === 0) {
            remove(reservation.actorRef, reservation.sessionRef, current);
        }
    };

    return Object.freeze({ reserve, reject, accept, cancel });
}

/**
 * P1b verifies only the submitted raw PIN. Actor and session identity remain
 * server-resolved through the injected P1a resolver; no identity input reaches
 * this seam, and the returned proof contains no credential material.
 */
export function createFreshReviewPinUniquenessVerifier(sources: FreshReviewPinUniquenessVerifierSources) {
    const readCredentials = sources.loadCanonicalCredentials ?? loadCanonicalCredentials;
    const compare = sources.compare ?? bcrypt.compare;
    const attemptBudget = createPinAttemptBudget(sources.now ?? Date.now);

    return Object.freeze({
        async verify(candidatePin: string): Promise<FreshReviewPinProofV1> {
            if (!isValidPin(candidatePin)) return fail('pin_input_invalid');

            const before = await resolvePrincipal(sources.resolvePrincipal);
            const reservation = attemptBudget.reserve(before);
            const rejectCredential = (code: FreshReviewPinErrorCode): never => {
                const exhausted = attemptBudget.reject(reservation);
                return fail(exhausted ? 'pin_attempts_exhausted' : code);
            };
            try {
                let credentials: readonly CanonicalCredential[];
                try {
                    credentials = await readCredentials();
                } catch {
                    return fail('credential_store_unavailable');
                }

                let matching: readonly boolean[];
                try {
                    matching = await Promise.all(credentials.map((credential) => compare(candidatePin, credential.passwordHash)));
                } catch {
                    return fail('comparison_unavailable');
                }

                const matched = credentials.filter((_credential, index) => matching[index]);
                if (matched.length === 0) return rejectCredential('pin_not_matched');
                if (matched.length !== 1) return rejectCredential('pin_ambiguous');
                if (matched[0].id !== before.actorRef) return rejectCredential('pin_mismatch');

                const after = await resolvePrincipal(sources.resolvePrincipal);
                if (after.actorRef !== before.actorRef || after.sessionRef !== before.sessionRef) {
                    return fail('principal_changed');
                }

                attemptBudget.accept(reservation);
                return Object.freeze({ actorRef: after.actorRef, sessionRef: after.sessionRef });
            } finally {
                attemptBudget.cancel(reservation);
            }
        },
    });
}

/** The production P1b seam resolves actor and session exclusively through the P1a host resolver. */
export const verifyFreshReviewPin = createFreshReviewPinUniquenessVerifier({
    resolvePrincipal: resolveAuthenticatedReviewPrincipal,
}).verify;
