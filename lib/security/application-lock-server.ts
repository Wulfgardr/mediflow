/* @Codex */
import 'server-only';

import { NextResponse } from 'next/server';

import {
    type ServerSession,
    type ServerSessionCleanupOutcome,
} from './server-session';

export const APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION = 'mediflow.application-lock-receipt.v1' as const;

export type ApplicationLockReceipt = Readonly<{
    schemaVersion: typeof APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION;
    state: 'server_invalidation_confirmed' | 'server_invalidation_unconfirmed';
}>;

export type ApplicationLockSources = Readonly<{
    invalidateSession: (sessionId: string) => Readonly<{
        sessionBeforeDeletion: ServerSession | null;
        cleanupOutcome: ServerSessionCleanupOutcome;
        authorityAbsent: boolean;
    }>;
    lookupProjectionOwner: (sessionId: string) => unknown;
}>;
export type ApplicationLockAttempt = Readonly<{
    receipt: ApplicationLockReceipt;
    sessionBeforeDeletion: ServerSession | null;
}>;

const sessionIdPattern = /^[a-f0-9]{64}$/u;
const confirmedReceipt: ApplicationLockReceipt = Object.freeze({
    schemaVersion: APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION,
    state: 'server_invalidation_confirmed',
});
const unconfirmedReceipt: ApplicationLockReceipt = Object.freeze({
    schemaVersion: APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION,
    state: 'server_invalidation_unconfirmed',
});

export function isExactServerSessionId(value: unknown): value is string {
    return typeof value === 'string' && sessionIdPattern.test(value);
}

function lock(cookieSessionId: unknown, sources: ApplicationLockSources): ApplicationLockAttempt {
    if (!isExactServerSessionId(cookieSessionId)) {
        return { receipt: unconfirmedReceipt, sessionBeforeDeletion: null };
    }
    try {
        const invalidation = sources.invalidateSession(cookieSessionId);
        const receipt = invalidation.cleanupOutcome === 'completed'
            && invalidation.authorityAbsent
            && sources.lookupProjectionOwner(cookieSessionId) === null
            ? confirmedReceipt
            : unconfirmedReceipt;
        return { receipt, sessionBeforeDeletion: invalidation.sessionBeforeDeletion };
    } catch {
        return { receipt: unconfirmedReceipt, sessionBeforeDeletion: null };
    }
}

export function evaluateApplicationLockAttempt(
    cookieSessionId: unknown,
    sources: ApplicationLockSources,
): ApplicationLockAttempt {
    return lock(cookieSessionId, sources);
}

export function applicationLockHttpStatus(receipt: ApplicationLockReceipt): 200 | 409 {
    return receipt.state === 'server_invalidation_confirmed' ? 200 : 409;
}

/** Audit is ancillary evidence and cannot retrograde a completed invalidation. */
/* @Codex */
export async function preserveApplicationLockReceipt(
    receipt: ApplicationLockReceipt,
    audit: () => PromiseLike<unknown> | unknown,
): Promise<ApplicationLockReceipt> {
    if (receipt.state !== 'server_invalidation_confirmed') return receipt;
    try {
        await audit();
    } catch {
        // The server-side invalidation receipt remains authoritative if audit fails.
    }
    return receipt;
}

export function createApplicationLockResponse(receipt: ApplicationLockReceipt): NextResponse {
    return NextResponse.json(receipt, { status: applicationLockHttpStatus(receipt) });
}
