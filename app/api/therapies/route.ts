import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { normalizeTherapyStatus, parseTherapyStatus } from '@/lib/status-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
/* @Codex */
import { therapyCreateSchema } from '@/lib/api-schemas/clinical-writes';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';

export async function GET(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    try {
        let query = dbServer.select().from(therapies);

        if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(and(eq(therapies.patientId, patientId), isNull(therapies.deletedAt))) as any;
        } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(isNull(therapies.deletedAt)) as any;
        }

        const data = await query.orderBy(desc(therapies.startDate));
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
        const rawBody = await request.json();
        const parsedBody = parseApiBody(therapyCreateSchema, rawBody);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.data;
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
