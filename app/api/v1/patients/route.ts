// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients, patientsToAmbulatories } from '@/lib/schema';
import { and, desc, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
// WUL-306 (ADR 0066): list reads must exclude soft-deleted patients
import { activePatients } from '@/lib/patient-lifecycle';
import { v4 as uuidv4 } from 'uuid';
import type { PatientSummary } from '@/lib/api/v1/types';
/* @Codex */
import { normalizePatientCreateInput } from '@/lib/patient-write-normalization';
/* @Codex */
import {
    auditContextFromRequest,
    listChangedFields,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/audit';

/* @Codex */
async function recordPatientAuditEvent(
    request: Request,
    eventType: Parameters<typeof writeAuditEvent>[0]['eventType'],
    subjectRef: string,
    redactedMetadata: Parameters<typeof writeAuditEvent>[0]['redactedMetadata']
): Promise<void> {
    try {
        const session = await requireLocalApiActorSession(request);
        const context = auditContextFromRequest(request, session);
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
                .where(and(eq(patientsToAmbulatories.ambulatoryId, ambulatoryId), activePatients()))
                .orderBy(desc(patients.updatedAt));
            normalizedPatients = rows.map((row) => row.patient);
        } else {
            normalizedPatients = await dbServer.select().from(patients).where(activePatients()).orderBy(desc(patients.updatedAt));
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
        const body = await request.json() as Record<string, unknown>;
        const newId = body.id || uuidv4();

        const normalized = normalizePatientCreateInput(body, {
            id: typeof newId === 'string' ? newId : uuidv4(),
            ambulatoryId: typeof body.ambulatoryId === 'string' ? body.ambulatoryId : null,
            allowArchivedOnCreate: true,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        await dbServer.insert(patients).values(normalized.values);

        if (normalized.values.ambulatoryId) {
            await dbServer.insert(patientsToAmbulatories).values({
                patientId: normalized.values.id,
                ambulatoryId: normalized.values.ambulatoryId,
                assignedAt: new Date()
            }).onConflictDoNothing();
        }

        /* @Codex */
        await recordPatientAuditEvent(request, 'patient.created', normalized.values.id, {
            changedFields: listChangedFields(body, ['id', 'version']),
            resourceVersion: 1,
        });

        return NextResponse.json({ id: normalized.values.id }, { status: 201 });
    } catch (error) {
        console.error('API POST /api/v1/patients error:', error);
        return NextResponse.json({ error: 'Failed to create patient' }, { status: 500 });
    }
}
