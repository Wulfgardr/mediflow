import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { normalizeTherapyStatus, parseTherapyStatus } from '@/lib/status-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
/* STREAM B: server-side list params (whitelisted, plaintext columns only). */
import { parseListParams } from '@/lib/list-query-params';

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
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();
        /* @Codex */
        const auditBody = body as Record<string, unknown>;
        /* @Codex */
        const normalizedStatus = body.status === undefined ? 'active' : parseTherapyStatus(body.status);
        if (body.status !== undefined && !normalizedStatus) {
            return NextResponse.json({ error: 'Invalid therapy status' }, { status: 400 });
        }

        const newId = body.id || uuidv4(); // Consistent ID handling
        await dbServer.insert(therapies).values({
            id: newId,
            patientId: body.patientId,
            drugName: body.drugName,
            /* @Codex */
            aic: typeof body.aic === 'string' ? body.aic : null,
            /* @Codex */
            atc: typeof body.atc === 'string' ? body.atc : null,
            /* @Codex */
            activePrinciple: body.activePrinciple ?? null,
            dosage: body.dosage,
            /* @Codex */
            motivation: body.motivation ?? null,
            /* @Codex */
            diagnosisCode: body.diagnosisCode ?? null,
            /* @Codex */
            diagnosisName: body.diagnosisName ?? null,
            status: normalizedStatus ?? 'active',
            startDate: new Date(body.startDate),
            endDate: body.endDate ? new Date(body.endDate) : null,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            deletionReason: null,
        });

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'therapy.created',
                subjectType: 'therapy',
                subjectRef: String(newId),
                redactedMetadata: {
                    changedFields: listChangedFields(auditBody, ['id']),
                    resourceVersion: 1,
                },
            },
            '[MediFlow] Therapy audit write failed:',
        );

        return NextResponse.json({ id: newId, version: 1 }, { status: 201 });
    } catch (error) {
        console.error("API POST /therapies error:", error);
        return NextResponse.json({ error: `Create Failed: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
    }
}
