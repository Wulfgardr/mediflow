import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { entries, patients } from '@/lib/schema';
import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/security/audit';
/* @Codex */
import { normalizeEntryCreateInput } from '@/lib/api-v1-clinical-write-normalization';
/* STREAM B: server-side list params (whitelisted, plaintext columns only). */
import { parseListParams } from '@/lib/list-query-params';
import { activePatients } from '@/lib/patient-lifecycle';

// Only plaintext columns are sortable server-side (ENC: columns are opaque).
const ENTRY_SORT_COLUMNS = {
    date: entries.date,
    createdAt: entries.createdAt,
    updatedAt: entries.updatedAt,
} as const;

export async function GET(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');
    const includeDeleted = searchParams.get('includeDeleted') === 'true';

    /* STREAM B */
    const parsed = parseListParams(searchParams, {
        sortableColumns: Object.keys(ENTRY_SORT_COLUMNS),
        defaultOrderBy: 'date',
        defaultOrderDir: 'desc',
    });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { limit, offset, orderBy, orderDir } = parsed.params;

    try {
        const filters: SQL[] = [];
        if (patientId) filters.push(eq(entries.patientId, patientId));
        if (!includeDeleted) filters.push(isNull(entries.deletedAt));
        const whereClause = filters.length > 0 ? and(...filters) : undefined;

        const sortColumn = ENTRY_SORT_COLUMNS[(orderBy ?? 'date') as keyof typeof ENTRY_SORT_COLUMNS];
        const orderExpr = orderDir === 'asc' ? asc(sortColumn) : desc(sortColumn);

        let query = dbServer.select().from(entries).where(whereClause).orderBy(orderExpr).$dynamic();
        if (typeof limit === 'number') query = query.limit(limit);
        if (typeof offset === 'number') query = query.offset(offset);

        const data = await query;
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch entries" }, { status: 500 });
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
        const newId = typeof body.id === 'string' && body.id.trim().length > 0 ? body.id : uuidv4();
        const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
        const normalized = normalizeEntryCreateInput(body, {
            id: newId,
            patientId,
        });
        if (!patientId) {
            return NextResponse.json({ error: 'Invalid patientId' }, { status: 400 });
        }
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const created = dbServer.transaction((tx) => {
            const patient = tx.select({ id: patients.id })
                .from(patients)
                .where(and(eq(patients.id, patientId), activePatients()))
                .get();
            if (!patient) return false;
            tx.insert(entries).values(normalized.values).run();
            return true;
        });
        if (!created) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'entry.created',
                subjectType: 'entry',
                subjectRef: String(newId),
                redactedMetadata: {
                    changedFields: listChangedFields(auditBody, ['id']),
                },
            },
            '[MediFlow] Entry audit write failed:',
        );

        return NextResponse.json({ id: newId, version: 1 }, { status: 201 });
    } catch (error) {
        console.error("API POST /entries error:", error);
        return NextResponse.json({ error: 'Create Failed' }, { status: 500 });
    }
}
