import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/* @Codex */
import {
    auditContextFromSession,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/audit';
/* @Codex */
import { dbServer } from '@/lib/db-server';
/* @Codex */
import { users } from '@/lib/schema';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

// Lazy KDF upgrade: persists a re-wrapped master-key blob (and its salt) without
// touching the PIN. The client calls this after a successful login when the
// stored blob is below CURRENT_KDF_VERSION. The master key never changes, so no
// clinical data is re-encrypted; only the PIN-derived wrapping is strengthened.
function failureResponse(status: number, code: string, message: string) {
    const response = NextResponse.json({ error: message, code, message }, { status });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();
        const encryptedMasterKey = typeof body?.encryptedMasterKey === 'string' ? body.encryptedMasterKey : '';
        const salt = typeof body?.salt === 'string' ? body.salt : '';

        if (!encryptedMasterKey || !salt) {
            return failureResponse(400, 'KDF_REWRAP_INVALID', 'Payload di re-wrap incompleto.');
        }

        const user = await dbServer.select().from(users).where(eq(users.id, session.userId)).get();
        if (!user) {
            return unauthorizedResponse();
        }

        await dbServer
            .update(users)
            .set({ encryptedMasterKey, salt })
            .where(eq(users.id, user.id))
            .run();

        try {
            const context = auditContextFromSession(session);
            await writeAuditEvent({
                eventType: 'settings.updated',
                outcome: 'success',
                actorType: context.actorType,
                actorRef: context.actorRef,
                subjectType: 'settings',
                subjectRef: 'security.kdf',
                sourceSurface: context.sourceSurface,
                requestId: requestIdFromRequest(request),
                redactedMetadata: withAuditContextMetadata(context, {
                    changedFields: ['encryptedMasterKey', 'salt'],
                    flags: ['kdf-upgrade'],
                    reasonCode: 'kdf_rewrap',
                }),
            });
        } catch (error) {
            console.error('Audit KDF rewrap write failed:', error);
        }

        const response = NextResponse.json({ success: true });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        console.error('KDF rewrap error:', error);
        return failureResponse(500, 'KDF_REWRAP_FAILED', 'Errore durante il re-wrap della chiave.');
    }
}
