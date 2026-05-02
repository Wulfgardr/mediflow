// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { checkups } from '@/lib/schema';
import { and, eq, sql } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import type { CheckupSummary } from '@/lib/api/v1/types';
/* @Codex */
import { normalizeCheckupUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import { normalizeCheckupStatus } from '@/lib/status-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
            version: checkup.version,
            updatedAt: toIsoString(checkup.updatedAt),
            deletedAt: toIsoString(checkup.deletedAt),
            deletionReason: checkup.deletionReason ?? null,
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
        const body = await request.json() as Record<string, unknown>;

        const existing = await dbServer.select({ id: checkups.id }).from(checkups)
            .where(and(eq(checkups.id, checkupId), eq(checkups.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const normalized = normalizeCheckupUpdateInput(body);
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        await dbServer.update(checkups)
            .set({
                ...normalized.values,
                version: sql`${checkups.version} + 1`,
            })
            .where(and(eq(checkups.id, checkupId), eq(checkups.patientId, id)));
        const current = await dbServer
            .select({ version: checkups.version })
            .from(checkups)
            .where(and(eq(checkups.id, checkupId), eq(checkups.patientId, id)))
            .get();

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'checkup.updated',
                subjectType: 'checkup',
                subjectRef: checkupId,
                redactedMetadata: {
                    changedFields: listChangedFields(body, ['version']),
                    resourceVersion: current?.version ?? undefined,
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
        const existing = await dbServer.select({ id: checkups.id, version: checkups.version }).from(checkups)
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
                redactedMetadata: {
                    changedFields: ['deleted'],
                    resourceVersion: existing.version,
                },
            },
            '[MediFlow] Checkup audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id]/checkups/[checkupId] error:', error);
        return NextResponse.json({ error: 'Failed to delete checkup' }, { status: 500 });
    }
}
