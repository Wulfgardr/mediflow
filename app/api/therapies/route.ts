import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { normalizeTherapyStatus, parseTherapyStatus } from '@/lib/status-normalization';
/* @Codex */
import { auditContextFromSession, requestIdFromRequest } from '@/lib/security/audit';
/* STREAM B: server-side list params (whitelisted, plaintext columns only). */
import { parseListParams } from '@/lib/list-query-params';
/* @Codex */
import { therapyCreateSchema } from '@/lib/api-schemas/clinical-writes';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';
import { apiInternalError } from '@/lib/api-error-response';
import { createTherapyOperation } from '@/lib/therapy-write-operation';
import { readTherapyJsonObject, therapyCreateId, therapyChangedFields, validateTherapyInput } from '@/lib/therapy-write-input';

// motivation is ENC:, so it is not sortable. Only plaintext columns here.
const THERAPY_SORT_COLUMNS = {
    startDate: therapies.startDate,
    endDate: therapies.endDate,
    createdAt: therapies.createdAt,
    updatedAt: therapies.updatedAt,
} as const;

export async function GET(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    /* STREAM B */
    const parsed = parseListParams(searchParams, {
        sortableColumns: Object.keys(THERAPY_SORT_COLUMNS),
        defaultOrderBy: 'startDate',
        defaultOrderDir: 'desc',
    });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { limit, offset, orderBy, orderDir } = parsed.params;

    try {
        const filters: SQL[] = [isNull(therapies.deletedAt)];
        if (patientId) filters.push(eq(therapies.patientId, patientId));
        const whereClause = and(...filters);

        const sortColumn = THERAPY_SORT_COLUMNS[(orderBy ?? 'startDate') as keyof typeof THERAPY_SORT_COLUMNS];
        const orderExpr = orderDir === 'asc' ? asc(sortColumn) : desc(sortColumn);

        let query = dbServer.select().from(therapies).where(whereClause).orderBy(orderExpr).$dynamic();
        if (typeof limit === 'number') query = query.limit(limit);
        if (typeof offset === 'number') query = query.offset(offset);

        const data = await query;
        const normalizedData = data.map((therapy) => ({
            ...therapy,
            status: normalizeTherapyStatus(therapy.status),
        }));
        return NextResponse.json(normalizedData);
    } catch (error) {
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const parsed = await readTherapyJsonObject(request, 'web', 'create');
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const shape = validateTherapyInput(parsed.body, 'web', 'create');
        if (shape) return NextResponse.json({ error: shape.error }, { status: shape.status });
        const parsedBody = parseApiBody(therapyCreateSchema, parsed.body);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.data;
        const normalizedStatus = body.status === undefined ? 'active' : parseTherapyStatus(body.status);
        if (body.status !== undefined && !normalizedStatus) {
            return NextResponse.json({ error: 'Invalid therapy status' }, { status: 400 });
        }
        const newId = therapyCreateId(parsed.body);
        const therapyValues = {
            id: newId, patientId: body.patientId, drugName: body.drugName,
            aic: typeof body.aic === 'string' ? body.aic : null,
            atc: typeof body.atc === 'string' ? body.atc : null,
            activePrinciple: body.activePrinciple ?? null, dosage: body.dosage,
            motivation: body.motivation ?? null,
            diagnosisCode: body.diagnosisCode ?? null, diagnosisName: body.diagnosisName ?? null,
            status: normalizedStatus ?? 'active', startDate: new Date(body.startDate),
            endDate: body.endDate ? new Date(body.endDate) : null,
            version: 1, createdAt: new Date(), updatedAt: new Date(),
            deletedAt: null, deletionReason: null,
        };
        const context = auditContextFromSession(session);
        const result = createTherapyOperation({
            patientId: body.patientId, therapyId: newId, values: therapyValues,
            changedFields: therapyChangedFields(therapyValues, parsed.body), mode: 'web',
            audit: { actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        return apiInternalError('POST /api/therapies', error);
    }
}
