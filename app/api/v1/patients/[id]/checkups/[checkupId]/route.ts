// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { checkups } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import type { CheckupSummary } from '@/lib/api/v1/types';
/* @Codex */
import { normalizeCheckupUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import { normalizeCheckupStatus } from '@/lib/status-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
import { buildCheckupVersionConflictPayload, parseCheckupExpectedVersion } from '@/lib/checkup-concurrency';
import { parseClinicalDeleteBody } from '@/lib/api-v1-clinical-lifecycle';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// WUL-308: PHI-safe snapshot for the 409 version-conflict payload.
async function selectCheckupConflictSnapshot(patientId: string, checkupId: string) {
    return await dbServer
        .select({
            id: checkups.id,
            patientId: checkups.patientId,
            version: checkups.version,
            updatedAt: checkups.updatedAt,
            deletedAt: checkups.deletedAt,
        })
        .from(checkups)
        .where(and(eq(checkups.id, checkupId), eq(checkups.patientId, patientId)))
        .get() ?? null;
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
        // WUL-308: child PUTs require optimistic concurrency like the patient PUT.
        const expectedVersion = parseCheckupExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

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

        const updateResult = await dbServer.update(checkups)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(
                eq(checkups.id, checkupId),
                eq(checkups.patientId, id),
                eq(checkups.version, expectedVersion),
            ))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildCheckupVersionConflictPayload(
                    expectedVersion,
                    checkupId,
                    await selectCheckupConflictSnapshot(id, checkupId),
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
                eventType: normalized.values.deletedAt ? 'checkup.deleted' : 'checkup.updated',
                subjectType: 'checkup',
                subjectRef: checkupId,
                redactedMetadata: {
                    changedFields: listChangedFields(body, ['version']),
                    resourceVersion: expectedVersion + 1,
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
        // WUL-308: DELETE writes a version-guarded soft-delete tombstone like entries.
        const parsedBody = await parseClinicalDeleteBody(request);
        if (!parsedBody.ok) {
            return NextResponse.json({ error: parsedBody.error }, { status: 400 });
        }
        const expectedVersion = parseCheckupExpectedVersion(parsedBody.values.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const normalized = normalizeCheckupUpdateInput({
            deletedAt: parsedBody.values.deletedAt,
            deletionReason: parsedBody.values.deletionReason,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const existing = await dbServer.select({ id: checkups.id }).from(checkups)
            .where(and(eq(checkups.id, checkupId), eq(checkups.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const updateResult = await dbServer.update(checkups)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(
                eq(checkups.id, checkupId),
                eq(checkups.patientId, id),
                eq(checkups.version, expectedVersion),
            ))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildCheckupVersionConflictPayload(
                    expectedVersion,
                    checkupId,
                    await selectCheckupConflictSnapshot(id, checkupId),
                ),
                { status: 409 }
            );
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'checkup.deleted',
                subjectType: 'checkup',
                subjectRef: checkupId,
                redactedMetadata: {
                    changedFields: ['deletedAt', 'deletionReason'],
                    resourceVersion: expectedVersion + 1,
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
