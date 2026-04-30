import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { entries } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
/* @Codex */
import { normalizeEntryCreateInput } from '@/lib/api-v1-clinical-write-normalization';

export async function GET(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    try {
        let query = dbServer.select().from(entries);

        if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(entries.patientId, patientId)) as any;
        }

        const data = await query.orderBy(desc(entries.date));
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
        const patientId = typeof body.patientId === 'string' ? body.patientId : '';
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

        await dbServer.insert(entries).values(normalized.values);

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

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        console.error("API POST /entries error:", error);
        return NextResponse.json({ error: `Create Failed: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
    }
}
