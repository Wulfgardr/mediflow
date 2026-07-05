/* @Codex */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { deleteSession, SESSION_COOKIE_NAME, type ServerSession } from '@/lib/security/server-session';
/* @Codex */
import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEvent } from '@/lib/security/audit';
import { requireSession } from '@/lib/security/server-auth';
/* @Codex */
import { sessionCookieOptionsForRequest } from '@/lib/security/request-transport';

export async function POST(request: Request) {
    const session: ServerSession | null = await requireSession();
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    deleteSession(sessionId);

    if (session) {
        try {
            const context = auditContextFromSession(session);
            await writeAuditEvent({
                eventType: 'auth.logout',
                outcome: 'success',
                actorType: context.actorType,
                actorRef: context.actorRef,
                subjectType: 'session',
                subjectRef: session.id,
                sourceSurface: context.sourceSurface,
                requestId: requestIdFromRequest(request),
                redactedMetadata: withAuditContextMetadata(context, null),
            });
        } catch (error) {
            console.error('Audit logout write failed:', error);
        }
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE_NAME, '', {
        ...sessionCookieOptionsForRequest(request),
        maxAge: 0
    });
    return response;
}
