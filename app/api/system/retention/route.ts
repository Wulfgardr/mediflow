// ADR 0176: conservazione dei dati sanitari. Lettura della revisione, finestre del
// titolare, blocchi e scarto confermato; sessione Web admin soltanto.
import { NextResponse } from 'next/server';
import { archiveReplacementResponse } from '@/lib/api-error-response';
import { readBoundedJsonBody } from '@/lib/bounded-request-body';
import { dbServer } from '@/lib/db-server';
import { RetentionError } from '@/lib/retention-policy';
import {
    commitRetentionWindows, discardExpiredFascicolo, placeRetentionHold, releaseRetentionHold, retentionOverview,
    type RetentionAuditPort,
} from '@/lib/retention-store';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEventInTransaction } from '@/lib/security/audit';
import { forbiddenResponse, requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import type { ServerSession } from '@/lib/security/server-session';

export const dynamic = 'force-dynamic';
const JSON_MAX_BYTES = 65_536;
const NO_STORE = { 'Cache-Control': 'no-store' };
type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];

const nowSeconds = () => Math.floor(Date.now() / 1000);

function errorResponse(error: unknown, label: string): NextResponse {
    if (error instanceof RetentionError) {
        const status = error.code === 'input_invalid' || error.code === 'below_minimum' ? 400 : error.code === 'not_found' ? 404 : 409;
        return NextResponse.json({ code: error.code }, { status, headers: NO_STORE });
    }
    const replacement = archiveReplacementResponse(error);
    if (replacement) return replacement;
    console.error(`[MediFlow] Retention ${label} failed:`, error);
    return NextResponse.json({ code: 'internal_error' }, { status: 500, headers: NO_STORE });
}

function auditPort(tx: Tx, session: ServerSession, request: Request): RetentionAuditPort {
    const context = auditContextFromSession(session);
    const requestId = requestIdFromRequest(request);
    return event => {
        writeAuditEventInTransaction(tx, {
            eventType: event.eventType, outcome: 'success',
            archiveGeneration: context.archiveGeneration, actorType: context.actorType, actorRef: context.actorRef,
            subjectType: event.subjectType, subjectRef: event.subjectRef, sourceSurface: context.sourceSurface, requestId,
            redactedMetadata: withAuditContextMetadata(context, { flags: event.flags, ...(event.counts === undefined ? {} : { counts: event.counts }) }),
        });
    };
}

async function readBody(request: Request): Promise<Record<string, unknown> | NextResponse> {
    const parsed = await readBoundedJsonBody(request, JSON_MAX_BYTES, 'request-json', { signal: request.signal, deadline: Infinity })
        .catch(() => ({ ok: false as const, status: 400 as const }));
    if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
        return NextResponse.json({ code: 'input_invalid' }, { status: parsed.ok ? 400 : parsed.status, headers: NO_STORE });
    }
    return parsed.value as Record<string, unknown>;
}

export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();
    try {
        const overview = dbServer.transaction(tx => retentionOverview(tx, nowSeconds()));
        return NextResponse.json(overview, { headers: NO_STORE });
    } catch (error) { return errorResponse(error, 'review'); }
}

export async function PUT(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();
    const denial = archiveWriteRequestDenial(request, session);
    if (denial) return denial;
    const body = await readBody(request);
    if (body instanceof NextResponse) return body;
    try {
        const value = dbServer.transaction(tx => commitRetentionWindows(tx, body, auditPort(tx, session, request)), { behavior: 'immediate' });
        return NextResponse.json(value, { headers: NO_STORE });
    } catch (error) { return errorResponse(error, 'windows'); }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();
    const denial = archiveWriteRequestDenial(request, session);
    if (denial) return denial;
    const body = await readBody(request);
    if (body instanceof NextResponse) return body;
    try {
        const value = dbServer.transaction(tx => {
            const audit = auditPort(tx, session, request);
            if (body.action === 'hold.place') return placeRetentionHold(tx, body, session.userId, nowSeconds(), audit);
            if (body.action === 'hold.release') return releaseRetentionHold(tx, body, audit);
            if (body.action === 'discard') return discardExpiredFascicolo(tx, body, nowSeconds(), audit);
            throw new RetentionError('input_invalid');
        }, { behavior: 'immediate' });
        return NextResponse.json(value, { headers: NO_STORE });
    } catch (error) { return errorResponse(error, 'command'); }
}
