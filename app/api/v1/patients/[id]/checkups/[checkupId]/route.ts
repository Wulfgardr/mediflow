// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { checkups } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/security/server-auth';
import type { CheckupSummary } from '@/lib/api/v1/types';
/* @Codex */
import { normalizeCheckupUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import { normalizeCheckupStatus } from '@/lib/status-normalization';
/* @Codex */
import { auditContextFromRequest, listChangedFields, requestIdFromRequest } from '@/lib/security/audit';
import { updateCheckupOperation } from '@/lib/checkup-write-operation';
import { parseCheckupExpectedVersion } from '@/lib/checkup-concurrency';
import { parseClinicalDeleteBody } from '@/lib/api-v1-clinical-lifecycle';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// WUL-308: PHI-safe snapshot for the 409 version-conflict payload.
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

        // @Codex: host audit context is resolved before the synchronous IMMEDIATE mutation.
        const context = auditContextFromRequest(request, auditSession);
        const result = updateCheckupOperation({
            patientId: id, checkupId: checkupId, expectedVersion, values: normalized.values, mode: 'v1',
            changedFields: listChangedFields(body, ['version']),
            audit: { actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
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

        const context = auditContextFromRequest(request, auditSession);
        const result = updateCheckupOperation({
            patientId: id, checkupId: checkupId, expectedVersion, values: normalized.values, mode: 'v1',
            changedFields: ['deletedAt', 'deletionReason'],
            audit: { actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id]/checkups/[checkupId] error:', error);
        return NextResponse.json({ error: 'Failed to delete checkup' }, { status: 500 });
    }
}
