import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { checkups } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { normalizeCheckupStatus, parseCheckupStatus } from '@/lib/status-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';

export async function GET(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    try {
        let query = dbServer.select().from(checkups);

        if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(checkups.patientId, patientId)) as any;
        }

        const data = await query.orderBy(desc(checkups.date));
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
            date: new Date(body.date),
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
