/* @Codex */
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { observations } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import type { ObservationSummary } from '@/lib/api/v1/types';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
/* @Codex */
import { normalizeObservationUpdateInput } from '@/lib/api-v1-clinical-write-normalization';

/* @Codex */
function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; observationId: string }> },
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id, observationId } = await params;
        const item = await dbServer
            .select()
            .from(observations)
            .where(and(eq(observations.id, observationId), eq(observations.patientId, id)))
            .get();

        if (!item) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const result: ObservationSummary = {
            id: item.id,
            patientId: item.patientId,
            codeSystem: item.codeSystem,
            code: item.code,
            display: item.display,
            unitSystem: item.unitSystem,
            unitCode: item.unitCode,
            value: item.value,
            notes: item.notes ?? null,
            observedAt: toIsoString(item.observedAt) ?? new Date(0).toISOString(),
            source: item.source ?? null,
            version: item.version,
            createdAt: toIsoString(item.createdAt),
            updatedAt: toIsoString(item.updatedAt),
            deletedAt: toIsoString(item.deletedAt),
            deletionReason: item.deletionReason ?? null,
        };

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id]/observations/[observationId] error:', error);
        return NextResponse.json({ error: 'Failed to fetch observation' }, { status: 500 });
    }
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; observationId: string }> },
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        /* @Codex */
        const auditSession = await requireLocalApiActorSession(request);
        const { id, observationId } = await params;
        const body = await request.json() as Record<string, unknown>;

        const existing = await dbServer
            .select({ id: observations.id })
            .from(observations)
            .where(and(eq(observations.id, observationId), eq(observations.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const normalized = normalizeObservationUpdateInput(body);
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        await dbServer
            .update(observations)
            .set({
                ...normalized.values,
                version: sql`${observations.version} + 1`,
            })
            .where(and(eq(observations.id, observationId), eq(observations.patientId, id)));
        const current = await dbServer
            .select({ version: observations.version })
            .from(observations)
            .where(and(eq(observations.id, observationId), eq(observations.patientId, id)))
            .get();

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'observation.updated',
                subjectType: 'observation',
                subjectRef: observationId,
                redactedMetadata: {
                    changedFields: listChangedFields(body, ['version']),
                    resourceVersion: current?.version ?? undefined,
                },
            },
            '[MediFlow] Observation audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /api/v1/patients/[id]/observations/[observationId] error:', error);
        return NextResponse.json({ error: 'Failed to update observation' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; observationId: string }> },
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        /* @Codex */
        const auditSession = await requireLocalApiActorSession(request);
        const { id, observationId } = await params;
        const existing = await dbServer
            .select({ id: observations.id, version: observations.version })
            .from(observations)
            .where(and(eq(observations.id, observationId), eq(observations.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        await dbServer
            .delete(observations)
            .where(and(eq(observations.id, observationId), eq(observations.patientId, id)));

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'observation.deleted',
                subjectType: 'observation',
                subjectRef: observationId,
                redactedMetadata: {
                    changedFields: ['deleted'],
                    resourceVersion: existing.version,
                },
            },
            '[MediFlow] Observation audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id]/observations/[observationId] error:', error);
        return NextResponse.json({ error: 'Failed to delete observation' }, { status: 500 });
    }
}
