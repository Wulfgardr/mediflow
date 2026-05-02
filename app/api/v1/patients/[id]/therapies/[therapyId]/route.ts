// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { and, eq, sql } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import type { TherapySummary } from '@/lib/api/v1/types';
/* @Codex */
import { normalizeTherapyUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import { normalizeTherapyStatus } from '@/lib/status-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; therapyId: string }> }
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id, therapyId } = await params;
        const therapy = await dbServer.select().from(therapies)
            .where(and(eq(therapies.id, therapyId), eq(therapies.patientId, id)))
            .get();

        if (!therapy) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const result: TherapySummary = {
            id: therapy.id,
            patientId: therapy.patientId,
            drugName: therapy.drugName,
            /* @Codex */
            aic: therapy.aic ?? null,
            /* @Codex */
            atc: therapy.atc ?? null,
            activePrinciple: therapy.activePrinciple ?? null,
            dosage: therapy.dosage,
            motivation: therapy.motivation ?? null,
            diagnosisCode: therapy.diagnosisCode ?? null,
            diagnosisName: therapy.diagnosisName ?? null,
            status: normalizeTherapyStatus(therapy.status),
            startDate: toIsoString(therapy.startDate) ?? new Date(0).toISOString(),
            endDate: toIsoString(therapy.endDate),
            version: therapy.version,
            createdAt: toIsoString(therapy.createdAt),
            updatedAt: toIsoString(therapy.updatedAt),
            deletedAt: toIsoString(therapy.deletedAt),
            deletionReason: therapy.deletionReason ?? null,
        };

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id]/therapies/[therapyId] error:', error);
        return NextResponse.json({ error: 'Failed to fetch therapy' }, { status: 500 });
    }
}

/* @Codex */
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; therapyId: string }> }
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        /* @Codex */
        const auditSession = await requireLocalApiActorSession(request);
        const { id, therapyId } = await params;
        const body = await request.json() as Record<string, unknown>;

        const existing = await dbServer.select({ id: therapies.id }).from(therapies)
            .where(and(eq(therapies.id, therapyId), eq(therapies.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const normalized = normalizeTherapyUpdateInput(body);
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const updateResult = await dbServer.update(therapies)
            .set({
                ...normalized.values,
                version: sql`${therapies.version} + 1`,
            })
            .where(and(eq(therapies.id, therapyId), eq(therapies.patientId, id)))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const current = await dbServer
            .select({ version: therapies.version })
            .from(therapies)
            .where(and(eq(therapies.id, therapyId), eq(therapies.patientId, id)))
            .get();
        const resourceVersion = current?.version ?? undefined;

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'therapy.updated',
                subjectType: 'therapy',
                subjectRef: therapyId,
                redactedMetadata: {
                    changedFields: listChangedFields(body, ['version']),
                    resourceVersion,
                },
            },
            '[MediFlow] Therapy audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /api/v1/patients/[id]/therapies/[therapyId] error:', error);
        return NextResponse.json({ error: 'Failed to update therapy' }, { status: 500 });
    }
}

/* @Codex */
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; therapyId: string }> }
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        /* @Codex */
        const auditSession = await requireLocalApiActorSession(request);
        const { id, therapyId } = await params;
        const existing = await dbServer.select({ id: therapies.id, version: therapies.version }).from(therapies)
            .where(and(eq(therapies.id, therapyId), eq(therapies.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const deleteResult = await dbServer.delete(therapies)
            .where(and(eq(therapies.id, therapyId), eq(therapies.patientId, id)))
            .run();

        if (deleteResult.changes === 0) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'therapy.deleted',
                subjectType: 'therapy',
                subjectRef: therapyId,
                redactedMetadata: {
                    changedFields: ['deleted'],
                    resourceVersion: existing.version,
                },
            },
            '[MediFlow] Therapy audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id]/therapies/[therapyId] error:', error);
        return NextResponse.json({ error: 'Failed to delete therapy' }, { status: 500 });
    }
}
