/* @Codex */
import 'server-only';

import type { ServerSession } from './server-session';
import {
    abortResourceUse,
    beginResourceUse,
    commitResourceUse,
    mintResourcePort,
    releaseResourcePort,
    type WebResourcePort,
    type WebResourceUse,
} from './web-auth-lifecycle-owner-adapter';

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

export function createAuthenticatedReviewPrincipalResolver(sources: Sources) {
    return Object.freeze({
        async resolve(): Promise<AuthenticatedReviewPrincipalV1> {
            let session: ServerSession | null;
            try { session = await sources.readCurrentSession(); } catch { return fail('storage_unavailable'); }
            if (!session) return fail('session_unavailable');
            let port: WebResourcePort | null = null;
            let use: WebResourceUse | null = null;
            let committed = false;
            try {
                port = mintResourcePort(session);
                if (!port) return fail('session_ineligible');
                use = beginResourceUse(port);
                if (!use || session.authChannel !== 'web' || session.id === 'local-api') return fail('session_ineligible');

                let matches: readonly CanonicalUser[];
                try { matches = await sources.lookupUsersById(session.userId); } catch { return fail('storage_unavailable'); }
                if (matches.length === 0) return fail('principal_missing');
                if (matches.length !== 1) return fail('principal_ambiguous');
                if (matches[0].id !== session.userId || matches[0].username !== session.username) {
                    return fail('principal_mismatch');
                }

                committed = commitResourceUse(use);
                if (!committed) return fail('session_ineligible');
                return Object.freeze({ actorRef: matches[0].id, sessionRef: session.id });
            } finally {
                if (use && !committed) abortResourceUse(use);
                if (port) releaseResourcePort(port);
            }
        },
    });
}
