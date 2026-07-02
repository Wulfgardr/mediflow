/* @Codex */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { observations } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import type { ObservationSummary } from '@/lib/api/v1/types';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
/* @Codex */
import { normalizeObservationUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
import { buildObservationVersionConflictPayload, parseObservationExpectedVersion } from '@/lib/observation-concurrency';
import { parseClinicalDeleteBody } from '@/lib/api-v1-clinical-lifecycle';

/* @Codex */
function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// WUL-308: PHI-safe snapshot for the 409 version-conflict payload.
async function selectObservationConflictSnapshot(patientId: string, observationId: string) {
    return await dbServer
        .select({
            id: observations.id,
            patientId: observations.patientId,
            version: observations.version,
            updatedAt: observations.updatedAt,
            deletedAt: observations.deletedAt,
        })
        .from(observations)
        .where(and(eq(observations.id, observationId), eq(observations.patientId, patientId)))
        .get() ?? null;
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
            refLow: item.refLow ?? null,
            refHigh: item.refHigh ?? null,
            refText: item.refText ?? null,
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
        // WUL-308: child PUTs require optimistic concurrency like the patient PUT.
        const expectedVersion = parseObservationExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

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

        const updateResult = await dbServer
            .update(observations)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(
                eq(observations.id, observationId),
                eq(observations.patientId, id),
                eq(observations.version, expectedVersion),
            ))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildObservationVersionConflictPayload(
                    expectedVersion,
                    observationId,
                    await selectObservationConflictSnapshot(id, observationId),
                ),
                { status: 409 }
            );
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                // WUL-308: a soft-delete via PUT is audited as a deletion, not an update.
                eventType: normalized.values.deletedAt ? 'observation.deleted' : 'observation.updated',
                subjectType: 'observation',
                subjectRef: observationId,
                redactedMetadata: {
                    changedFields: listChangedFields(body, ['version']),
                    resourceVersion: expectedVersion + 1,
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
        // WUL-308: DELETE writes a version-guarded soft-delete tombstone like entries.
        const parsedBody = await parseClinicalDeleteBody(request);
        if (!parsedBody.ok) {
            return NextResponse.json({ error: parsedBody.error }, { status: 400 });
        }
        const expectedVersion = parseObservationExpectedVersion(parsedBody.values.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const normalized = normalizeObservationUpdateInput({
            deletedAt: parsedBody.values.deletedAt,
            deletionReason: parsedBody.values.deletionReason,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const existing = await dbServer
            .select({ id: observations.id })
            .from(observations)
            .where(and(eq(observations.id, observationId), eq(observations.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const updateResult = await dbServer
            .update(observations)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(
                eq(observations.id, observationId),
                eq(observations.patientId, id),
                eq(observations.version, expectedVersion),
            ))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildObservationVersionConflictPayload(
                    expectedVersion,
                    observationId,
                    await selectObservationConflictSnapshot(id, observationId),
                ),
                { status: 409 }
            );
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'observation.deleted',
                subjectType: 'observation',
                subjectRef: observationId,
                redactedMetadata: {
                    changedFields: ['deletedAt', 'deletionReason'],
                    resourceVersion: expectedVersion + 1,
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
