import { NextResponse } from 'next/server';
import {
    listAuditEvents,
    type AuditEventType,
    type AuditOutcome,
    type AuditSubjectType,
} from '@/lib/audit';
import {
    forbiddenResponse,
    requireSessionOrLocalToken,
    unauthorizedResponse,
} from '@/lib/server-auth';

/* @Codex */
function parseLimit(value: string | null): number {
    if (!value) return 50;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return 50;
    return Math.min(parsed, 200);
}

export async function GET(request: Request) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    try {
        const { searchParams } = new URL(request.url);
        const eventType = searchParams.get('eventType') as AuditEventType | null;
        const outcome = searchParams.get('outcome') as AuditOutcome | null;
        const subjectType = searchParams.get('subjectType') as AuditSubjectType | null;
        const actorRef = searchParams.get('actorRef')?.trim() || undefined;
        const limit = parseLimit(searchParams.get('limit'));

        const rows = await listAuditEvents({
            limit,
            eventType: eventType || undefined,
            outcome: outcome || undefined,
            subjectType: subjectType || undefined,
            actorRef,
        });

        return NextResponse.json(rows);
    } catch (error) {
        console.error('[MediFlow] Audit viewer failed:', error);
        return NextResponse.json({ error: 'Failed to fetch audit events' }, { status: 500 });
    }
}
