/* @Codex */
import { cookies } from 'next/headers';

import {
    evaluateApplicationLockAttempt,
    type ApplicationLockSources,
    createApplicationLockResponse,
} from '@/lib/security/application-lock-server';
import { hashAuditRef, auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEvent } from '@/lib/security/audit';
import { invalidateServerSessionForApplicationLock, SESSION_COOKIE_NAME } from '@/lib/security/server-session';
import { serverSessionProjectionOwnerRegistry } from '@/lib/security/server-session-projection-owner-production';

const productionSources: ApplicationLockSources = Object.freeze({
    invalidateSession: invalidateServerSessionForApplicationLock,
    lookupProjectionOwner: (sessionId) => serverSessionProjectionOwnerRegistry.lookup(sessionId),
});

export async function POST(request: Request) {
    const cookieStore = await cookies();
    const cookieSessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const attempt = evaluateApplicationLockAttempt(cookieSessionId, productionSources);
    let receipt = attempt.receipt;

    if (receipt.state === 'server_invalidation_confirmed') {
        try {
            if (typeof cookieSessionId !== 'string') throw new Error('invalid lock receipt input');
            const context = auditContextFromSession(attempt.sessionBeforeDeletion);
            await writeAuditEvent({
                eventType: 'auth.lock',
                outcome: 'success',
                actorType: context.actorType,
                actorRef: context.actorRef,
                subjectType: 'session',
                subjectRef: hashAuditRef(cookieSessionId),
                sourceSurface: context.sourceSurface,
                requestId: requestIdFromRequest(request),
                redactedMetadata: withAuditContextMetadata(context, null),
            });
        } catch {
            receipt = {
                schemaVersion: 'mediflow.application-lock-receipt.v1',
                state: 'server_invalidation_unconfirmed',
            };
        }
    }

    return createApplicationLockResponse(request, receipt);
}
