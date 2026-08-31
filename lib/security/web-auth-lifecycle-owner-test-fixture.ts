/* @Codex */
import {
    begin,
    bootstrapControl,
    issue,
    resolve,
    retire,
    retireForUser,
} from './web-auth-lifecycle-owner-adapter';
import type { ServerSession } from './server-session';

type SyntheticWebUser = Readonly<{ id: string; username: string; role: string }>;
export type SyntheticWebSessionContext = Readonly<{
    session: ServerSession;
    controlId: string;
    etag: string;
}>;

/** Creates only synthetic, process-local Web projections for owner-bound tests. */
export function issueSyntheticWebSessionContext(user: SyntheticWebUser, suffix: string): SyntheticWebSessionContext {
    const control = bootstrapControl();
    if (!control) throw new Error('Synthetic Web control unavailable');
    const attempt = begin('login', {
        controlId: control.controlId,
        ifMatch: control.etag,
        idempotencyKey: `synthetic-owner-fixture-${suffix}`,
    });
    if (!attempt) throw new Error('Synthetic Web attempt unavailable');
    const issued = issue(attempt, user);
    if (!issued) throw new Error('Synthetic Web issue unavailable');
    const resolution = resolve(issued.sessionId, control.controlId);
    if (resolution.status !== 'active') throw new Error('Synthetic Web projection unavailable');
    return Object.freeze({
        session: resolution.projection as ServerSession,
        controlId: control.controlId,
        etag: issued.etag,
    });
}

export function issueSyntheticWebSession(user: SyntheticWebUser, suffix: string): ServerSession {
    return issueSyntheticWebSessionContext(user, suffix).session;
}

export function retireSyntheticWebSession(session: ServerSession): void {
    retire(session, 'dispose');
}

export function retireSyntheticWebSessionsForUser(session: ServerSession): void {
    retireForUser(session);
}
