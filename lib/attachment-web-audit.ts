import type { dbServer } from './db-server';
import type { ServerSession } from './security/server-session';
import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEventInTransaction } from './security/audit';

/** Actor and surface come only from the admitted host session. */
export function writeAttachmentWebAudit(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    request: Request, session: ServerSession,
    eventType: 'attachment.created' | 'attachment.deleted', id: string,
): void {
    const actor = auditContextFromSession(session);
    writeAuditEventInTransaction(tx, {
        eventType, outcome: 'success', actorType: actor.actorType, actorRef: actor.actorRef,
        sourceSurface: actor.sourceSurface, subjectType: 'attachment', subjectRef: id,
        requestId: requestIdFromRequest(request), redactedMetadata: withAuditContextMetadata(actor, null),
    });
}
