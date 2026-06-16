// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import type { TherapySummary } from '@/lib/api/v1/types';
/* @Codex */
import { normalizeTherapyUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import { normalizeTherapyStatus } from '@/lib/status-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
import { buildTherapyVersionConflictPayload, parseTherapyExpectedVersion } from '@/lib/therapy-concurrency';
import { parseClinicalDeleteBody } from '@/lib/api-v1-clinical-lifecycle';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// WUL-308: PHI-safe snapshot for the 409 version-conflict payload.
async function selectTherapyConflictSnapshot(patientId: string, therapyId: string) {
    return await dbServer
        .select({
            id: therapies.id,
            patientId: therapies.patientId,
            version: therapies.version,
            updatedAt: therapies.updatedAt,
            deletedAt: therapies.deletedAt,
        })
        .from(therapies)
        .where(and(eq(therapies.id, therapyId), eq(therapies.patientId, patientId)))
        .get() ?? null;
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
        // WUL-308: child PUTs require optimistic concurrency like the patient PUT.
        const expectedVersion = parseTherapyExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

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
                version: expectedVersion + 1,
            })
            .where(and(
                eq(therapies.id, therapyId),
                eq(therapies.patientId, id),
                eq(therapies.version, expectedVersion),
            ))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildTherapyVersionConflictPayload(
                    expectedVersion,
                    therapyId,
                    await selectTherapyConflictSnapshot(id, therapyId),
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
                eventType: normalized.values.deletedAt ? 'therapy.deleted' : 'therapy.updated',
                subjectType: 'therapy',
                subjectRef: therapyId,
                redactedMetadata: {
                    changedFields: listChangedFields(body, ['version']),
                    resourceVersion: expectedVersion + 1,
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
        // WUL-308: DELETE writes a version-guarded soft-delete tombstone like entries.
        const parsedBody = await parseClinicalDeleteBody(request);
        if (!parsedBody.ok) {
            return NextResponse.json({ error: parsedBody.error }, { status: 400 });
        }
        const expectedVersion = parseTherapyExpectedVersion(parsedBody.values.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const normalized = normalizeTherapyUpdateInput({
            deletedAt: parsedBody.values.deletedAt,
            deletionReason: parsedBody.values.deletionReason,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const existing = await dbServer.select({ id: therapies.id }).from(therapies)
            .where(and(eq(therapies.id, therapyId), eq(therapies.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const updateResult = await dbServer.update(therapies)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(
                eq(therapies.id, therapyId),
                eq(therapies.patientId, id),
                eq(therapies.version, expectedVersion),
            ))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildTherapyVersionConflictPayload(
                    expectedVersion,
                    therapyId,
                    await selectTherapyConflictSnapshot(id, therapyId),
                ),
                { status: 409 }
            );
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
                    changedFields: ['deletedAt', 'deletionReason'],
                    resourceVersion: expectedVersion + 1,
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
