// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/security/server-auth';
import type { TherapySummary } from '@/lib/api/v1/types';
/* @Codex */
import { normalizeTherapyUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import { normalizeTherapyStatus } from '@/lib/status-normalization';
/* @Codex */
import { auditContextFromSession, requestIdFromRequest } from '@/lib/security/audit';
import { updateTherapyOperation } from '@/lib/therapy-write-operation';
import { parseTherapyDeleteInput, readTherapyJsonObject, safeTherapyExpectedVersion, therapyChangedFields, validateTherapyInput } from '@/lib/therapy-write-input';

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
        const auditSession = await requireLocalApiActorSession(request);
        const { id, therapyId } = await params;
        const parsed = await readTherapyJsonObject(request, 'v1', 'update');
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const expectedVersion = safeTherapyExpectedVersion(parsed.body.version);
        if (expectedVersion === null) return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        /* @Codex: retain v1's 404-before-field-validation wire precedence; the IMMEDIATE core rechecks identity. */
        const exists = dbServer.select({ id: therapies.id }).from(therapies)
            .where(and(eq(therapies.id, therapyId), eq(therapies.patientId, id))).get();
        if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const shape = validateTherapyInput(parsed.body, 'v1', 'update');
        if (shape) return NextResponse.json({ error: shape.error }, { status: shape.status });
        const normalized = normalizeTherapyUpdateInput(parsed.body);
        if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });
        const context = auditContextFromSession(auditSession);
        const result = updateTherapyOperation({
            patientId: id, therapyId, expectedVersion, values: normalized.values,
            changedFields: therapyChangedFields(normalized.values, parsed.body), mode: 'v1',
            audit: { actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
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
        const auditSession = await requireLocalApiActorSession(request);
        const { id, therapyId } = await params;
        const parsed = await readTherapyJsonObject(request, 'v1', 'delete');
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const parsedBody = parseTherapyDeleteInput(parsed.body, 'api-v1-delete');
        if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
        const normalized = normalizeTherapyUpdateInput(parsedBody.body);
        if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });
        const context = auditContextFromSession(auditSession);
        const result = updateTherapyOperation({
            patientId: id, therapyId, expectedVersion: parsedBody.expectedVersion,
            values: normalized.values, changedFields: ['deletedAt', 'deletionReason'], mode: 'v1',
            audit: { actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id]/therapies/[therapyId] error:', error);
        return NextResponse.json({ error: 'Failed to delete therapy' }, { status: 500 });
    }
}
