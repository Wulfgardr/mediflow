// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { checkups } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import type { CheckupSummary } from '@/lib/api/v1/types';
/* @Codex */
import { normalizeOptionalCheckupSource } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import { normalizeCheckupStatus, parseCheckupStatus } from '@/lib/status-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* @Codex */
function parseDate(value: unknown): Date | undefined {
    if (!value) return undefined;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; checkupId: string }> }
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id, checkupId } = await params;
        const checkup = await dbServer.select().from(checkups)
            .where(and(eq(checkups.id, checkupId), eq(checkups.patientId, id)))
            .get();

        if (!checkup) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const result: CheckupSummary = {
            id: checkup.id,
            patientId: checkup.patientId,
            date: toIsoString(checkup.date) ?? new Date(0).toISOString(),
            title: checkup.title,
            notes: checkup.notes ?? null,
            status: normalizeCheckupStatus(checkup.status),
            source: checkup.source ?? null,
            createdAt: toIsoString(checkup.createdAt),
        };

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id]/checkups/[checkupId] error:', error);
        return NextResponse.json({ error: 'Failed to fetch checkup' }, { status: 500 });
    }
}

/* @Codex */
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; checkupId: string }> }
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        /* @Codex */
        const auditSession = await requireLocalApiActorSession(request);
        const { id, checkupId } = await params;
        const body = await request.json();

        const existing = await dbServer.select({ id: checkups.id }).from(checkups)
            .where(and(eq(checkups.id, checkupId), eq(checkups.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const nextDate = parseDate(body.date);
        if (body.date !== undefined && nextDate === undefined) {
            return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
        }

        const nextTitle = typeof body.title === 'string' ? body.title : undefined;
        const hasNotes = Object.prototype.hasOwnProperty.call(body, 'notes');
        const nextNotes = hasNotes
            ? (typeof body.notes === 'string'
                ? body.notes
                : body.notes === null || body.notes === ''
                    ? null
                    : undefined)
            : undefined;
        /* @Codex */
        let nextStatus: string | undefined;
        if (typeof body.status === 'string') {
            const parsedStatus = parseCheckupStatus(body.status);
            if (!parsedStatus) {
                return NextResponse.json({ error: 'Invalid checkup status' }, { status: 400 });
            }
            nextStatus = parsedStatus;
        }
        const hasSource = Object.prototype.hasOwnProperty.call(body, 'source');
        const normalizedSource = normalizeOptionalCheckupSource(body.source);
        if (!normalizedSource.ok) {
            return NextResponse.json({ error: normalizedSource.error }, { status: 400 });
        }
        const nextSource = hasSource ? normalizedSource.values : undefined;

        if (
            nextDate === undefined &&
            nextTitle === undefined &&
            nextNotes === undefined &&
            nextStatus === undefined &&
            nextSource === undefined
        ) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        await dbServer.update(checkups)
            .set({
                date: nextDate,
                title: nextTitle,
                notes: nextNotes,
                status: nextStatus,
                source: nextSource,
            })
            .where(and(eq(checkups.id, checkupId), eq(checkups.patientId, id)));

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'checkup.updated',
                subjectType: 'checkup',
                subjectRef: checkupId,
                redactedMetadata: {
                    changedFields: listChangedFields(body as Record<string, unknown>),
                },
            },
            '[MediFlow] Checkup audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /api/v1/patients/[id]/checkups/[checkupId] error:', error);
        return NextResponse.json({ error: 'Failed to update checkup' }, { status: 500 });
    }
}

/* @Codex */
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; checkupId: string }> }
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        /* @Codex */
        const auditSession = await requireLocalApiActorSession(request);
        const { id, checkupId } = await params;
        const existing = await dbServer.select({ id: checkups.id }).from(checkups)
            .where(and(eq(checkups.id, checkupId), eq(checkups.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        await dbServer.delete(checkups).where(and(eq(checkups.id, checkupId), eq(checkups.patientId, id)));

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'checkup.deleted',
                subjectType: 'checkup',
                subjectRef: checkupId,
            },
            '[MediFlow] Checkup audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id]/checkups/[checkupId] error:', error);
        return NextResponse.json({ error: 'Failed to delete checkup' }, { status: 500 });
    }
}
