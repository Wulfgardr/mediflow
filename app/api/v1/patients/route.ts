// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients, patientsToAmbulatories } from '@/lib/schema';
import { desc, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import { v4 as uuidv4 } from 'uuid';
import type { PatientSummary } from '@/lib/api/v1/types';
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
    eventType: Parameters<typeof writeAuditEvent>[0]['eventType'],
    subjectRef: string,
    redactedMetadata: Parameters<typeof writeAuditEvent>[0]['redactedMetadata']
): Promise<void> {
    try {
        const session = await requireLocalApiActorSession(request);
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

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const ambulatoryId = searchParams.get('ambulatoryId');

        let normalizedPatients: Array<typeof patients.$inferSelect> = [];

        if (ambulatoryId) {
            const rows = await dbServer.select({ patient: patients })
                .from(patients)
                .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
                .where(eq(patientsToAmbulatories.ambulatoryId, ambulatoryId))
                .orderBy(desc(patients.updatedAt));
            normalizedPatients = rows.map((row) => row.patient);
        } else {
            normalizedPatients = await dbServer.select().from(patients).orderBy(desc(patients.updatedAt));
        }

        const result: PatientSummary[] = normalizedPatients.map((patient) => ({
            id: patient.id,
            firstName: patient.firstName,
            lastName: patient.lastName,
            birthDate: toIsoString(patient.birthDate),
            taxCode: patient.taxCode,
            isAdi: patient.isAdi ?? null,
            isArchived: patient.isArchived ?? null,
            /* @Codex */
            version: patient.version,
            updatedAt: toIsoString(patient.updatedAt)
        }));

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients error:', error);
        return NextResponse.json({ error: 'Failed to fetch patients' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const body = await request.json();
        const newId = body.id || uuidv4();

        await dbServer.insert(patients).values({
            id: newId,
            firstName: body.firstName,
            lastName: body.lastName,
            taxCode: body.taxCode,
            birthDate: body.birthDate ? new Date(body.birthDate) : null,
            address: body.address ?? null,
            phone: body.phone ?? null,
            caregiver: body.caregiver ?? null,
            /* @Codex */
            exemptions: normalizeExemptionsValue(body.exemptions),
            /* @Codex */
            diagnoses: normalizeDiagnosesValue(body.diagnoses),
            /* @Codex */
            monitoringProfile: typeof body.monitoringProfile === 'string' ? body.monitoringProfile : null,
            /* @Codex */
            statusReason: typeof body.statusReason === 'string' ? body.statusReason : null,
            notes: body.notes ?? null,
            isAdi: body.isAdi ?? false,
            isArchived: body.isArchived ?? false,
            /* @Codex */
            version: 1,
            ambulatoryId: body.ambulatoryId ?? null,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        if (body.ambulatoryId) {
            await dbServer.insert(patientsToAmbulatories).values({
                patientId: newId,
                ambulatoryId: body.ambulatoryId,
                assignedAt: new Date()
            }).onConflictDoNothing();
        }

        /* @Codex */
        await recordPatientAuditEvent(request, 'patient.created', newId, {
            changedFields: listChangedFields(body, ['id', 'version']),
            resourceVersion: 1,
        });

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        console.error('API POST /api/v1/patients error:', error);
        return NextResponse.json({ error: 'Failed to create patient' }, { status: 500 });
    }
}
