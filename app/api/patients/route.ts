import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients, ambulatories, patientsToAmbulatories } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { desc, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import {
    auditContextFromSession,
    listChangedFields,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/audit';

/* @Codex */
function normalizeExemptionsValue(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return JSON.stringify(value);
    return null;
}

/* @Codex */
function normalizeDiagnosesValue(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return JSON.stringify(value);
    return null;
}

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
            .where(eq(patientsToAmbulatories.ambulatoryId, ambulatoryId))
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
        const body = await request.json();
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

        await dbServer.insert(patients).values({
            id: newId,
            firstName: body.firstName,
            lastName: body.lastName,
            taxCode: body.taxCode,
            birthDate: body.birthDate ? new Date(body.birthDate) : null,
            address: body.address,
            phone: body.phone,
            /* @Codex */
            caregiver: body.caregiver ?? null,
            /* @Codex */
            exemptions: normalizeExemptionsValue(body.exemptions),
            /* @Codex */
            diagnoses: normalizeDiagnosesValue(body.diagnoses),
            /* @Codex */
            monitoringProfile: typeof body.monitoringProfile === 'string' ? body.monitoringProfile : null,
            /* @Codex */
            statusReason: typeof body.statusReason === 'string' ? body.statusReason : null,
            notes: body.notes || null,
            isAdi: body.isAdi || false,
            /* @Codex */
            version: 1,
            ambulatoryId: ambulatoryId || null,
            updatedAt: new Date(),
            createdAt: new Date()
        });

        /* @Codex */
        if (ambulatoryId) {
            await dbServer.insert(patientsToAmbulatories)
                .values({ patientId: newId, ambulatoryId })
                .onConflictDoNothing();
        }

        /* @Codex */
        await recordPatientAuditEvent(request, session, 'patient.created', newId, {
            changedFields: listChangedFields(body, ['id', 'version']),
            resourceVersion: 1,
        });

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        console.error("API POST /patients error:", error);
        return NextResponse.json({ error: "Failed to create patient" }, { status: 500 });
    }
}
