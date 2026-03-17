/* @Codex */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { deleteSession, SESSION_COOKIE_NAME, type ServerSession } from '@/lib/server-session';
/* @Codex */
import { auditContextFromSession, requestIdFromRequest, writeAuditEvent } from '@/lib/audit';
import { requireSession } from '@/lib/server-auth';

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
            });
        } catch (error) {
            console.error('Audit logout write failed:', error);
        }
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE_NAME, '', {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: 0
    });
    return response;
}
