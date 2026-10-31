import { NextResponse } from 'next/server';
import {
    listAuditEvents,
    summarizeAuditEvents,
    type AuditEventType,
    type AuditOutcome,
    type AuditSubjectType,
} from '@/lib/security/audit';
import {
    forbiddenResponse,
    requireSession,
    unauthorizedResponse,
} from '@/lib/security/server-auth';
/* @Codex */
import { isWebAdminSession } from '@/lib/security/server-auth-policy';

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
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();

    try {
        const { searchParams } = new URL(request.url);
        const view = searchParams.get('view');
        const origin = searchParams.get('origin') ?? 'local';
        if (origin !== 'local' && origin !== 'imported') return NextResponse.json({ error: 'Invalid audit origin' }, { status: 400 });
        const eventType = searchParams.get('eventType') as AuditEventType | null;
        const outcome = searchParams.get('outcome') as AuditOutcome | null;
        const subjectType = searchParams.get('subjectType') as AuditSubjectType | null;
        const actorRef = searchParams.get('actorRef')?.trim() || undefined;
        const limit = parseLimit(searchParams.get('limit'), view === 'summary' ? 200 : 50, 200);
        const days = view === 'summary' ? parseDays(searchParams.get('days')) : null;
        const occurredAfter = days !== null
            ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
            : undefined;

        const rows = await listAuditEvents({
            limit,
            origin,
            eventType: eventType || undefined,
            outcome: outcome || undefined,
            subjectType: subjectType || undefined,
            actorRef,
            occurredAfter,
        });

        if (view === 'summary') {
            const importedRows = origin === 'local' ? await listAuditEvents({ limit, origin: 'imported', eventType: eventType || undefined,
                outcome: outcome || undefined, subjectType: subjectType || undefined, actorRef, occurredAfter }) : [];
            const localRows = origin === 'local' ? rows : [];
            const importedSample = origin === 'imported' ? rows : importedRows;
            return NextResponse.json({
                days,
                ...summarizeAuditEvents([...localRows, ...importedSample], localRows.length >= limit),
                importedIsTruncated: importedSample.length >= limit,
            });
        }

        return NextResponse.json(rows);
    } catch (error) {
        console.error('[MediFlow] Audit viewer failed:', error);
        return NextResponse.json({ error: 'Failed to fetch audit events' }, { status: 500 });
    }
}
