import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients, ambulatories, patientsToAmbulatories } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { and, desc, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
// WUL-306 (ADR 0066): list reads must exclude soft-deleted patients
import { activePatients } from '@/lib/patient-lifecycle';
/* @Codex */
import { normalizePatientCreateInput } from '@/lib/patient-write-normalization';
/* @Codex */
import {
    auditContextFromSession,
    listChangedFields,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/audit';

/* @Codex */
async function recordPatientAuditEvent(
    request: Request,
    session: Awaited<ReturnType<typeof requireSession>>,
    eventType: Parameters<typeof writeAuditEvent>[0]['eventType'],
    subjectRef: string,
    redactedMetadata: Parameters<typeof writeAuditEvent>[0]['redactedMetadata']
): Promise<void> {
    try {
        const context = auditContextFromSession(session);
        await writeAuditEvent({
            eventType,
            outcome: 'success',
            actorType: context.actorType,
            actorRef: context.actorRef,
            subjectType: 'patient',
            subjectRef,
            sourceSurface: context.sourceSurface,
            requestId: requestIdFromRequest(request),
            redactedMetadata: withAuditContextMetadata(context, redactedMetadata),
        });
    } catch (error) {
        console.error('[MediFlow] Patient audit write failed:', error);
    }
}

export async function GET() {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const cookieStore = await cookies();
        let ambulatoryId = cookieStore.get('ambulatory_id')?.value;

        // Fallback: Use default ambulatory if no cookie
        if (!ambulatoryId) {
            const defaultAmb = await dbServer.select().from(ambulatories).where(eq(ambulatories.isDefault, true)).limit(1);
            if (defaultAmb.length > 0) {
                ambulatoryId = defaultAmb[0].id;
            }
        }

        if (!ambulatoryId) {
            // If still no ambulatory, return empty or all? Safety: return empty or handled by UI
            return NextResponse.json([]);
        }

        // MANY-TO-MANY JOIN
        // Select patients where there is a link in patientsToAmbulatories for this ambulatoryId
        const rows = await dbServer.select({
            patient: patients
        })
            .from(patients)
            .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
            .where(and(eq(patientsToAmbulatories.ambulatoryId, ambulatoryId), activePatients()))
            .orderBy(desc(patients.updatedAt));

        // Flatten result
        const result = rows.map(r => r.patient);

        return NextResponse.json(result);
    } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        console.error("API GET /patients error:", error, (error as any)?.message, (error as any)?.stack);
        return NextResponse.json({ error: "Failed to fetch patients" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json() as Record<string, unknown>;
        const newId = body.id || uuidv4();

        const cookieStore = await cookies();
        let ambulatoryId = cookieStore.get('ambulatory_id')?.value;

        // Fallback: Use default ambulatory if no cookie
        if (!ambulatoryId) {
            const defaultAmb = await dbServer.select().from(ambulatories).where(eq(ambulatories.isDefault, true)).limit(1);
            if (defaultAmb.length > 0) {
                ambulatoryId = defaultAmb[0].id;
            }
        }

        const normalized = normalizePatientCreateInput(body, {
            id: typeof newId === 'string' ? newId : uuidv4(),
            ambulatoryId: ambulatoryId || null,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        // WUL-268 (STREAM A): the patient row and its ambulatory membership must be
        // created atomically. better-sqlite3 transactions are synchronous, so no
        // awaits inside; the async audit write stays outside (separate audit DB).
        dbServer.transaction((tx) => {
            tx.insert(patients).values(normalized.values).run();

            /* @Codex */
            if (normalized.values.ambulatoryId) {
                tx.insert(patientsToAmbulatories)
                    .values({ patientId: normalized.values.id, ambulatoryId: normalized.values.ambulatoryId })
                    .onConflictDoNothing()
                    .run();
            }
        });

        /* @Codex */
        await recordPatientAuditEvent(request, session, 'patient.created', normalized.values.id, {
            changedFields: listChangedFields(body, ['id', 'version']),
            resourceVersion: 1,
        });

        return NextResponse.json({ id: normalized.values.id }, { status: 201 });
    } catch (error) {
        console.error("API POST /patients error:", error);
        return NextResponse.json({ error: "Failed to create patient" }, { status: 500 });
    }
}
