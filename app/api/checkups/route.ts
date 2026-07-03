import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { checkups } from '@/lib/schema';
import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { normalizeCheckupStatus, parseCheckupStatus } from '@/lib/status-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
/* STREAM B: server-side list params (whitelisted, plaintext columns only). */
import { parseListParams } from '@/lib/list-query-params';

// Only plaintext columns are sortable server-side (notes is ENC:, not sortable).
const CHECKUP_SORT_COLUMNS = {
    date: checkups.date,
    createdAt: checkups.createdAt,
    updatedAt: checkups.updatedAt,
} as const;

/* @Codex */
function parseRequiredDate(value: unknown): Date | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');
    const includeDeleted = searchParams.get('includeDeleted') === 'true';

    /* STREAM B */
    const parsed = parseListParams(searchParams, {
        sortableColumns: Object.keys(CHECKUP_SORT_COLUMNS),
        defaultOrderBy: 'date',
        defaultOrderDir: 'desc',
    });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { limit, offset, orderBy, orderDir } = parsed.params;

    try {
        const filters: SQL[] = [];
        if (patientId) filters.push(eq(checkups.patientId, patientId));
        if (!includeDeleted) filters.push(isNull(checkups.deletedAt));
        const whereClause = filters.length > 0 ? and(...filters) : undefined;

        const sortColumn = CHECKUP_SORT_COLUMNS[(orderBy ?? 'date') as keyof typeof CHECKUP_SORT_COLUMNS];
        const orderExpr = orderDir === 'asc' ? asc(sortColumn) : desc(sortColumn);

        let query = dbServer.select().from(checkups).where(whereClause).orderBy(orderExpr).$dynamic();
        if (typeof limit === 'number') query = query.limit(limit);
        if (typeof offset === 'number') query = query.offset(offset);

        const data = await query;
        const normalizedData = data.map((checkup) => ({
            ...checkup,
            status: normalizeCheckupStatus(checkup.status),
        }));
        return NextResponse.json(normalizedData);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch checkups" }, { status: 500 });
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
        const normalizedStatus = body.status === undefined ? 'pending' : parseCheckupStatus(body.status);
        if (body.status !== undefined && !normalizedStatus) {
            return NextResponse.json({ error: 'Invalid checkup status' }, { status: 400 });
        }
        /* @Codex */
        if (typeof body.patientId !== 'string' || body.patientId.trim().length === 0) {
            return NextResponse.json({ error: 'patientId required' }, { status: 400 });
        }
        /* @Codex */
        if (typeof body.title !== 'string' || body.title.trim().length === 0) {
            return NextResponse.json({ error: 'title required' }, { status: 400 });
        }
        /* @Codex */
        const checkupDate = parseRequiredDate(body.date);
        if (!checkupDate) {
            return NextResponse.json({ error: 'Valid checkup date required' }, { status: 400 });
        }

        // Allow client to generate ID or generate it here. 
        // ApiTable shim might send an ID if it's "add" with specific ID, but usually it relies on return.
        // However, if the client sends an ID, we should respect it or overwrite. 
        // Let's see `entries` implementation: it generates new ID server side.
        // But `ApiTable.add` might expect the ID back or might have generated one client side (Dexie style).
        // If the body has an id, use it, otherwise generate one.

        const newId = body.id || uuidv4();

        await dbServer.insert(checkups).values({
            id: newId,
            patientId: body.patientId,
            date: checkupDate,
            title: body.title,
            /* @Codex */
            notes: body.notes ?? null,
            status: normalizedStatus ?? 'pending',
            /* @Codex */
            source: body.source ?? 'manual',
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
                eventType: 'checkup.created',
                subjectType: 'checkup',
                subjectRef: String(newId),
                redactedMetadata: {
                    changedFields: listChangedFields(auditBody, ['id']),
                    resourceVersion: 1,
                },
            },
            '[MediFlow] Checkup audit write failed:',
        );

        return NextResponse.json({ id: newId, version: 1 }, { status: 201 });
    } catch (error) {
        console.error("Checkup create error", error);
        return NextResponse.json({ error: "Create Failed" }, { status: 500 });
    }
}
