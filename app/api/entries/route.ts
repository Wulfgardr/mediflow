import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { entries } from '@/lib/schema';
import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { auditContextFromSession, requestIdFromRequest } from '@/lib/security/audit';
/* @Codex */
import { prepareEntryCreate, readEntryJsonObject } from '@/lib/entry-write-input';
import { createEntryOperation } from '@/lib/entry-write-operation';
/* STREAM B: server-side list params (whitelisted, plaintext columns only). */
import { parseListParams } from '@/lib/list-query-params';

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
        const parsed = await readEntryJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const patientId = typeof parsed.body.patientId === 'string' ? parsed.body.patientId.trim() : '';
        const prepared = prepareEntryCreate(parsed.body, 'web', patientId);
        if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 400 });
        const context = auditContextFromSession(session);
        const result = createEntryOperation({ patientId, id: prepared.id, values: prepared.values,
            changedFields: prepared.changedFields, mode: 'web', audit: {
                actorType: context.actorType, actorRef: context.actorRef, sourceSurface: context.sourceSurface,
                requestId: requestIdFromRequest(request), flags: [`auth:${context.authContext}`],
            } });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error("API POST /entries error:", error);
        return NextResponse.json({ error: 'Create Failed' }, { status: 500 });
    }
}
