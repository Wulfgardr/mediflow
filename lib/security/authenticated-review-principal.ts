/* @Codex */
import 'server-only';

import { eq } from 'drizzle-orm';

import { dbServer } from '../db-server';
import { users } from '../schema';
import { readAuthenticatedWebSession } from './server-auth';
import { getSession, type ServerSession } from './server-session';

type CanonicalUser = Readonly<{ id: string; username: string }>;
type Sources = Readonly<{
    readCurrentSession(): Promise<ServerSession | null>;
    lookupUsersById(userId: string): Promise<readonly CanonicalUser[]>;
}>;

export type AuthenticatedReviewPrincipalV1 = Readonly<{
    actorRef: string;
    sessionRef: string;
}>;

export type AuthenticatedReviewPrincipalErrorCode =
    | 'principal_ambiguous'
    | 'principal_mismatch'
    | 'principal_missing'
    | 'session_ineligible'
    | 'session_unavailable'
    | 'storage_unavailable';

export class AuthenticatedReviewPrincipalError extends Error {
    readonly code: AuthenticatedReviewPrincipalErrorCode;

    constructor(code: AuthenticatedReviewPrincipalErrorCode) {
        super(`Authenticated review principal rejected: ${code}`);
        this.name = 'AuthenticatedReviewPrincipalError';
        this.code = code;
    }
}

function fail(code: AuthenticatedReviewPrincipalErrorCode): never {
    throw new AuthenticatedReviewPrincipalError(code);
}

function isCurrentWebSession(session: ServerSession): boolean {
    return session.authChannel === 'web'
        && session.id !== 'local-api'
        && getSession(session.id) === session;
}

export function createAuthenticatedReviewPrincipalResolver(sources: Sources) {
    return Object.freeze({
        async resolve(): Promise<AuthenticatedReviewPrincipalV1> {
            let session: ServerSession | null;
            try { session = await sources.readCurrentSession(); } catch { return fail('storage_unavailable'); }
            if (!session) return fail('session_unavailable');
            if (!isCurrentWebSession(session)) return fail('session_ineligible');

            let matches: readonly CanonicalUser[];
            try { matches = await sources.lookupUsersById(session.userId); } catch { return fail('storage_unavailable'); }
            if (matches.length === 0) return fail('principal_missing');
            if (matches.length !== 1) return fail('principal_ambiguous');
            if (matches[0].id !== session.userId || matches[0].username !== session.username) {
                return fail('principal_mismatch');
            }

            return Object.freeze({ actorRef: matches[0].id, sessionRef: session.id });
        },
    });
}

async function lookupCanonicalUsersById(userId: string): Promise<readonly CanonicalUser[]> {
    return dbServer
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(2)
        .all();
}

export const resolveAuthenticatedReviewPrincipal = createAuthenticatedReviewPrincipalResolver({
    readCurrentSession: readAuthenticatedWebSession,
    lookupUsersById: lookupCanonicalUsersById,
}).resolve;
