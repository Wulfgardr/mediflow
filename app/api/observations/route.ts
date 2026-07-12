/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { observations, patients, servicePrescriptionItems } from '@/lib/schema';
import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/security/audit';
/* @Codex */
import { normalizeObservationCreateInput } from '@/lib/api-v1-clinical-write-normalization';
/* STREAM B: server-side list params (whitelisted, plaintext columns only). */
import { parseListParams } from '@/lib/list-query-params';
import { activePatients } from '@/lib/patient-lifecycle';

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
        const body = await request.json() as Record<string, unknown>;

        const patientId = typeof body.patientId === 'string' ? body.patientId : null;
        if (!patientId) {
            return NextResponse.json({ error: 'Missing required observation fields' }, { status: 400 });
        }

        const id = typeof body.id === 'string' ? body.id : uuidv4();
        const normalized = normalizeObservationCreateInput(body, {
            id,
            patientId,
            allowServicePrescriptionItemLink: true,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const created = dbServer.transaction((tx) => {
            const patient = tx.select({ id: patients.id })
                .from(patients)
                .where(and(eq(patients.id, patientId), activePatients()))
                .get();
            if (!patient) return 'patient-not-found';
            if (normalized.values.servicePrescriptionItemId) {
                const item = tx.select({ patientId: servicePrescriptionItems.patientId })
                    .from(servicePrescriptionItems)
                    .where(eq(servicePrescriptionItems.id, normalized.values.servicePrescriptionItemId))
                    .get();
                if (!item || item.patientId !== patientId) return 'invalid-service-prescription-item';
            }
            tx.insert(observations).values(normalized.values).run();
            return 'created';
        });
        if (created === 'patient-not-found') {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }
        if (created === 'invalid-service-prescription-item') {
            return NextResponse.json({ error: 'Service prescription item not found or does not belong to observation patient' }, { status: 422 });
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'observation.created',
                subjectType: 'observation',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: listChangedFields(body, ['id']),
                    resourceVersion: 1,
                },
            },
            '[MediFlow] Observation audit write failed:',
        );

        return NextResponse.json({ id, version: 1 }, { status: 201 });
    } catch (error) {
        console.error('API POST /observations error:', error);
        return NextResponse.json({ error: 'Failed to create observation' }, { status: 500 });
    }
}
