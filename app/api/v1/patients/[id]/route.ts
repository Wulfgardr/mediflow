// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients, patientsToAmbulatories } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import type { PatientDetail } from '@/lib/api/v1/types';
/* @Codex */
import { buildPatientVersionConflictPayload, parseExpectedVersion } from '@/lib/patient-concurrency';
/* @Codex */
import {
    classifyPatientMutationEvent,
    listChangedFields,
    requestIdFromRequest,
    writeAuditEvent,
} from '@/lib/audit';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* @Codex */
function normalizeExemptionsForUpdate(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return JSON.stringify(value);
    return null;
}

/* @Codex */
function normalizeDiagnosesForUpdate(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return JSON.stringify(value);
    return null;
}

/* @Codex */
const localApiAuditContext = {
    actorType: 'system' as const,
    actorRef: 'local-api',
    sourceSurface: 'api' as const,
};

/* @Codex */
async function recordPatientAuditEvent(
    request: Request,
    eventType: Parameters<typeof writeAuditEvent>[0]['eventType'],
    subjectRef: string,
    redactedMetadata: Parameters<typeof writeAuditEvent>[0]['redactedMetadata']
): Promise<void> {
    try {
        await writeAuditEvent({
            eventType,
            outcome: 'success',
            actorType: localApiAuditContext.actorType,
            actorRef: localApiAuditContext.actorRef,
            subjectType: 'patient',
            subjectRef,
            sourceSurface: localApiAuditContext.sourceSurface,
            requestId: requestIdFromRequest(request),
            redactedMetadata,
        });
    } catch (error) {
        console.error('[MediFlow] Patient audit write failed:', error);
    }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        const patient = await dbServer.select().from(patients).where(eq(patients.id, id)).get();

        if (!patient) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const result: PatientDetail = {
            id: patient.id,
            firstName: patient.firstName,
            lastName: patient.lastName,
            birthDate: toIsoString(patient.birthDate),
            taxCode: patient.taxCode,
            address: patient.address ?? null,
            phone: patient.phone ?? null,
            caregiver: patient.caregiver ?? null,
            /* @Codex */
            exemptions: patient.exemptions ?? null,
            /* @Codex */
            diagnoses: patient.diagnoses ?? null,
            /* @Codex */
            monitoringProfile: patient.monitoringProfile ?? null,
            /* @Codex */
            statusReason: patient.statusReason ?? null,
            notes: patient.notes ?? null,
            /* @Codex */
            aiSummary: patient.aiSummary ?? null,
            /* @Codex */
            documentInsights: patient.documentInsights ?? null,
            isAdi: patient.isAdi ?? null,
            isArchived: patient.isArchived ?? null,
            /* @Codex */
            version: patient.version,
            ambulatoryId: patient.ambulatoryId ?? null,
            createdAt: toIsoString(patient.createdAt),
            updatedAt: toIsoString(patient.updatedAt)
        };

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to fetch patient' }, { status: 500 });
    }
}

/* @Codex */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        const body = await request.json();
        /* @Codex */
        const expectedVersion = parseExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

        const existing = await dbServer.select({ id: patients.id, isArchived: patients.isArchived }).from(patients).where(eq(patients.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const normalizedExemptions = normalizeExemptionsForUpdate(body.exemptions);
        /* @Codex */
        const normalizedDiagnoses = normalizeDiagnosesForUpdate(body.diagnoses);
        const updateValues: Partial<typeof patients.$inferInsert> = {
            firstName: typeof body.firstName === 'string' ? body.firstName : undefined,
            lastName: typeof body.lastName === 'string' ? body.lastName : undefined,
            taxCode: typeof body.taxCode === 'string' ? body.taxCode : undefined,
            address: typeof body.address === 'string' ? body.address : undefined,
            phone: typeof body.phone === 'string' ? body.phone : undefined,
            caregiver: typeof body.caregiver === 'string' ? body.caregiver : undefined,
            notes: typeof body.notes === 'string' ? body.notes : undefined,
            /* @Codex */
            monitoringProfile: typeof body.monitoringProfile === 'string'
                ? body.monitoringProfile
                : body.monitoringProfile === null
                    ? null
                    : undefined,
            /* @Codex */
            statusReason: typeof body.statusReason === 'string'
                ? body.statusReason
                : body.statusReason === null
                    ? null
                    : undefined,
            aiSummary: typeof body.aiSummary === 'string' ? body.aiSummary : undefined,
            documentInsights: typeof body.documentInsights === 'string' ? body.documentInsights : undefined,
            isAdi: typeof body.isAdi === 'boolean' ? body.isAdi : undefined,
            isArchived: typeof body.isArchived === 'boolean' ? body.isArchived : undefined,
            ambulatoryId: typeof body.ambulatoryId === 'string'
                ? body.ambulatoryId
                : body.ambulatoryId === null
                    ? null
                    : undefined,
            /* @Codex */
            version: expectedVersion + 1,
            birthDate: body.birthDate === null
                ? null
                : body.birthDate
                    ? new Date(body.birthDate)
                    : undefined,
            updatedAt: new Date()
        };

        if (normalizedExemptions !== undefined) {
            updateValues.exemptions = normalizedExemptions;
        }
        /* @Codex */
        if (normalizedDiagnoses !== undefined) {
            updateValues.diagnoses = normalizedDiagnoses;
        }

        /* @Codex */
        const hasUpdatableField = Object.entries(updateValues).some(
            ([key, value]) => key !== 'updatedAt' && key !== 'version' && value !== undefined
        );
        if (!hasUpdatableField) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        /* @Codex */
        const updateResult = await dbServer
            .update(patients)
            .set(updateValues)
            .where(and(eq(patients.id, id), eq(patients.version, expectedVersion)))
            .run();

        if (updateResult.changes === 0) {
            const current = await dbServer
                .select({
                    id: patients.id,
                    version: patients.version,
                    updatedAt: patients.updatedAt,
                    isArchived: patients.isArchived
                })
                .from(patients)
                .where(eq(patients.id, id))
                .get();
            return NextResponse.json(
                buildPatientVersionConflictPayload(expectedVersion, id, current ?? null),
                { status: 409 }
            );
        }

        if (Object.prototype.hasOwnProperty.call(body, 'ambulatoryId')) {
            await dbServer.delete(patientsToAmbulatories).where(eq(patientsToAmbulatories.patientId, id));
            if (typeof body.ambulatoryId === 'string' && body.ambulatoryId.trim().length > 0) {
                await dbServer.insert(patientsToAmbulatories).values({
                    patientId: id,
                    ambulatoryId: body.ambulatoryId,
                    assignedAt: new Date()
                }).onConflictDoNothing();
            }
        }

        /* @Codex */
        await recordPatientAuditEvent(
            request,
            classifyPatientMutationEvent(existing.isArchived ?? null, updateValues.isArchived as boolean | undefined),
            id,
            {
                changedFields: listChangedFields(body, ['version']),
                resourceVersion: expectedVersion + 1,
            }
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /api/v1/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update patient' }, { status: 500 });
    }
}

/* @Codex */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        /* @Codex */
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const expectedVersion = parseExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

        const existing = await dbServer.select({ id: patients.id }).from(patients).where(eq(patients.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        /* @Codex */
        const deleteResult = await dbServer
            .delete(patients)
            .where(and(eq(patients.id, id), eq(patients.version, expectedVersion)))
            .run();

        if (deleteResult.changes === 0) {
            const current = await dbServer
                .select({
                    id: patients.id,
                    version: patients.version,
                    updatedAt: patients.updatedAt,
                    isArchived: patients.isArchived
                })
                .from(patients)
                .where(eq(patients.id, id))
                .get();
            return NextResponse.json(
                buildPatientVersionConflictPayload(expectedVersion, id, current ?? null),
                { status: 409 }
            );
        }

        /* @Codex */
        await recordPatientAuditEvent(request, 'patient.deleted', id, {
            resourceVersion: expectedVersion,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete patient' }, { status: 500 });
    }
}
