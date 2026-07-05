import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { messages } from '@/lib/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { normalizeStoredMessagePayload } from '@/lib/message-persistence';
/* STREAM B: server-side list params (whitelisted, plaintext columns only). */
import { parseListParams } from '@/lib/list-query-params';

// content/metadata/attachmentBase64/reasoning are ENC:. Only createdAt sortable.
const MESSAGE_SORT_COLUMNS = {
    createdAt: messages.createdAt,
} as const;

export async function GET(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');

    /* STREAM B: messages default to chronological (asc) order for chat rendering. */
    const parsed = parseListParams(searchParams, {
        sortableColumns: Object.keys(MESSAGE_SORT_COLUMNS),
        defaultOrderBy: 'createdAt',
        defaultOrderDir: 'asc',
    });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { limit, offset, orderBy, orderDir } = parsed.params;

    try {
        const whereClause = conversationId ? eq(messages.conversationId, conversationId) : undefined;

        const sortColumn = MESSAGE_SORT_COLUMNS[(orderBy ?? 'createdAt') as keyof typeof MESSAGE_SORT_COLUMNS];
        const orderExpr = orderDir === 'asc' ? asc(sortColumn) : desc(sortColumn);

        let query = dbServer.select().from(messages).where(whereClause).orderBy(orderExpr).$dynamic();
        if (typeof limit === 'number') query = query.limit(limit);
        if (typeof offset === 'number') query = query.offset(offset);

        const data = await query;
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();
        const newId = body.id || uuidv4();
        const normalized = normalizeStoredMessagePayload(body as Record<string, unknown>);

        await dbServer.insert(messages).values({
            id: newId,
            conversationId: body.conversationId,
            role: body.role,
            content: body.content,
            metadata: normalized.metadata,
            attachmentType: normalized.attachmentType,
            attachmentBase64: normalized.attachmentBase64,
            createdAt: new Date()
        });

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: "Create Failed" }, { status: 500 });
    }
}
