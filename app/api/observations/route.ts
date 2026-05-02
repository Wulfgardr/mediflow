/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { observations } from '@/lib/schema';
import { desc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
/* @Codex */
import { normalizeObservationCreateInput } from '@/lib/api-v1-clinical-write-normalization';

export async function GET(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    try {
        let query = dbServer.select().from(observations);
        if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(observations.patientId, patientId)) as any;
        }
        const data = await query.orderBy(desc(observations.observedAt));
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
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        await dbServer.insert(observations).values(normalized.values);

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
