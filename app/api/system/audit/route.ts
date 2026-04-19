import { NextResponse } from 'next/server';
import {
    listAuditEvents,
    summarizeAuditEvents,
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
function parseLimit(value: string | null, fallback: number, max: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

/* @Codex */
function parseDays(value: string | null): number {
    if (!value) return 30;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return 30;
    return Math.min(parsed, 365);
}

export async function GET(request: Request) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    try {
        const { searchParams } = new URL(request.url);
        const view = searchParams.get('view');
        const eventType = searchParams.get('eventType') as AuditEventType | null;
        const outcome = searchParams.get('outcome') as AuditOutcome | null;
        const subjectType = searchParams.get('subjectType') as AuditSubjectType | null;
        const actorRef = searchParams.get('actorRef')?.trim() || undefined;
        const limit = view === 'summary'
            ? parseLimit(searchParams.get('limit'), 500, 1000)
            : parseLimit(searchParams.get('limit'), 50, 200);
        const days = view === 'summary' ? parseDays(searchParams.get('days')) : null;
        const occurredAfter = days !== null
            ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
            : undefined;

        const rows = await listAuditEvents({
            limit,
            eventType: eventType || undefined,
            outcome: outcome || undefined,
            subjectType: subjectType || undefined,
            actorRef,
            occurredAfter,
        });

        if (view === 'summary') {
            return NextResponse.json({
                days,
                ...summarizeAuditEvents(rows, rows.length >= limit),
            });
        }

        return NextResponse.json(rows);
    } catch (error) {
        console.error('[MediFlow] Audit viewer failed:', error);
        return NextResponse.json({ error: 'Failed to fetch audit events' }, { status: 500 });
    }
}
