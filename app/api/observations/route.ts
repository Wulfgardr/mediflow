/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { observations } from '@/lib/schema';
import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { auditContextFromSession, requestIdFromRequest } from '@/lib/security/audit';
/* @Codex */
import { normalizeObservationCreateInput } from '@/lib/api-v1-clinical-write-normalization';
/* STREAM B: server-side list params (whitelisted, plaintext columns only). */
import { parseListParams } from '@/lib/list-query-params';
import { createObservationOperation } from '@/lib/observation-write-operation';
import { observationChangedFields, observationCreateId, readObservationJsonObject, validateObservationInput } from '@/lib/observation-write-input';

// notes is ENC:, not sortable. Only plaintext columns here.
const OBSERVATION_SORT_COLUMNS = {
    observedAt: observations.observedAt,
    createdAt: observations.createdAt,
    updatedAt: observations.updatedAt,
} as const;

export async function GET(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');
    const includeDeleted = searchParams.get('includeDeleted') === 'true';

    /* STREAM B */
    const parsed = parseListParams(searchParams, {
        sortableColumns: Object.keys(OBSERVATION_SORT_COLUMNS),
        defaultOrderBy: 'observedAt',
        defaultOrderDir: 'desc',
    });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { limit, offset, orderBy, orderDir } = parsed.params;

    try {
        const filters: SQL[] = [];
        if (patientId) filters.push(eq(observations.patientId, patientId));
        if (!includeDeleted) filters.push(isNull(observations.deletedAt));
        const whereClause = filters.length > 0 ? and(...filters) : undefined;

        const sortColumn = OBSERVATION_SORT_COLUMNS[(orderBy ?? 'observedAt') as keyof typeof OBSERVATION_SORT_COLUMNS];
        const orderExpr = orderDir === 'asc' ? asc(sortColumn) : desc(sortColumn);

        let query = dbServer.select().from(observations).where(whereClause).orderBy(orderExpr).$dynamic();
        if (typeof limit === 'number') query = query.limit(limit);
        if (typeof offset === 'number') query = query.offset(offset);

        const data = await query;
        return NextResponse.json(data);
    } catch (error) {
        console.error('API GET /observations error:', error);
        return NextResponse.json({ error: 'Failed to fetch observations' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const parsed = await readObservationJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const shape = validateObservationInput(parsed.body, 'web', 'create');
        if (shape) return NextResponse.json({ error: shape.error }, { status: shape.status });
        const body = parsed.body;
        const patientId = typeof body.patientId === 'string' ? body.patientId : null;
        if (!patientId) return NextResponse.json({ error: 'Missing required observation fields' }, { status: 400 });
        const observationId = observationCreateId(body);
        const normalized = normalizeObservationCreateInput(body, {
            id: observationId, patientId, allowServicePrescriptionItemLink: true,
        });
        if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });
        const context = auditContextFromSession(session);
        const result = createObservationOperation({
            patientId, observationId, values: normalized.values, mode: 'web',
            changedFields: observationChangedFields(normalized.values, body),
            audit: { actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /observations error:', error);
        return NextResponse.json({ error: 'Failed to create observation' }, { status: 500 });
    }
}
