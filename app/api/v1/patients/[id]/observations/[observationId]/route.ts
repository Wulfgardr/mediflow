/* @Codex */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { observations } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/security/server-auth';
import type { ObservationSummary } from '@/lib/api/v1/types';
/* @Codex */
import { auditContextFromRequest, requestIdFromRequest } from '@/lib/security/audit';
/* @Codex */
import { normalizeObservationUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
import { updateObservationOperation } from '@/lib/observation-write-operation';
import { observationChangedFields, parseObservationDeleteInput, readObservationJsonObject,
    safeObservationExpectedVersion, validateObservationInput } from '@/lib/observation-write-input';

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

export async function PUT(request: Request,
    { params }: { params: Promise<{ id: string; observationId: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;
    try {
        const auditSession = await requireLocalApiActorSession(request);
        const { id, observationId } = await params;
        const parsed = await readObservationJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const expectedVersion = safeObservationExpectedVersion(parsed.body.version);
        if (expectedVersion === null) return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        // @Codex: preserve scoped 404-before-domain-validation; the operation rechecks under IMMEDIATE.
        const existing = dbServer.select({ id: observations.id }).from(observations)
            .where(and(eq(observations.id, observationId), eq(observations.patientId, id))).get();
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const shape = validateObservationInput(parsed.body, 'v1', 'update');
        if (shape) return NextResponse.json({ error: shape.error }, { status: shape.status });
        const normalized = normalizeObservationUpdateInput(parsed.body);
        if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });
        const context = auditContextFromRequest(request, auditSession);
        const result = updateObservationOperation({
            patientId: id, observationId, expectedVersion, values: normalized.values, mode: 'v1',
            changedFields: observationChangedFields(normalized.values, parsed.body),
            audit: { actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API PUT /api/v1/patients/[id]/observations/[observationId] error:', error);
        return NextResponse.json({ error: 'Failed to update observation' }, { status: 500 });
    }
}

export async function DELETE(request: Request,
    { params }: { params: Promise<{ id: string; observationId: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;
    try {
        const auditSession = await requireLocalApiActorSession(request);
        const { id, observationId } = await params;
        const parsed = await readObservationJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const deletion = parseObservationDeleteInput(parsed.body, 'api-v1-delete');
        if (!deletion.ok) return NextResponse.json({ error: deletion.error }, { status: deletion.status });
        const normalized = normalizeObservationUpdateInput(deletion.body);
        if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });
        const context = auditContextFromRequest(request, auditSession);
        const result = updateObservationOperation({
            patientId: id, observationId, expectedVersion: deletion.expectedVersion,
            values: normalized.values, mode: 'v1', changedFields: ['deletedAt', 'deletionReason'],
            audit: { actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id]/observations/[observationId] error:', error);
        return NextResponse.json({ error: 'Failed to delete observation' }, { status: 500 });
    }
}
